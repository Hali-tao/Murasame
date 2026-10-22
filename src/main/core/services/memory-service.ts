import type { SqliteDatabase } from '../../data/sqlite-types'
import { runExtraction, runExtractionAsync, runModelExtraction, type ProposedMemory } from '../../agent/memory-extractor'
import { recallMemories, embedLocally, EMBEDDING_DIM, EMBEDDING_MODEL_ID, vectorsCompatible } from '../../local/embedding'
import { activeMemories, applyMemoryAction, normalizeKey, type MemoryCategory, type MemoryFact } from '../../memory/facts'
import type { MemoryEntry, Result } from '../../../shared/types'

const ok = <T>(data: T): Result<T> => ({ ok: true, data })
const fail = <T>(error: string): Result<T> => ({ ok: false, error })

const labels: Record<MemoryCategory, string> = {
  user: '偏好',
  feedback: '反馈',
  project: '项目',
  reference: '参考'
}

const aliases: Record<string, MemoryCategory> = {
  user: 'user',
  feedback: 'feedback',
  project: 'project',
  reference: 'reference',
  偏好: 'user',
  用户: 'user',
  反馈: 'feedback',
  项目: 'project',
  参考: 'reference'
}

function toEntry(fact: MemoryFact): MemoryEntry {
  return {
    id: fact.id,
    category: labels[fact.category],
    text: fact.text,
    source: fact.validUntil ? `失效于 ${fact.validUntil}，仍可追溯` : '长期记忆',
    updated: fact.validUntil ? '已失效' : '有效'
  }
}

export class MemoryService {
  private facts: MemoryFact[] = []
  private suppressed = new Set<string>()
  enabled = true

  constructor(private readonly db?: SqliteDatabase) {
    this.load()
  }

  list(): MemoryEntry[] {
    return this.facts.map(toEntry)
  }

  active(): MemoryFact[] {
    return activeMemories(this.facts)
  }

  async recall(query: string): Promise<{ text: string; ids: string[]; degraded: boolean }> {
    if (!this.enabled) return { text: '', ids: [], degraded: true }
    const queryVector = await embedLocally(query)
    const entries = this.active().map((fact) => ({
      id: fact.id,
      text: fact.text,
      category: fact.category,
      vector: fact.vector ?? null
    }))
    const result = recallMemories(query, entries, queryVector)
    return {
      text: result.injected.map((item) => item.text).join('\n'),
      ids: result.ids,
      degraded: result.degraded
    }
  }

  async add(category: string, text: string): Promise<Result<MemoryEntry>> {
    const mapped = aliases[category.trim()]
    if (!mapped) return fail('记忆类别无效')
    const written = this.write(mapped, text, 'ADD')
    if (!written.ok) return written
    const before = this.facts.map((item) => ({ ...item }))
    this.facts = await this.fillMissing(this.facts)
    if (!this.persist()) {
      this.facts = before
      return fail('保存失败，修改未完成')
    }
    const created = this.facts.find((item) => item.normalizedKey === normalizeKey(text) && !item.validUntil)
    return created ? ok(toEntry(created)) : written
  }

  update(id: string, category: string, text: string): Promise<Result<MemoryEntry>> {
    const mapped = aliases[category.trim()]
    const current = this.facts.find((item) => item.id === id && !item.validUntil)
    if (!mapped || !current) return Promise.resolve(fail('记忆条目不存在'))
    const before = this.facts.map((item) => ({ ...item }))
    const now = new Date().toISOString()
    this.facts = applyMemoryAction(this.facts, { category: current.category, text: current.text }, 'DELETE', now, this.suppressed)
    this.facts = applyMemoryAction(this.facts, { category: mapped, text }, 'ADD', now, this.suppressed)
    if (!this.persist()) {
      this.facts = before
      return Promise.resolve(fail('保存失败，修改未完成'))
    }
    const next = this.facts.find((item) => item.normalizedKey === normalizeKey(text) && !item.validUntil)
    if (!next) return Promise.resolve(fail('保存失败，修改未完成'))
    return Promise.resolve(ok(toEntry(next)))
  }

  delete(id: string): Promise<Result<string>> {
    const current = this.facts.find((item) => item.id === id && !item.validUntil)
    if (!current) return Promise.resolve(fail('记忆条目不存在'))
    const before = this.facts.map((item) => ({ ...item }))
    const suppressedBefore = new Set(this.suppressed)
    const now = new Date().toISOString()
    this.facts = applyMemoryAction(this.facts, { category: current.category, text: current.text }, 'DELETE', now, this.suppressed)
    this.suppressed.add(current.normalizedKey)
    if (!this.persist()) {
      this.facts = before
      this.suppressed = suppressedBefore
      return Promise.resolve(fail('保存失败，修改未完成'))
    }
    return Promise.resolve(ok(id))
  }

  clear(): Promise<Result<MemoryEntry[]>> {
    const before = this.facts.map((item) => ({ ...item }))
    const suppressedBefore = new Set(this.suppressed)
    const now = new Date().toISOString()
    const current = this.active()
    for (const item of current) {
      this.facts = applyMemoryAction(this.facts, item, 'DELETE', now, this.suppressed)
      this.suppressed.add(item.normalizedKey)
    }
    if (!this.persist()) {
      this.facts = before
      this.suppressed = suppressedBefore
      return Promise.resolve(fail('保存失败，修改未完成'))
    }
    return Promise.resolve(ok(this.list()))
  }

  ingest(text: string): MemoryFact[] {
    if (!this.enabled) return this.facts
    const outcome = runExtraction(text, this.facts, this.suppressed)
    if (outcome.failed) return this.facts
    const before = this.facts
    this.facts = outcome.facts
    if (!this.persist()) this.facts = before
    return this.facts
  }

