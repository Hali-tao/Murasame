import type { SqliteDatabase } from '../../data/sqlite-types'
import { runExtraction, type ProposedMemory } from '../../agent/memory-extractor'
import { recallMemories, embedLocally, EMBEDDING_DIM, EMBEDDING_MODEL_ID, EMBEDDING_PROFILE, vectorsCompatible } from '../../local/embedding'
import { activeMemories, applyMemoryAction, extractCandidates, normalizeKey, safeCandidate, type MemoryCategory, type MemoryFact } from '../../memory/facts'
import type { MemoryEntry, MemoryIndexStatus, Result } from '../../../shared/types'

const ok = <T>(data: T): Result<T> => ({ ok: true, data })
const fail = <T>(error: string): Result<T> => ({ ok: false, error })
const labels: Record<MemoryCategory, string> = { user: '偏好', feedback: '反馈', project: '项目', reference: '参考' }
const aliases: Record<string, MemoryCategory> = {
  user: 'user', feedback: 'feedback', project: 'project', reference: 'reference',
  偏好: 'user', 用户: 'user', 反馈: 'feedback', 项目: 'project', 参考: 'reference'
}
const toEntry = (fact: MemoryFact): MemoryEntry => ({
  id: fact.id, category: labels[fact.category], text: fact.text,
  source: fact.validUntil ? `失效于 ${fact.validUntil}，仍可追溯` : fact.source ?? '长期记忆',
  updated: fact.validUntil ? '已失效' : '有效'
})

function readVector(value: string | null): number[] | null {
  if (!value) return null
  try {
    const vector: unknown = JSON.parse(value)
    return Array.isArray(vector) && vector.length === EMBEDDING_DIM
      && vector.every((part) => typeof part === 'number' && Number.isFinite(part))
      ? vector : null
  } catch { return null }
}

export interface MemoryExtractionOutcome {
  status: 'saved' | 'unchanged' | 'skipped' | 'failed'
  reason?: string
}

export class MemoryService {
  private facts: MemoryFact[] = []
  private suppressed = new Set<string>()
  private generation = 0
  private deletedSources = new Set<string>()
  private readonly sourceVersions = new Map<string, number>()
  private listeners = new Set<() => void>()
  private recallOn = true
  private extractionOn = true
  private readonly extractionQueues = new Map<string, Promise<void>>()
  private readonly factVersions = new Map<string, number>()
  private storageReady = true
  private reindexing?: Promise<void>
  private indexController?: AbortController
  private pendingIndexEmbedding?: Promise<number[] | null>
  private readonly indexListeners = new Set<(status: MemoryIndexStatus) => void>()
  private index: MemoryIndexStatus = { state: 'idle', completed: 0, total: 0, message: '没有待恢复的记忆索引' }

  constructor(private readonly db?: SqliteDatabase, private readonly userDataDir = '') {
    this.load()
    this.publishIndex('paused', '记忆索引尚未完整，后续交流时在后台恢复')
  }

  indexStatus(): MemoryIndexStatus { return { ...this.index } }
  subscribeIndex(listener: (status: MemoryIndexStatus) => void): () => void {
    this.indexListeners.add(listener)
    return () => { this.indexListeners.delete(listener) }
  }

  /** Legacy master switch. Automatic extraction can also be disabled independently. */
  get enabled(): boolean { return this.recallOn && this.extractionOn }
  set enabled(value: boolean) { this.configure({ recallEnabled: value, extractionEnabled: value }) }
  get recallEnabled(): boolean { return this.recallOn }
  get extractionEnabled(): boolean { return this.extractionOn }

