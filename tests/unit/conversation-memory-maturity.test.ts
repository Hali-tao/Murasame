import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { SqliteDatabase } from '../../src/main/data/sqlite-types'
import { MemoryService } from '../../src/main/core/services/memory-service'
import { ConversationService } from '../../src/main/core/services/conversation-service'
import type { ProposedMemory } from '../../src/main/agent/memory-extractor'
import type { ResolvedModel } from '../../src/main/model/types'

const embedding = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<number[] | null>>())
vi.mock('../../src/main/local/embedding', async (original) => ({
  ...await original<typeof import('../../src/main/local/embedding')>(), embedLocally: embedding
}))

const resources: Array<{ raw: DatabaseSync; dir: string }> = []
function database(): SqliteDatabase {
  const dir = mkdtempSync(join(tmpdir(), 'murasame-memory-maturity-'))
  const raw = new DatabaseSync(join(dir, 'synthetic.sqlite'))
  resources.push({ raw, dir })
  for (const name of ['001_init.sql', '002_memory.sql', '003_trace.sql']) {
    raw.exec(readFileSync(resolve('src/main/data/migrations', name), 'utf8'))
  }
  return {
    prepare: (sql) => raw.prepare(sql) as unknown as ReturnType<SqliteDatabase['prepare']>,
    exec(sql) { raw.exec(sql); return this },
    pragma(sql) { return raw.prepare(`PRAGMA ${sql}`).get() },
    transaction: (job) => () => {
      raw.exec('BEGIN')
      try { const result = job(); raw.exec('COMMIT'); return result } catch (error) { raw.exec('ROLLBACK'); throw error }
    },
    close: () => raw.close()
  }
}
function deferred<T>() {
  let release!: (value: T) => void
  const promise = new Promise<T>((done) => { release = done })
  return { promise, release }
}
const vector = () => [1, ...Array<number>(511).fill(0)]
const proposal = (text: string): ProposedMemory => ({ action: 'ADD', category: 'user', text })
const models = {
  getDefault: () => ({ id: 'synthetic', model: 'controlled', endpoint: 'https://unused.invalid' }) as ResolvedModel,
  markOffline: () => {}, markVerified: () => {}
}