  async ingestJudged(
    text: string,
    judge: (candidate: { category: MemoryCategory; text: string }) => Promise<'ADD' | 'UPDATE' | 'DELETE' | 'NOOP'>,
    source = '长期记忆'
  ): Promise<void> {
    if (!this.enabled) return
    const beforeIds = new Set(this.facts.map((item) => item.id))
    const outcome = await runExtractionAsync(text, this.facts, this.suppressed, judge)
    if (outcome.failed) return
    const before = this.facts
    const tagged = outcome.facts.map((fact) => beforeIds.has(fact.id) || fact.source ? fact : { ...fact, source })
    this.facts = await this.fillMissing(tagged)
    if (!this.persist()) this.facts = before
  }

  async ingestProposed(
    text: string,
    propose: (text: string, known: string[]) => Promise<ProposedMemory[]>,
    source = '长期记忆'
  ): Promise<void> {
    if (!this.enabled) return
    const beforeIds = new Set(this.facts.map((item) => item.id))
    const outcome = await runModelExtraction(text, this.facts, this.suppressed, propose)
    if (outcome.failed) return
    const before = this.facts
    const tagged = outcome.facts.map((fact) => beforeIds.has(fact.id) || fact.source ? fact : { ...fact, source })
    this.facts = await this.fillMissing(tagged)
    if (!this.persist()) this.facts = before
  }

  clearSource(source: string): Promise<Result<MemoryEntry[]>> {
    const before = this.facts.map((item) => ({ ...item }))
    const suppressedBefore = new Set(this.suppressed)
    const now = new Date().toISOString()
    const linked = this.active().filter((item) => item.source === source)
    for (const item of linked) {
      this.facts = applyMemoryAction(this.facts, { category: item.category, text: item.text }, 'DELETE', now, this.suppressed)
      this.suppressed.add(item.normalizedKey)
    }
    if (!this.persist()) {
      this.facts = before
      this.suppressed = suppressedBefore
      return Promise.resolve(fail('保存失败，修改未完成'))
    }
    return Promise.resolve(ok(this.list()))
  }

  private async fillMissing(facts: MemoryFact[]): Promise<MemoryFact[]> {
    const next: MemoryFact[] = []
    for (const fact of facts) {
      if (fact.validUntil || fact.vector?.length === EMBEDDING_DIM) {
        next.push(fact)
        continue
      }
      next.push({ ...fact, vector: await embedLocally(fact.text) })
    }
    return next
  }

  private write(category: MemoryCategory, text: string, action: 'ADD'): Result<MemoryEntry> {
    const before = this.facts.map((item) => ({ ...item }))
    this.facts = applyMemoryAction(this.facts, { category, text }, action, new Date().toISOString(), this.suppressed)
    const created = this.facts.find((item) => item.normalizedKey === normalizeKey(text) && !item.validUntil)
    if (!created || !this.persist()) {
      this.facts = before
      return fail('保存失败，修改未完成')
    }
    return ok(toEntry(created))
  }

  private load(): void {
    if (!this.db) return
    try {
      const rows = this.db.prepare(
        `SELECT id, category, text, source, normalized_key, valid_until, emotion, vector_json FROM memories`
      ).all() as Array<{ id: string; category: MemoryCategory; text: string; source: string | null; normalized_key: string | null; valid_until: string | null; emotion: string | null; vector_json: string | null }>
      this.facts = rows.map((row) => ({
        id: row.id,
        category: row.category,
        text: row.text,
        normalizedKey: row.normalized_key || normalizeKey(row.text),
        validUntil: row.valid_until,
        emotion: row.emotion ?? 'neutral',
        source: row.source ?? undefined,
        vector: row.vector_json ? JSON.parse(row.vector_json) as number[] : null
      }))
      const suppressed = this.db.prepare(`SELECT normalized_key FROM suppressed_facts`).all() as Array<{ normalized_key: string }>
      suppressed.forEach((row) => this.suppressed.add(row.normalized_key))
      this.alignEmbeddingStamp()
    } catch {
      this.facts = []
    }
  }

  private alignEmbeddingStamp(): void {
    if (!this.db) return
    const stamp = `${EMBEDDING_MODEL_ID}:${EMBEDDING_DIM}`
    const row = this.db.prepare(`SELECT value FROM meta WHERE key = 'embedding'`).get() as { value: string } | undefined
    const [modelId, dim] = (row?.value ?? '').split(':')
    if (!row || vectorsCompatible(modelId, Number(dim)) === 'recompute') {
      this.facts = this.facts.map((fact) => ({ ...fact, vector: null }))
    }
    this.db.prepare(
      `INSERT INTO meta(key, value) VALUES('embedding', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run(stamp)
  }

  private persist(): boolean {
    if (!this.db) return true
    try {
      this.db.prepare(`DELETE FROM memories`).run()
      const insert = this.db.prepare(
        `INSERT INTO memories(id, category, text, source, created_at, updated_at, valid_from, valid_until, emotion, normalized_key, vector_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      const now = new Date().toISOString()
      for (const fact of this.facts) {
        insert.run(fact.id, fact.category, fact.text, fact.source ?? '长期记忆', now, now, now, fact.validUntil, fact.emotion, fact.normalizedKey, fact.vector ? JSON.stringify(fact.vector) : null)
      }
      this.db.prepare(`DELETE FROM suppressed_facts`).run()
      const suppress = this.db.prepare(`INSERT INTO suppressed_facts(normalized_key, created_at) VALUES (?, ?)`)
      for (const key of this.suppressed) suppress.run(key, now)
      return true
    } catch {
      return false
    }
  }
}
