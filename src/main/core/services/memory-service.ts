import type { SqliteDatabase } from '../../data/sqlite-types'
import { runExtraction, type ProposedMemory } from '../../agent/memory-extractor'
import { recallMemories, embedLocally, EMBEDDING_DIM, EMBEDDING_MODEL_ID, vectorsCompatible } from '../../local/embedding'
import { activeMemories, applyMemoryAction, extractCandidates, normalizeKey, safeCandidate, type MemoryCategory, type MemoryFact } from '../../memory/facts'
import type { MemoryEntry, Result } from '../../../shared/types'

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

export interface MemoryExtractionOutcome {
  status: 'saved' | 'unchanged' | 'skipped' | 'failed'
  reason?: string
}

export class MemoryService {
  private facts: MemoryFact[] = []
  private suppressed = new Set<string>()
  private generation = 0
  private deletedSources = new Set<string>()
  private listeners = new Set<() => void>()
  private recallOn = true
  private extractionOn = true

  constructor(private readonly db?: SqliteDatabase, private readonly userDataDir = '') { this.load() }

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
    if (changed) this.notify()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  invalidateSource(source: string): void { this.deletedSources.add(source) }
  list(): MemoryEntry[] { return this.active().map(toEntry) }
  history(): MemoryEntry[] { return this.facts.map(toEntry) }
  active(): MemoryFact[] { return structuredClone(activeMemories(this.facts)) }

  async recall(query: string): Promise<{ text: string; ids: string[]; degraded: boolean }> {
    if (!this.recallOn) return { text: '', ids: [], degraded: false }
    const generation = this.generation
    const queryVector = await embedLocally(query, this.userDataDir)
    if (!this.recallOn || generation !== this.generation) return { text: '', ids: [], degraded: false }
    const result = recallMemories(query, this.active().map((fact) => ({
      id: fact.id, text: fact.text, category: fact.category, vector: fact.vector ?? null
    })), queryVector)
    return { text: result.injected.map((item) => item.text).join('\n'), ids: result.ids, degraded: result.degraded }
  }

  async add(category: string, text: string): Promise<Result<MemoryEntry>> {
    const mapped = aliases[category.trim()]
    text = text.trim()
    if (!mapped || !text) return fail('记忆类别或内容无效')
    const generation = this.generation
    const vector = await embedLocally(text, this.userDataDir)
    if (generation !== this.generation) return fail('记忆已清除，请重新保存')
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
    if (!this.extractionOn || this.deletedSources.has(source)) return { status: 'skipped', reason: '记忆提取已停用或来源已删除' }
    const generation = this.generation
    const snapshot = this.active()
    try {
      const proposals = await propose(text, snapshot.map((fact) => fact.text))
      // Slow external work runs outside the commit; a stale snapshot never replaces current state.
      const indexed = await Promise.all(proposals.filter((proposal) => (
        ['ADD', 'UPDATE', 'DELETE'].includes(proposal.action)
        && Boolean(labels[proposal.category]) && proposal.text?.trim() && safeCandidate(proposal.text)
      )).map(async (proposal) => ({ ...proposal, text: proposal.text.trim(), vector: proposal.action === 'DELETE' ? null : await embedLocally(proposal.text, this.userDataDir) })))
      if (!this.extractionOn || generation !== this.generation || this.deletedSources.has(source)) return { status: 'skipped', reason: '数据已清除、停用或来源已删除' }
      let next = this.facts
      const now = new Date().toISOString()
      const suppressed = new Set(this.suppressed)
      for (const proposal of indexed) {
        const targetKey = normalizeKey(proposal.replaces ?? proposal.text)
        const target = snapshot.find((fact) => fact.id === proposal.replaces || fact.normalizedKey === targetKey)
        if (proposal.action !== 'ADD' && (!target || !next.some((fact) => fact.id === target.id && !fact.validUntil))) continue
        if (proposal.action === 'ADD' && suppressed.has(normalizeKey(proposal.text))) continue
        const beforeIds = new Set(next.map((fact) => fact.id))
        next = applyMemoryAction(next, proposal, proposal.action, now, suppressed, target?.id)
        if (proposal.action !== 'ADD' && target) suppressed.add(target.normalizedKey)
        next = next.map((fact) => beforeIds.has(fact.id) ? fact : { ...fact, source: target?.source ?? source, vector: proposal.vector })
      }
      if (next === this.facts) return { status: 'unchanged' }
      return this.commit(next, suppressed) ? { status: 'saved' } : { status: 'failed', reason: '记忆保存失败' }
    } catch {
      return { status: 'failed', reason: '记忆提取失败，已有记忆未更改' }
    }
  }

  async clearSource(source: string): Promise<Result<MemoryEntry[]>> {
    this.invalidateSource(source)
    const now = new Date().toISOString()
    const suppressed = new Set(this.suppressed)
    const next = this.facts.map((fact) => {
      if (fact.source !== source || fact.validUntil) return fact
      suppressed.add(fact.normalizedKey)
      return { ...fact, validUntil: now, updatedAt: now }
    })
    return this.commit(next, suppressed) ? ok(this.list()) : fail('保存失败，修改未完成')
  }

  private commit(next: MemoryFact[], suppressed = this.suppressed): boolean {
    if (!this.persist(next, suppressed)) return false
    this.facts = next
    this.suppressed = suppressed
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
        id: row.id, category: row.category, text: row.text, normalizedKey: row.normalized_key || normalizeKey(row.text),
        validUntil: row.valid_until, emotion: row.emotion ?? 'neutral', source: row.source ?? undefined,
        vector: row.vector_json ? JSON.parse(row.vector_json) as number[] : null, createdAt: row.created_at, updatedAt: row.updated_at
      }))
      const suppressed = this.db.prepare(`SELECT normalized_key FROM suppressed_facts`).all() as Array<{ normalized_key: string }>
      suppressed.forEach((row) => this.suppressed.add(row.normalized_key))
      this.alignEmbeddingStamp()
    } catch { this.facts = [] }
  }

  private alignEmbeddingStamp(): void {
    if (!this.db) return
    const stamp = `${EMBEDDING_MODEL_ID}:${EMBEDDING_DIM}`
    const row = this.db.prepare(`SELECT value FROM meta WHERE key = 'embedding'`).get() as { value: string } | undefined
    const [modelId, dim] = (row?.value ?? '').split(':')
    if (!row || vectorsCompatible(modelId, Number(dim)) === 'recompute') this.facts = this.facts.map((fact) => ({ ...fact, vector: null }))
    this.db.prepare(`INSERT INTO meta(key, value) VALUES('embedding', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(stamp)
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