beforeEach(() => { embedding.mockReset(); embedding.mockImplementation(async () => vector()) })
afterEach(() => {
  vi.useRealTimers()
  for (const { raw, dir } of resources.splice(0)) {
    raw.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('memory maturity across turns and restarts', () => {
  it('[FR-15] clearing a source cancels older queued extraction but accepts future new facts without reviving deleted facts', async () => {
    const db = database(); const memory = new MemoryService(db)
    await memory.ingestProposed('旧偏好', async () => [proposal('喜欢绿茶')], 'source-chat')
    const pending = deferred<ProposedMemory[]>()
    const started = deferred<void>()
    const old = memory.ingestProposed('清除前的消息', () => { started.release(); return pending.promise }, 'source-chat')
    await started.promise
    const queuedJudge = vi.fn(async () => [proposal('旧排队项目')])
    const queued = memory.ingestProposed('旧排队消息', queuedJudge, 'source-chat')
    expect((await memory.clearSource('source-chat')).ok).toBe(true)
    const future = memory.ingestProposed('清除后的新消息', async () => [proposal('喜欢绿茶'), proposal('项目白桦')], 'source-chat')
    pending.release([proposal('不应回来的迟到事实')])
    expect((await old).status).toBe('skipped')
    expect((await queued).status).toBe('skipped')
    expect(queuedJudge).not.toHaveBeenCalled()
    expect((await future).status).toBe('saved')
    expect(new MemoryService(db).list().map(fact => fact.text)).toEqual(['项目白桦'])
  })

  it('[NFR-R02] a failed source clear preserves facts and does not disable pending or later extraction', async () => {
    const db = database(); const memory = new MemoryService(db)
    await memory.ingestProposed('旧偏好', async () => [proposal('喜欢绿茶')], 'source-chat')
    const pending = deferred<ProposedMemory[]>()
    const started = deferred<void>()
    const old = memory.ingestProposed('等待中的消息', () => { started.release(); return pending.promise }, 'source-chat')
    await started.promise
    db.exec("CREATE TRIGGER block_clear BEFORE DELETE ON memories BEGIN SELECT RAISE(ABORT, 'synthetic write failure'); END")
    expect((await memory.clearSource('source-chat')).ok).toBe(false)
    expect(new MemoryService(db).list().map(fact => fact.text)).toEqual(['喜欢绿茶'])
    db.exec('DROP TRIGGER block_clear')
    pending.release([proposal('喜欢白茶')])
    expect((await old).status).toBe('saved')
    expect((await memory.ingestProposed('下一轮', async () => [proposal('项目白桦')], 'source-chat')).status).toBe('saved')
    expect(new MemoryService(db).list().map(fact => fact.text).sort()).toEqual(['喜欢白茶', '喜欢绿茶', '项目白桦'])
  })

  it('[NFR-P02] a gated background fact embedding does not hold the current chat response', async () => {
    const db = database(); const memory = new MemoryService(db)
    embedding.mockResolvedValueOnce(null)
    await memory.add('user', '喜欢白茶')
    const slow = deferred<number[]>()
    embedding.mockImplementation(async (text) => text === '喜欢白茶' ? slow.promise : vector())
    const service = new ConversationService(db, models, { chat: async () => '当前对话可以继续。' }, {
      memoryEnabled: () => true, recall: (query) => memory.recall(query)
    })
    const chat = service.create()
    let settled = false
    const sending = service.send(chat.id, '解释一下').then((result) => { settled = true; return result })
    try {
      for (let step = 0; step < 20; step++) await Promise.resolve()
      expect(settled).toBe(true)
      expect(service.list()[0].messages.at(-1)?.text).toBe('当前对话可以继续。')
    } finally {
      slow.release(vector())
      await sending
      await vi.waitFor(() => expect(memory.indexStatus().state).toBe('idle'))
    }
  })

  it('[FR-14] later extraction in one conversation sees the earlier completed fact before judging a correction', async () => {
    const db = database(); const memory = new MemoryService(db)
    const first = deferred<ProposedMemory[]>()
    const started = deferred<void>()
    const a = memory.ingestProposed('最近喜欢绿茶', async () => { started.release(); return first.promise }, 'conversation-tea')
    await started.promise
    let knownAtCorrection: string[] = []
    const b = memory.ingestProposed('更正，现在喜欢白茶', async (_text, known) => {
      knownAtCorrection = known
      return known.includes('喜欢绿茶')
        ? [{ action: 'UPDATE', category: 'user', text: '喜欢白茶', replaces: '喜欢绿茶' }]
        : [proposal('喜欢白茶')]
    }, 'conversation-tea')
    first.release([proposal('喜欢绿茶')])
    await Promise.all([a, b])
    expect(knownAtCorrection).toEqual(['喜欢绿茶'])
    expect(new MemoryService(db).list().map((fact) => fact.text)).toEqual(['喜欢白茶'])
  })

  it('[UC-05] a naturally replaced preference can later return without being permanently suppressed', async () => {
    const db = database(); const memory = new MemoryService(db)
    await memory.ingestProposed('绿茶', async () => [proposal('喜欢绿茶')], 'conversation-tea')
    await memory.ingestProposed('改白茶', async () => [{ action: 'UPDATE', category: 'user', text: '喜欢白茶', replaces: '喜欢绿茶' }], 'conversation-tea')
    await memory.ingestProposed('恢复绿茶', async () => [{ action: 'UPDATE', category: 'user', text: '喜欢绿茶', replaces: '喜欢白茶' }], 'conversation-tea')
    expect(new MemoryService(db).list().map((fact) => fact.text)).toEqual(['喜欢绿茶'])
    expect(memory.history().filter((fact) => fact.updated === '已失效')).toHaveLength(2)
    expect(db.prepare('SELECT * FROM suppressed_facts').all()).toEqual([])
  })

  it('[NFR-R02] malformed vector JSON cannot hide valid facts or erase them on the next save', async () => {
    const db = database(); const memory = new MemoryService(db)
    await memory.add('user', '喜欢绿茶'); await memory.add('project', '项目白桦')
    db.prepare('UPDATE memories SET vector_json = ? WHERE text = ?').run('{broken', '喜欢绿茶')
    const reopened = new MemoryService(db)
    expect(reopened.list().map((fact) => fact.text).sort()).toEqual(['喜欢绿茶', '项目白桦'])
    expect(reopened.active().find((fact) => fact.text === '喜欢绿茶')?.vector).toBeNull()
    expect((await reopened.add('feedback', '回答简洁')).ok).toBe(true)
    expect(new MemoryService(db).list().map((fact) => fact.text).sort()).toEqual(['喜欢绿茶', '回答简洁', '项目白桦'])
  })

  it('[NFR-C02] incompatible embedding data stays invalidated across a second restart', async () => {
    const db = database(); const memory = new MemoryService(db)
    await memory.add('user', '喜欢绿茶')
    db.prepare('UPDATE meta SET value = ? WHERE key = ?').run('older-embedding:512', 'embedding')
    expect(new MemoryService(db).active()[0].vector).toBeNull()
    expect(new MemoryService(db).active()[0].vector).toBeNull()
    expect((db.prepare('SELECT vector_json FROM memories').get() as { vector_json: string | null }).vector_json).toBeNull()
  })

  it('[FR-15] a pending duplicate add cannot undo a newer deletion', async () => {
    const db = database(); const memory = new MemoryService(db)
    const added = await memory.add('user', '喜欢绿茶')
    if (!added.ok) throw new Error(added.error)
    const slow = deferred<number[]>()
    embedding.mockImplementationOnce(() => slow.promise)
    const pending = memory.add('user', '喜欢绿茶')
    expect((await memory.delete(added.data.id)).ok).toBe(true)
    slow.release(vector())
    await pending
    expect(new MemoryService(db).list()).toEqual([])
  })

  it('[UC-05] duplicate extraction reports unchanged and does not emit a saved event', async () => {
    const memory = new MemoryService(database())
    await memory.add('user', '喜欢绿茶')
    let events = 0
    memory.subscribe(() => { events++ })
    expect(await memory.ingestProposed('绿茶', async () => [proposal('喜欢绿茶')])).toEqual({ status: 'unchanged' })
    expect(events).toBe(0)
  })

  it('[FR-15] editing one fact to an existing fact does not create duplicate active memories', async () => {
    const db = database(); const memory = new MemoryService(db)
    const old = await memory.add('user', '喜欢绿茶')
    await memory.add('user', '喜欢白茶')
    if (!old.ok) throw new Error(old.error)
    const result = await memory.update(old.data.id, 'user', '喜欢白茶')
    expect(result.ok).toBe(false)
    expect(new MemoryService(db).list().map((fact) => fact.text).sort()).toEqual(['喜欢白茶', '喜欢绿茶'])
  })

  it('[NFR-C02] facts saved while local embeddings are unavailable become recallable after recovery', async () => {
    const db = database(); const memory = new MemoryService(db)
    embedding.mockResolvedValueOnce(null)
    const added = await memory.add('feedback', '对坚果过敏')
    if (!added.ok) throw new Error(added.error)
    expect(memory.active()[0].vector).toBeNull()
    const first = await memory.recall('晚饭怎么选')
    expect(first.degraded).toBe(true)
    await vi.waitFor(() => expect(memory.indexStatus().state).toBe('idle'))
    const recalled = await memory.recall('晚饭怎么选')
    expect(recalled.ids).toEqual([added.data.id])
    expect(new MemoryService(db).active()[0].vector).toEqual(vector())
  })

  it('[UC-05] a correction to an already known value expires the obsolete fact without duplicating the valid one', async () => {
    const db = database(); const memory = new MemoryService(db)
    await memory.ingestProposed('旧地点', async () => [proposal('住在上海')], 'source-old')
    await memory.ingestProposed('新地点', async () => [proposal('住在杭州')], 'source-new')
    const validId = memory.active().find((fact) => fact.text === '住在杭州')?.id
    await memory.ingestProposed('更正旧地点', async () => [{ action: 'UPDATE', category: 'user', text: '住在杭州', replaces: '住在上海' }], 'source-old')
    expect(new MemoryService(db).active().map(({ id, text, source }) => ({ id, text, source }))).toEqual([{ id: validId, text: '住在杭州', source: 'source-new' }])
  })

  it.each(['original', 'correction'] as const)('[FR-15] clearing the %s conversation respects where a corrected fact was learned', async (removed) => {
    const db = database(); const memory = new MemoryService(db)
    await memory.ingestProposed('最近喜欢绿茶', async () => [proposal('喜欢绿茶')], 'original-chat')
    await memory.ingestProposed('更正，现在喜欢白茶', async () => [
      { action: 'UPDATE', category: 'user', text: '喜欢白茶', replaces: '喜欢绿茶' }
    ], 'correction-chat')

    const reopened = new MemoryService(db)
    expect((await reopened.clearSource(`${removed}-chat`)).ok).toBe(true)
    const afterRestart = new MemoryService(db)
    if (removed === 'original') {
      expect(afterRestart.list().map(({ text, source }) => ({ text, source })))
        .toEqual([{ text: '喜欢白茶', source: 'correction-chat' }])
      expect((await afterRestart.recall('喜欢喝什么茶')).text).toContain('喜欢白茶')
    } else {
      expect(afterRestart.list()).toEqual([])
      expect((await afterRestart.recall('喜欢喝什么茶')).ids).toEqual([])
    }
  })

  it('[FR-14] a correction without a named conversation retains its known provenance', async () => {
    const db = database(); const memory = new MemoryService(db)
    await memory.ingestProposed('喜欢绿茶', async () => [proposal('喜欢绿茶')], 'original-chat')
    await memory.ingestProposed('改为白茶', async () => [
      { action: 'UPDATE', category: 'user', text: '喜欢白茶', replaces: '喜欢绿茶' }
    ])
    expect(new MemoryService(db).active()[0]).toMatchObject({ text: '喜欢白茶', source: 'original-chat' })
  })

  it.each(['{broken', '{}', 'null', '[1,2]', '["1"]', '[1e999]'])('[NFR-R02] isolates malformed vector payload %s from valid text', async (payload) => {
    const db = database(); const memory = new MemoryService(db)
    await memory.add('user', '喜欢白茶')
    db.prepare('UPDATE memories SET vector_json = ?').run(payload)
    const reopened = new MemoryService(db)
    expect(reopened.list()[0].text).toBe('喜欢白茶')
    expect(reopened.active()[0].vector).toBeNull()
  })

  it('[NFR-R02] a failed initial read cannot overwrite persistent facts with a partial snapshot', async () => {
    const db = database(); const memory = new MemoryService(db)
    await memory.add('user', '喜欢白茶')
    db.exec('ALTER TABLE suppressed_facts RENAME TO unavailable_suppression')
    const failedLoad = new MemoryService(db)
    db.exec('ALTER TABLE unavailable_suppression RENAME TO suppressed_facts')
    expect((await failedLoad.add('project', '不应保存的新项目')).ok).toBe(false)
    expect(new MemoryService(db).list().map((fact) => fact.text)).toEqual(['喜欢白茶'])
  })

  it('[FR-15] an inconsistent stored normalized key cannot bypass deletion suppression after restart', async () => {
    const db = database(); const memory = new MemoryService(db)
    const added = await memory.add('user', '喜欢白茶')
    if (!added.ok) throw new Error(added.error)
    db.prepare('UPDATE memories SET normalized_key = ? WHERE id = ?').run('incorrect-cache-key', added.data.id)
    const reopened = new MemoryService(db)
    await reopened.delete(added.data.id)
    await reopened.ingestProposed('旧偏好', async () => [proposal('喜欢白茶')])
    expect(new MemoryService(db).list()).toEqual([])
  })

  it('[NFR-R02] failed embedding stamp migration preserves facts and rolls back vector invalidation on disk', async () => {
    const db = database(); const memory = new MemoryService(db)
    await memory.add('user', '喜欢白茶')
    db.prepare('UPDATE meta SET value = ? WHERE key = ?').run('old-model:512', 'embedding')
    db.exec("CREATE TRIGGER block_stamp BEFORE UPDATE ON meta BEGIN SELECT RAISE(ABORT, 'synthetic migration failure'); END")
    const failedLoad = new MemoryService(db)
    expect(failedLoad.list()[0].text).toBe('喜欢白茶')
    expect(failedLoad.active()[0].vector).toBeNull()
    expect((await failedLoad.add('project', '不应保存的新项目')).ok).toBe(false)
    expect((db.prepare('SELECT vector_json FROM memories').get() as { vector_json: string }).vector_json).not.toBeNull()
    expect((db.prepare('SELECT value FROM meta WHERE key = ?').get('embedding') as { value: string }).value).toBe('old-model:512')
  })

  it('[NFR-C02] an unreadable model stamp cannot admit unverified vectors into semantic recall', async () => {
    const db = database(); const memory = new MemoryService(db)
    await memory.add('user', '喜欢白茶')
    db.exec('ALTER TABLE meta RENAME TO unavailable_meta')
    const reopened = new MemoryService(db)
    const recalled = await reopened.recall('排查网络错误')
    expect(recalled.ids).toEqual([])
    expect(recalled.degraded).toBe(true)
    expect(reopened.list()[0].text).toBe('喜欢白茶')
  })

  it.each(['clear', 'disable', 'source'] as const)('[FR-15] queued extraction is cancelled by %s before its model call starts', async (action) => {
    const memory = new MemoryService(database())
    const pending = deferred<ProposedMemory[]>()
    const started = deferred<void>()
    const first = memory.ingestProposed('第一句', async () => { started.release(); return pending.promise }, 'source-chat')
    await started.promise
    let secondCalled = false
    const second = memory.ingestProposed('第二句', async () => { secondCalled = true; return [proposal('迟到的第二条')] }, 'source-chat')
    if (action === 'clear') await memory.clear()
    else if (action === 'disable') {
      memory.configure({ recallEnabled: true, extractionEnabled: false })
      memory.configure({ recallEnabled: true, extractionEnabled: true })
    } else await memory.clearSource('source-chat')
    pending.release([proposal('迟到的第一条')])
    expect((await first).status).toBe('skipped')
    expect((await second).status).toBe('skipped')
    expect(secondCalled).toBe(false)
    expect(memory.list()).toEqual([])
  })

  it('[FR-14] separate conversation sources remain independent while one extraction is slow', async () => {
    const memory = new MemoryService(database())
    const pending = deferred<ProposedMemory[]>()
    const slow = memory.ingestProposed('第一会话', () => pending.promise, 'source-a')
    const fast = await memory.ingestProposed('第二会话', async () => [proposal('喜欢白茶')], 'source-b')
    expect(fast.status).toBe('saved')
    expect(memory.list().map((fact) => fact.text)).toEqual(['喜欢白茶'])
    pending.release([proposal('项目白桦')]); await slow
    expect(memory.list().map((fact) => fact.text).sort()).toEqual(['喜欢白茶', '项目白桦'])
  })

  it('[FR-15] local index recovery cannot revive a fact deleted while embedding it', async () => {
    const db = database(); const memory = new MemoryService(db)
    embedding.mockResolvedValueOnce(null)
    const added = await memory.add('user', '喜欢白茶')
    if (!added.ok) throw new Error(added.error)
    const slow = deferred<number[]>()
    const started = deferred<void>()
    embedding.mockImplementationOnce(async () => vector())
    embedding.mockImplementationOnce(() => { started.release(); return slow.promise })
    const recall = memory.recall('今天喝什么')
    await started.promise
    await memory.delete(added.data.id)
    slow.release(vector())
    expect((await recall).ids).toEqual([])
    expect(new MemoryService(db).list()).toEqual([])
  })

  it('[FR-15] explicit forget remains suppressed while natural corrections can return', async () => {
    const memory = new MemoryService(database())
    await memory.ingestProposed('记住', async () => [proposal('喜欢白茶')], 'source-a')
    await memory.ingestProposed('忘掉', async () => [{ action: 'DELETE', category: 'user', text: '喜欢白茶' }], 'source-a')
    expect((await memory.ingestProposed('旧重复', async () => [proposal('喜欢白茶')], 'source-a')).status).toBe('unchanged')
    expect(memory.list()).toEqual([])
    expect((await memory.add('user', '喜欢白茶')).ok).toBe(true)
    expect(memory.list().map((fact) => fact.text)).toEqual(['喜欢白茶'])
  })

  it('[UC-05] an unchanged UPDATE keeps the same fact and does not claim a save', async () => {
    const memory = new MemoryService(database())
    await memory.add('user', '喜欢白茶')
    const previous = memory.active()[0].id
    const outcome = await memory.ingestProposed('重复偏好', async () => [{ action: 'UPDATE', category: 'user', text: '喜欢白茶', replaces: '喜欢白茶' }])
    expect(outcome.status).toBe('unchanged')
    expect(memory.active()[0].id).toBe(previous)
    expect(memory.history()).toHaveLength(1)
  })
})

describe('bounded background memory indexing', () => {
  it('[FR-14] current recall uses available lexical facts while their semantic index is rebuilding', async () => {
    const memory = new MemoryService(database())
    embedding.mockResolvedValueOnce(null)
    const added = await memory.add('user', '喜欢白茶')
    if (!added.ok) throw new Error(added.error)
    const slow = deferred<number[]>()
    embedding.mockImplementation(async (text) => text === '喜欢白茶' ? slow.promise : vector())
    const recalled = await memory.recall('白茶')
    expect(recalled).toMatchObject({ ids: [added.data.id], text: '喜欢白茶', degraded: true })
    slow.release(vector())
    await vi.waitFor(() => expect(memory.indexStatus().state).toBe('idle'))
  })

  it('[NFR-P02] automatically continues beyond a batch and publishes progress without fact events', async () => {
    const db = database(); const memory = new MemoryService(db)
    embedding.mockResolvedValue(null)
    await memory.ingestProposed('synthetic bulk', async () => Array.from({ length: 35 }, (_, index) => proposal(`合成事实${index}`)))
    embedding.mockImplementation(async () => vector())
    const progress: Array<{ completed: number; total: number; state: string }> = []
    let factEvents = 0
    memory.subscribe(() => { factEvents++ })
    const unsubscribe = memory.subscribeIndex((status) => { progress.push(status) })
    const first = await memory.recall('查询')
    expect(first.degraded).toBe(true)
    await vi.waitFor(() => expect(memory.indexStatus()).toMatchObject({ state: 'idle', completed: 35, total: 35 }))
    expect(progress.some((status) => status.completed === 16 && status.state === 'rebuilding')).toBe(true)
    expect(progress.some((status) => status.completed === 32)).toBe(true)
    expect(factEvents).toBe(0)
    expect(new MemoryService(db).indexStatus()).toMatchObject({ state: 'idle', completed: 35, total: 35 })
    unsubscribe()
  })

  it('[NFR-R01] a hung fact times out without overlapping retries and its late vector is discarded', async () => {
    const db = database(); const memory = new MemoryService(db)
    embedding.mockResolvedValueOnce(null)
    await memory.add('user', '挂起事实')
    vi.useFakeTimers()
    const hung = deferred<number[]>()
    let factCalls = 0
    embedding.mockImplementation(async (text) => {
      if (text !== '挂起事实') return vector()
      factCalls++
      return factCalls === 1 ? hung.promise : vector()
    })
    expect((await memory.recall('查询')).degraded).toBe(true)
    await vi.advanceTimersByTimeAsync(2_001)
    expect(memory.indexStatus()).toMatchObject({ state: 'failed', completed: 0, total: 1 })
    await memory.recall('再次查询')
    expect(factCalls).toBe(1)
    hung.release(vector())
    await vi.advanceTimersByTimeAsync(0)
    expect(new MemoryService(db).active()[0].vector).toBeNull()
    await memory.recall('恢复查询')
    await vi.advanceTimersByTimeAsync(0)
    expect(memory.indexStatus()).toMatchObject({ state: 'idle', completed: 1, total: 1 })
    expect(factCalls).toBe(2)
  })

  it('[NFR-P02] the overall job deadline preserves partial progress and stops more background work', async () => {
    const db = database(); const memory = new MemoryService(db)
    embedding.mockResolvedValue(null)
    await memory.ingestProposed('bulk', async () => Array.from({ length: 40 }, (_, index) => proposal(`慢速事实${index}`)))
    vi.useFakeTimers()
    let factCalls = 0
    embedding.mockImplementation(async (text) => {
      if (!String(text).startsWith('慢速事实')) return vector()
      factCalls++
      return new Promise<number[]>((done) => setTimeout(() => done(vector()), 1_500))
    })
    await memory.recall('查询')
    await vi.advanceTimersByTimeAsync(30_001)
    expect(memory.indexStatus().state).not.toBe('rebuilding')
    expect(memory.indexStatus().completed).toBeGreaterThan(0)
    expect(memory.indexStatus().completed).toBeLessThan(40)
    const callsAtDeadline = factCalls
    await vi.advanceTimersByTimeAsync(3_000)
    expect(factCalls).toBe(callsAtDeadline)
    expect(new MemoryService(db).indexStatus().completed).toBe(memory.indexStatus().completed)
  })

  it('[NFR-R02] failure preserves completed vectors across restart and later recall resumes the remainder', async () => {
    const db = database(); const memory = new MemoryService(db)
    embedding.mockResolvedValue(null)
    await memory.ingestProposed('bulk', async () => [proposal('第一条'), proposal('第二条'), proposal('第三条')])
    embedding.mockImplementation(async (text) => text === '第二条' ? null : vector())
    await memory.recall('查询')
    await vi.waitFor(() => expect(memory.indexStatus()).toMatchObject({ state: 'failed', completed: 1, total: 3 }))
    const reopened = new MemoryService(db)
    expect(reopened.indexStatus()).toMatchObject({ state: 'paused', completed: 1, total: 3 })
    const computed: string[] = []
    embedding.mockImplementation(async (text) => { computed.push(String(text)); return vector() })
    await reopened.recall('恢复查询')
    await vi.waitFor(() => expect(reopened.indexStatus()).toMatchObject({ state: 'idle', completed: 3, total: 3 }))
    expect(computed).not.toContain('第一条')
    expect(new MemoryService(db).active().every((fact) => fact.vector?.length === 512)).toBe(true)
  })

  it.each(['clear', 'delete', 'policy', 'source'] as const)('[FR-15] %s cancels the background result before it can persist', async (action) => {
    const db = database(); const memory = new MemoryService(db)
    embedding.mockResolvedValue(null)
    await memory.ingestProposed('fixture', async () => [proposal('待索引事实')], 'source-chat')
    const hung = deferred<number[]>()
    const started = deferred<void>()
    embedding.mockImplementation(async (text) => {
      if (text === '待索引事实') { started.release(); return hung.promise }
      return vector()
    })
    await memory.recall('查询'); await started.promise
    if (action === 'clear') await memory.clear()
    else if (action === 'delete') await memory.delete(memory.active()[0].id)
    else if (action === 'source') await memory.clearSource('source-chat')
    else {
      memory.configure({ recallEnabled: false, extractionEnabled: true })
      memory.configure({ recallEnabled: true, extractionEnabled: true })
    }
    expect(memory.indexStatus().state).not.toBe('rebuilding')
    hung.release(vector())
    for (let step = 0; step < 20; step++) await Promise.resolve()
    const reopened = new MemoryService(db)
    if (action === 'policy') {
      expect(reopened.active()[0].vector).toBeNull()
      expect(memory.indexStatus()).toMatchObject({ state: 'paused', completed: 0, total: 1 })
    } else expect(reopened.list()).toEqual([])
  })

  it('[NFR-R02] an index write failure reports failed and retains the fact without claiming ready', async () => {
    const db = database(); const memory = new MemoryService(db)
    embedding.mockResolvedValueOnce(null)
    await memory.add('user', '保留事实')
    db.exec("CREATE TRIGGER reject_index BEFORE UPDATE OF vector_json ON memories BEGIN SELECT RAISE(ABORT, 'synthetic index write failure'); END")
    await memory.recall('查询')
    await vi.waitFor(() => expect(memory.indexStatus()).toMatchObject({ state: 'failed', completed: 0, total: 1 }))
    expect(memory.list()[0].text).toBe('保留事实')
    expect(memory.active()[0].vector).toBeNull()
  })
})

describe('conversation reliability at memory boundaries', () => {
  it('[UC-05] multi-turn correction reaches the actual model request with only current relevant memory IDs', async () => {
    const db = database(); const memory = new MemoryService(db)
    const teaVector = [0, 1, ...Array<number>(510).fill(0)]
    embedding.mockImplementation(async (text) => String(text).includes('白茶') ? teaVector : vector())
    await memory.add('user', '喜欢白茶')
    let extraction: Promise<unknown> = Promise.resolve()
    const requests: string[] = []
    const service = new ConversationService(db, models, { chat: async (_model, _turns, _delta, system) => {
      requests.push(system ?? '')
      return system?.includes('可参考的长期记忆：\n对芝麻过敏') ? '晚饭需要避开芝麻。' : '已经听到你的说明。'
    } }, {
      memoryEnabled: () => memory.recallEnabled,
      recall: (query) => memory.recall(query),
      onTurn: (text, source) => {
        extraction = memory.ingestProposed(text, async () => text === '我对花生过敏'
          ? [proposal('对花生过敏')]
          : text === '更正，是芝麻过敏'
            ? [{ action: 'UPDATE', category: 'feedback', text: '对芝麻过敏', replaces: '对花生过敏' }]
            : [], source)
      }
    })
    const chat = service.create()
    await service.send(chat.id, '我对花生过敏'); await extraction
    await service.send(chat.id, '更正，是芝麻过敏'); await extraction
    const result = await service.send(chat.id, '晚饭怎么选'); await extraction
    if (!result.ok) throw new Error(result.error)
    expect(result.data.messages.at(-1)?.text).toBe('晚饭需要避开芝麻。')
    const memorySection = requests.at(-1)?.split('可参考的长期记忆：\n')[1]
    expect(memorySection).toBe('对芝麻过敏')
    const actual = memory.active().find((fact) => fact.text === '对芝麻过敏')
    expect(result.data.recalledMemoryIds).toEqual([actual?.id])
    expect(new ConversationService(db, models).list()[0].recalledMemoryIds).toEqual([actual?.id])
    memory.configure({ recallEnabled: false, extractionEnabled: false })
    await service.send(chat.id, '再继续'); await extraction
    expect(requests.at(-1)).not.toContain('可参考的长期记忆')
    expect(service.list()[0].recalledMemoryIds).toEqual([])
  })

  it('[NFR-U03] unavailable recall does not discard a valid model reply or the current turn', async () => {
    const db = database()
    const service = new ConversationService(db, models, { chat: async () => '可以继续讨论。' }, {
      memoryEnabled: () => true,
      recall: async () => { throw new Error('synthetic local index failure') }
    })
    const chat = service.create()
    expect((await service.send(chat.id, '继续讨论这段话')).ok).toBe(true)
    expect(service.list()[0].messages.slice(-2).map((message) => message.text)).toEqual(['继续讨论这段话', '可以继续讨论。'])
    expect(service.list()[0].recalledMemoryIds).toEqual([])
  })

  it('[FR-12] a broken recall observer cannot mark a healthy model offline or lose a reply', async () => {
    const db = database(); const offline: string[] = []
    const service = new ConversationService(db, { ...models, markOffline: (id) => { offline.push(id) } }, { chat: async () => '已知的完整答复。' }, {
      onRecall: () => { throw new Error('synthetic observer failure') }
    })
    const chat = service.create()
    expect((await service.send(chat.id, '继续谈谈')).ok).toBe(true)
    expect(service.list()[0].messages.at(-1)?.text).toBe('已知的完整答复。')
    expect(offline).toEqual([])
  })

  it('[UC-01] a post-turn extraction error cannot suppress the completed pet reply', async () => {
    const spoken: string[] = []
    const service = new ConversationService(database(), models, { chat: async () => '这句已经答好了。还有后续说明。' }, {
      onTurn: () => { throw new Error('synthetic extraction setup failure') },
      onReply: (reply) => spoken.push(reply)
    })
    const chat = service.create()
    expect((await service.send(chat.id, '继续谈谈')).ok).toBe(true)
    expect(spoken).toEqual(['这句已经答好了。'])
  })
})