  configure(settings: { recallEnabled: boolean; extractionEnabled: boolean }): void {
    const changed = this.recallOn !== settings.recallEnabled || this.extractionOn !== settings.extractionEnabled
    if (this.extractionOn && !settings.extractionEnabled) this.generation++
    this.recallOn = settings.recallEnabled
    this.extractionOn = settings.extractionEnabled
    if (changed) {
      this.cancelIndex('记忆设置已改变，索引恢复已暂停')
      this.notify()
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  invalidateSource(source: string): void {
    this.deletedSources.add(source)
    this.cancelIndex('来源已删除，索引恢复已暂停')
  }
  list(): MemoryEntry[] { return this.active().map(toEntry) }
  /**
   * 外部直接写库（数据包导入）后从数据库重新加载。
   * 不重新加载的话内存缓存会让界面以为「导入成功但记忆还是空的」。
   */
  reloadFromStorage(): MemoryEntry[] {
    if (!this.db) return this.list()
    this.generation += 1
    this.load()
    this.notify()
    return this.list()
  }
  history(): MemoryEntry[] { return this.facts.map(toEntry) }
  active(): MemoryFact[] { return structuredClone(activeMemories(this.facts)) }

  async recall(query: string): Promise<{ text: string; ids: string[]; degraded: boolean; skipped?: 'disabled' | 'changed' }> {
    if (!this.recallOn) return { text: '', ids: [], degraded: false, skipped: 'disabled' }
    const generation = this.generation
    const queryVector = await embedLocally(query, this.userDataDir)
    if (!this.recallOn) return { text: '', ids: [], degraded: false, skipped: 'disabled' }
    if (generation !== this.generation) return { text: '', ids: [], degraded: true, skipped: 'changed' }
    const active = this.active()
    const result = recallMemories(query, active.map((fact) => ({
      id: fact.id, text: fact.text, category: fact.category, vector: fact.vector ?? null
    })), queryVector)
    if (queryVector && this.storageReady) this.startIndex(generation)
    return { text: result.injected.map((item) => item.text).join('\n'), ids: result.ids, degraded: !this.storageReady || result.degraded || active.some((fact) => !fact.vector) }
  }

  private publishIndex(state: MemoryIndexStatus['state'], message: string): void {
    const active = activeMemories(this.facts)
    const completed = active.filter((fact) => fact.vector).length
    const total = active.length
    if (!this.storageReady) { state = 'failed'; message = '记忆存储读取失败，索引恢复未完成；请重启后重试' }
    else if (completed === total) { state = 'idle'; message = total ? '现有记忆索引已就绪' : '没有待恢复的记忆索引' }
    this.index = { state, completed, total, message }
    for (const listener of this.indexListeners) {
      try { listener(this.indexStatus()) } catch { /* Index observers do not own the job. */ }
    }
  }

  private cancelIndex(message: string): void {
    this.indexController?.abort()
    this.publishIndex('paused', message)
  }

  private startIndex(generation: number): void {
    if (this.reindexing || !this.active().some((fact) => !fact.vector)) return
    // A timed-out native inference may still be running. Never overlap a retry
    // with it; its late value is discarded and a later recall can retry safely.
    if (this.pendingIndexEmbedding) return
    const controller = new AbortController()
    this.indexController = controller
    this.publishIndex('rebuilding', '正在后台恢复记忆索引，当前对话可继续')
    const run = Promise.resolve().then(() => this.rebuildMissingVectors(generation, controller.signal))
      .catch(() => { if (!controller.signal.aborted) this.publishIndex('failed', '记忆索引恢复失败，已完成部分保留，后续交流时重试') })
    this.reindexing = run
    void run.finally(() => {
      if (this.reindexing === run) this.reindexing = undefined
      if (this.indexController === controller) this.indexController = undefined
    })
  }

  private async rebuildMissingVectors(generation: number, signal: AbortSignal): Promise<void> {
    const deadline = Date.now() + 30_000
    let processed = 0
    for (const fact of this.active().filter((item) => !item.vector)) {
      if (signal.aborted || !this.recallOn || generation !== this.generation) return
      if (Date.now() >= deadline) {
        this.publishIndex('paused', '本轮索引恢复达到时间限额，已完成部分保留，后续交流时继续')
        return
      }
      if (!this.facts.some((item) => item.id === fact.id && !item.validUntil && !item.vector)) continue
      const work = Promise.resolve().then(() => embedLocally(fact.text, this.userDataDir))
      this.pendingIndexEmbedding = work
      const release = (): void => { if (this.pendingIndexEmbedding === work) this.pendingIndexEmbedding = undefined }
      void work.then(release, release)
      const outcome = await this.waitForIndex(work, Math.min(2_000, deadline - Date.now()), signal)
      if (signal.aborted || !this.recallOn || generation !== this.generation) return
      if (outcome.kind !== 'ready' || !outcome.vector) {
        this.publishIndex('failed', outcome.kind === 'timeout'
          ? '本地记忆索引计算超时，已完成部分保留；等待本地计算结束后可重试'
          : '本地记忆索引暂不可用，已完成部分保留，后续交流时重试')
        return
      }
      const current = this.facts.find((item) => item.id === fact.id && !item.validUntil && !item.vector)
      if (current) {
        try {
          this.db?.prepare(`UPDATE memories SET vector_json = ? WHERE id = ? AND valid_until IS NULL`).run(JSON.stringify(outcome.vector), current.id)
          current.vector = outcome.vector
        } catch {
          this.publishIndex('failed', '记忆索引保存失败，已完成部分保留，后续交流时重试')
          return
        }
        this.publishIndex('rebuilding', '正在后台恢复记忆索引，当前对话可继续')
      }
      processed++
      // Bound each CPU burst and let the event loop serve chat, deletion and UI.
      if (processed % 16 === 0) await new Promise<void>((done) => setTimeout(done, 0))
    }
    if (!signal.aborted) this.publishIndex('paused', '尚有待恢复的记忆索引，后续交流时继续')
  }

  private waitForIndex(work: Promise<number[] | null>, timeoutMs: number, signal: AbortSignal): Promise<
    { kind: 'ready'; vector: number[] | null } | { kind: 'failed' | 'timeout' | 'aborted' }
  > {
    return new Promise((resolve) => {
      const finish = (result: Awaited<ReturnType<MemoryService['waitForIndex']>>): void => {
        clearTimeout(timer)
        signal.removeEventListener('abort', abort)
        resolve(result)
      }
      const abort = (): void => finish({ kind: 'aborted' })
      const timer = setTimeout(() => finish({ kind: 'timeout' }), Math.max(0, timeoutMs))
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
      void work.then((vector) => finish({ kind: 'ready', vector }), () => finish({ kind: 'failed' }))
    })
  }

  async add(category: string, text: string): Promise<Result<MemoryEntry>> {
    const mapped = aliases[category.trim()]
    text = text.trim()
    if (!mapped || !text) return fail('记忆类别或内容无效')
    const generation = this.generation
    const key = normalizeKey(text)
    const version = this.factVersions.get(key)
    const vector = await embedLocally(text, this.userDataDir)
    if (generation !== this.generation) return fail('记忆已清除，请重新保存')
    if (version !== this.factVersions.get(key)) return fail('记忆已被更改，请刷新后重试')
    const suppressed = new Set(this.suppressed)
    suppressed.delete(normalizeKey(text))
    const next = applyMemoryAction(this.facts, { category: mapped, text }, 'ADD', new Date().toISOString(), suppressed)
      .map((fact) => !fact.validUntil && fact.normalizedKey === normalizeKey(text) ? { ...fact, vector } : fact)
    const created = next.find((fact) => !fact.validUntil && fact.normalizedKey === normalizeKey(text))
    return created && this.commit(next, suppressed) ? ok(toEntry(created)) : fail('保存失败，修改未完成')
  }

  async update(id: string, category: string, text: string): Promise<Result<MemoryEntry>> {
    const mapped = aliases[category.trim()]
    text = text.trim()
    const current = this.facts.find((fact) => fact.id === id && !fact.validUntil)
    if (!mapped || !text || !current) return fail('记忆条目不存在或内容无效')
    if (current.category === mapped && current.text === text) return ok(toEntry(current))
    const generation = this.generation
    const vector = await embedLocally(text, this.userDataDir)
    if (generation !== this.generation || !this.facts.some((fact) => fact.id === id && !fact.validUntil)) return fail('记忆已被更改，请刷新后重试')
    if (this.facts.some((fact) => fact.id !== id && !fact.validUntil && fact.normalizedKey === normalizeKey(text))) return fail('已有相同内容的记忆，请编辑该条目')
    const suppressed = new Set(this.suppressed)
    suppressed.add(current.normalizedKey)
    suppressed.delete(normalizeKey(text))
    const next = applyMemoryAction(this.facts, { category: mapped, text }, 'UPDATE', new Date().toISOString(), suppressed, id)
      .map((fact) => !fact.validUntil && fact.normalizedKey === normalizeKey(text) ? { ...fact, source: current.source, vector } : fact)
    const edited = next.find((fact) => !fact.validUntil && fact.normalizedKey === normalizeKey(text))
    return edited && this.commit(next, suppressed) ? ok(toEntry(edited)) : fail('保存失败，修改未完成')
  }

  async delete(id: string): Promise<Result<string>> {
    const current = this.facts.find((fact) => fact.id === id && !fact.validUntil)
    if (!current) return fail('记忆条目不存在')
    const suppressed = new Set(this.suppressed).add(current.normalizedKey)
    const next = applyMemoryAction(this.facts, current, 'DELETE', new Date().toISOString(), suppressed, id)
    return this.commit(next, suppressed) ? ok(id) : fail('保存失败，修改未完成')
  }

  async clear(): Promise<Result<MemoryEntry[]>> {
    this.generation++
    this.cancelIndex('记忆已清除，索引恢复已停止')
    const now = new Date().toISOString()
    const suppressed = new Set(this.suppressed)
    const next = this.facts.map((fact) => {
      if (fact.validUntil) return fact
      suppressed.add(fact.normalizedKey)
      return { ...fact, validUntil: now, updatedAt: now }
    })
    return this.commit(next, suppressed) ? ok(this.list()) : fail('保存失败，修改未完成')
  }

  ingest(text: string): MemoryFact[] {
    if (!this.extractionOn) return this.active()
    const outcome = runExtraction(text, this.facts, this.suppressed)
    if (!outcome.failed) this.commit(outcome.facts)
    return this.active()
  }

  async ingestJudged(
    text: string,
    judge: (candidate: { category: MemoryCategory; text: string }) => Promise<'ADD' | 'UPDATE' | 'DELETE' | 'NOOP'>,
    source = '长期记忆'
  ): Promise<MemoryExtractionOutcome> {
    return this.ingestProposed(text, async () => {
      const proposals: ProposedMemory[] = []
      for (const candidate of extractCandidates(text)) {
        const action = await judge(candidate)
        if (action !== 'NOOP') proposals.push({ ...candidate, action })
      }
      return proposals
    }, source)
  }

  async ingestProposed(
    text: string,
    propose: (text: string, known: string[]) => Promise<ProposedMemory[]>,
    source = '长期记忆'
  ): Promise<MemoryExtractionOutcome> {
    const generation = this.generation
    const sourceVersion = this.sourceVersions.get(source) ?? 0
    // Named sources are conversation timelines. Keep their judgments in turn order,
    // while independent sources and legacy unscoped work can still run concurrently.
    if (source === '长期记忆') return this.applyProposed(text, propose, source, generation, sourceVersion)
    const previous = this.extractionQueues.get(source) ?? Promise.resolve()
    const run = previous.then(() => this.applyProposed(text, propose, source, generation, sourceVersion))
    const settled = run.then(() => undefined, () => undefined)
    this.extractionQueues.set(source, settled)
    try { return await run } finally {
      if (this.extractionQueues.get(source) === settled) this.extractionQueues.delete(source)
    }
  }

  private async applyProposed(
    text: string,
    propose: (text: string, known: string[]) => Promise<ProposedMemory[]>,
    source: string,
    generation: number,
    sourceVersion: number
  ): Promise<MemoryExtractionOutcome> {
    if (!this.extractionOn || this.deletedSources.has(source)) return { status: 'skipped', reason: '记忆提取已停用或来源已删除' }
    if (generation !== this.generation || sourceVersion !== (this.sourceVersions.get(source) ?? 0)) return { status: 'skipped', reason: '数据已清除或提取已停用' }
    const snapshot = this.active()
    try {
      const proposals = await propose(text, snapshot.map((fact) => fact.text))
      // Slow external work runs outside the commit; a stale snapshot never replaces current state.
      const indexed = await Promise.all(proposals.filter((proposal) => (
        ['ADD', 'UPDATE', 'DELETE'].includes(proposal.action)
        && Boolean(labels[proposal.category]) && proposal.text?.trim() && safeCandidate(proposal.text)
      )).map(async (proposal) => ({ ...proposal, text: proposal.text.trim(), vector: proposal.action === 'DELETE' ? null : await embedLocally(proposal.text, this.userDataDir) })))
      if (!this.extractionOn || generation !== this.generation || this.deletedSources.has(source)
        || sourceVersion !== (this.sourceVersions.get(source) ?? 0)) return { status: 'skipped', reason: '数据已清除、停用或来源已删除' }
      let next = this.facts
      const now = new Date().toISOString()
      const suppressed = new Set(this.suppressed)
      for (const proposal of indexed) {
        const targetKey = normalizeKey(proposal.replaces ?? proposal.text)
        const target = snapshot.find((fact) => fact.id === proposal.replaces || fact.normalizedKey === targetKey)
        if (proposal.action !== 'ADD' && (!target || !next.some((fact) => fact.id === target.id && !fact.validUntil))) continue
        if (proposal.action === 'ADD' && suppressed.has(normalizeKey(proposal.text))) continue
        if (proposal.action === 'ADD' && target && !next.some((fact) => fact.id === target.id && !fact.validUntil)) continue
        if (proposal.action === 'UPDATE' && target?.category === proposal.category && target.text === proposal.text) continue
        const duplicate = proposal.action === 'UPDATE' && next.some((fact) => !fact.validUntil
          && fact.id !== target?.id && fact.normalizedKey === normalizeKey(proposal.text))
        const beforeIds = new Set(next.map((fact) => fact.id))
        const applied = applyMemoryAction(next, proposal, duplicate ? 'DELETE' : proposal.action, now, suppressed, target?.id)
        if (applied === next) continue
        next = applied
        // A natural correction expires its old version; only an explicit deletion
        // must prevent that fact from ever being extracted again (D-04 / D-21).
        if (proposal.action === 'DELETE' && target) suppressed.add(target.normalizedKey)
        // A new fact version belongs to the conversation that supplied it.
        // Unscoped legacy extraction has no new provenance to replace a known one.
        const factSource = source === '长期记忆' ? target?.source ?? source : source
        next = next.map((fact) => beforeIds.has(fact.id) ? fact : { ...fact, source: factSource, vector: proposal.vector })
      }
      if (next === this.facts) return { status: 'unchanged' }
      return this.commit(next, suppressed) ? { status: 'saved' } : { status: 'failed', reason: '记忆保存失败' }
    } catch {
      return { status: 'failed', reason: '记忆提取失败，已有记忆未更改' }
    }
  }

  async clearSource(source: string): Promise<Result<MemoryEntry[]>> {
    const now = new Date().toISOString()
    const suppressed = new Set(this.suppressed)
    const next = this.facts.map((fact) => {
      if (fact.source !== source || fact.validUntil) return fact
      suppressed.add(fact.normalizedKey)
      return { ...fact, validUntil: now, updatedAt: now }
    })
    // Clearing memories keeps the conversation usable. Cancel only work queued
    // before this clear; permanent source invalidation belongs to history deletion.
    const version = this.sourceVersions.get(source) ?? 0
    this.sourceVersions.set(source, version + 1)
    if (this.commit(next, suppressed)) return ok(this.list())
    this.sourceVersions.set(source, version)
    return fail('保存失败，修改未完成')
  }

  private commit(next: MemoryFact[], suppressed = this.suppressed): boolean {
    if (!this.storageReady) return false
    if (!this.persist(next, suppressed)) return false
    const before = new Map(activeMemories(this.facts).map((fact) => [fact.normalizedKey, fact.id]))
    const after = new Map(activeMemories(next).map((fact) => [fact.normalizedKey, fact.id]))
    for (const key of new Set([...before.keys(), ...after.keys()])) {
      if (before.get(key) !== after.get(key)) this.factVersions.set(key, (this.factVersions.get(key) ?? 0) + 1)
    }
    this.facts = next
    this.suppressed = suppressed
    if ([...before].some(([key, id]) => after.get(key) !== id)) this.cancelIndex('记忆条目已更改，旧索引恢复已停止')
    else this.publishIndex(this.index.state === 'rebuilding' ? 'rebuilding' : 'paused', '记忆索引尚未完整，后续交流时在后台恢复')
    this.notify()
    return true
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try { listener() } catch { /* Observers cannot roll back committed writes. */ }
    }
  }

  private load(): void {
    if (!this.db) return
    try {
      const rows = this.db.prepare(
        `SELECT id, category, text, source, normalized_key, valid_until, emotion, vector_json, created_at, updated_at FROM memories`
      ).all() as Array<{ id: string; category: MemoryCategory; text: string; source: string | null; normalized_key: string | null; valid_until: string | null; emotion: string | null; vector_json: string | null; created_at: string; updated_at: string }>
      this.facts = rows.map((row) => ({
        id: row.id, category: row.category, text: row.text, normalizedKey: normalizeKey(row.text),
        validUntil: row.valid_until, emotion: row.emotion ?? 'neutral', source: row.source ?? undefined,
        vector: readVector(row.vector_json), createdAt: row.created_at, updatedAt: row.updated_at
      }))
      const suppressed = this.db.prepare(`SELECT normalized_key FROM suppressed_facts`).all() as Array<{ normalized_key: string }>
      suppressed.forEach((row) => this.suppressed.add(row.normalized_key))
      this.alignEmbeddingStamp()
    } catch {
      // A failed load must never become an empty snapshot that overwrites the DB.
      this.storageReady = false
      this.facts = this.facts.map((fact) => ({ ...fact, vector: null }))
    }
  }

  private alignEmbeddingStamp(): void {
    if (!this.db) return
    const stamp = `${EMBEDDING_MODEL_ID}:${EMBEDDING_DIM}:${EMBEDDING_PROFILE}`
    const row = this.db.prepare(`SELECT value FROM meta WHERE key = 'embedding'`).get() as { value: string } | undefined
    const [modelId, dim, profile] = (row?.value ?? '').split(':')
    if (!row || vectorsCompatible(modelId, Number(dim), profile) === 'recompute') {
      this.facts = this.facts.map((fact) => ({ ...fact, vector: null }))
      const db = this.db
      db.transaction(() => {
        db.prepare(`UPDATE memories SET vector_json = NULL`).run()
        db.prepare(`INSERT INTO meta(key, value) VALUES('embedding', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(stamp)
      })()
    }
  }

  private persist(facts: MemoryFact[], suppressed: ReadonlySet<string>): boolean {
    if (!this.db) return true
    const db = this.db
    try {
      db.transaction(() => {
        db.prepare(`DELETE FROM memories`).run()
        const insert = db.prepare(
          `INSERT INTO memories(id, category, text, source, created_at, updated_at, valid_from, valid_until, emotion, normalized_key, vector_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        const now = new Date().toISOString()
        for (const fact of facts) {
          insert.run(fact.id, fact.category, fact.text, fact.source ?? '长期记忆', fact.createdAt ?? now, fact.updatedAt ?? now, fact.createdAt ?? now, fact.validUntil, fact.emotion, fact.normalizedKey, fact.vector ? JSON.stringify(fact.vector) : null)
        }
        db.prepare(`DELETE FROM suppressed_facts`).run()
        const suppress = db.prepare(`INSERT INTO suppressed_facts(normalized_key, created_at) VALUES (?, ?)`)
        for (const key of suppressed) suppress.run(key, now)
      })()
      return true
    } catch { return false }
  }
}
