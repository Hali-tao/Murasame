import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { SqliteDatabase } from '../../src/main/data/sqlite-types'
import { ConversationService } from '../../src/main/core/services/conversation-service'
import { MemoryService } from '../../src/main/core/services/memory-service'
import { routeUtterance } from '../../src/main/agent/teammates'
import { runModelExtraction } from '../../src/main/agent/memory-extractor'
import { applyMemoryAction } from '../../src/main/memory/facts'
import { recallMemories } from '../../src/main/local/embedding'
import type { ResolvedModel, ChatTurn } from '../../src/main/model/types'

const embedding = vi.hoisted(() => vi.fn(async () => [1, ...Array<number>(511).fill(0)]))
vi.mock('../../src/main/local/embedding', async (original) => ({
  ...await original<typeof import('../../src/main/local/embedding')>(), embedLocally: embedding
}))

const opened: DatabaseSync[] = []
function database(): SqliteDatabase {
  const raw = new DatabaseSync(':memory:')
  opened.push(raw)
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
const models = {
  getDefault: () => ({ id: 'synthetic', model: 'controlled', endpoint: 'http://unused.invalid' }) as ResolvedModel,
  markOffline: () => {}, markVerified: () => {}
}
afterEach(() => { for (const db of opened.splice(0)) db.close() })
beforeEach(() => { embedding.mockReset(); embedding.mockImplementation(async () => [1, ...Array<number>(511).fill(0)]) })

describe('conversation data integrity', () => {
  it('stores the complete model reply while publishing one complete short pet line', async () => {
    const db = database()
    const spoken: string[] = []
    const deltas: string[] = []
    const full = '可以。下面是三个具体步骤。\n```ts\nconst answer = 42\n```\n最后还有限制条件。'
    const service = new ConversationService(db, models, { chat: async () => full }, { onReply: (text) => spoken.push(text) })
    const chat = service.create()
    await service.send(chat.id, '详细解释', (delta) => deltas.push(delta))
    expect(service.list()[0].messages.at(-1)?.text).toBe(full)
    expect(spoken).toEqual(['可以。'])
    expect(deltas).toEqual([])
  })

  it('serializes context construction for the same conversation and preserves turn chronology', async () => {
    const db = database()
    const first = deferred<string>()
    const requests: ChatTurn[][] = []
    const service = new ConversationService(db, models, { chat: async (_model, messages) => {
      requests.push(messages)
      return requests.length === 1 ? first.promise : '银杏。'
    } })
    const chat = service.create()
    const a = service.send(chat.id, '发布代号是银杏')
    const b = service.send(chat.id, '复述代号')
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    first.release('记住银杏。')
    await Promise.all([a, b])
    expect(requests[1].map((turn) => turn.content)).toContain('发布代号是银杏')
    expect(requests[1].map((turn) => turn.content)).toContain('记住银杏。')
    expect(service.list()[0].messages.slice(1).map((item) => item.text)).toEqual(['发布代号是银杏', '记住银杏。', '复述代号', '银杏。'])
  })

  it('retains middle-history facts, later corrections and late sentence constraints with provenance', async () => {
    const db = database()
    let captured = ''
    const service = new ConversationService(db, models, { chat: async (_model, messages, _delta, system) => {
      captured = `${system}\n${messages.map((item) => item.content).join('\n')}`
      return '了解。'
    } })
    const chat = service.create()
    for (let index = 0; index < 120; index++) {
      const text = index === 20 ? `${'日常讨论。'.repeat(25)}关键约定：发布代号为银杏。不得上传客户资料。`
        : index === 40 ? '更正：发布代号改为白桦，银杏已废弃。' : `普通讨论第${index}轮。`
      db.prepare('INSERT INTO messages(id, conversation_id, role, text, created_at) VALUES (?, ?, ?, ?, ?)').run(`old-${index}`, chat.id, index % 2 ? 'assistant' : 'user', text, `2026-01-01T00:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.000Z`)
    }
    await service.send(chat.id, '发布代号和限制是什么')
    expect(captured).toContain('发布代号为银杏')
    expect(captured).toContain('发布代号改为白桦')
    expect(captured).toContain('不得上传客户资料')
    expect(captured).toContain('old-20')
    expect(captured).toContain('user')
  })

  it('rejects both running and queued turns after the conversation is deleted', async () => {
    const db = database()
    const pending = deferred<string>()
    const spoken: string[] = []
    let started = false
    const service = new ConversationService(db, models, { chat: async () => { started = true; return pending.promise } }, { onReply: (text) => spoken.push(text) })
    const chat = service.create()
    const a = service.send(chat.id, '唯一删除标记')
    const b = service.send(chat.id, '排队输入')
    await vi.waitFor(() => expect(started).toBe(true))
    service.deleteHistory(chat.id)
    pending.release('迟到原文。')
    expect((await a).ok).toBe(false)
    expect((await b).ok).toBe(false)
    expect(db.prepare('SELECT * FROM messages').all()).toEqual([])
    expect(spoken).toEqual([])
  })

  it('removes deleted trace content while retaining another conversation and shared blobs', async () => {
    const db = database()
    const service = new ConversationService(db, models, { chat: async () => '共同回复。' })
    const a = service.create(); const b = service.create()
    await service.send(a.id, '删除唯一标记甲')
    await service.send(b.id, '保留唯一标记乙')
    service.deleteHistory(a.id)
    const bodies = db.prepare('SELECT body FROM trace_blobs').all() as Array<{ body: string }>
    expect(bodies.some((row) => row.body.includes('删除唯一标记甲'))).toBe(false)
    expect(bodies.some((row) => row.body.includes('保留唯一标记乙'))).toBe(true)
    expect(bodies.some((row) => row.body === '共同回复。')).toBe(true)
    service.clearCache()
    expect(db.prepare('SELECT * FROM trace_blobs').all()).toEqual([])
    expect(service.list()[0].messages.at(-1)?.text).toBe('共同回复。')
  })

  it('persists actual recall evidence for the assistant turn and clears it on a non-recall turn', async () => {
    const db = database()
    const events: Array<{ turnId: string; ids: string[] }> = []
    const service = new ConversationService(db, models, { chat: async () => '完整回复。还有解释。' }, {
      memoryEnabled: () => true, recall: async () => ({ text: '偏好白茶', ids: ['memory-actual'] }),
      onRecall: (_id, event) => events.push(event)
    })
    const chat = service.create()
    const result = await service.send(chat.id, '推荐一种茶')
    if (!result.ok) throw new Error(result.error)
    expect(events).toEqual([{ turnId: result.data.messages.at(-1)?.id, ids: ['memory-actual'] }])
    const reloaded = new ConversationService(db, models).list()[0]
    expect(reloaded.recalledMemoryIds).toEqual(['memory-actual'])
    expect(reloaded.recalledAtMessageId).toBe(result.data.messages.at(-1)?.id)
    await service.send(chat.id, '请截图')
    expect(service.list()[0].recalledMemoryIds).toEqual([])
  })

  it('serializes factual observations with replies and rejects late observations after deletion', async () => {
    const db = database(); const pending = deferred<string>()
    let started = false
    const service = new ConversationService(db, models, { chat: async () => { started = true; return pending.promise } })
    const chat = service.create()
    const send = service.send(chat.id, '开始活动')
    await vi.waitFor(() => expect(started).toBe(true))
    const observed = service.appendObservation(chat.id, '只观察到网页标题，没有播放核验。')
    pending.release('先回答。'); await send
    expect((await observed).ok).toBe(true)
    expect(service.list()[0].messages.slice(-2).map((message) => message.text)).toEqual(['先回答。', '活动记录：只观察到网页标题，没有播放核验。'])
    service.deleteHistory(chat.id)
    expect((await service.appendObservation(chat.id, '迟到观察')).ok).toBe(false)
    expect(db.prepare('SELECT * FROM messages').all()).toEqual([])
  })
})

describe('intent routing preserves discussion and prohibition', () => {
  it.each(['请不要截图', '我不喜欢截屏，别截图', '屏幕是什么意思', '我喜欢看视频', '我的项目网址是 https://example.com，只要记住', '我已经把文件整理好了', '解释截图原理，不要截图', '昨天你说“请截图”，这句话什么意思', '我想知道怎么画一张图片', '不要画图，不过请整理下载文件夹'])('does not route quoted, historical, negative or informational wording: %s', (text) => {
    const want = text === '不要画图，不过请整理下载文件夹' ? 'organize' : 'chat'
    expect(routeUtterance(text).kind).toBe(want)
  })
  it.each([['请截图', 'look-screen'], ['帮我整理下载文件夹', 'organize'], ['请打开 https://example.com', 'browse'], ['帮我画一张图片', 'draw-image'], ['看看我的屏幕', 'look-screen'], ['不要截图，帮我画一张图片', 'draw-image']])('keeps explicit positive commands: %s', (text, want) => {
    expect(routeUtterance(text).kind).toBe(want)
  })
})

describe('memory transaction and extraction integrity', () => {
  it('supports recall with automatic extraction off and cancels pre-disable extractions after re-enable', async () => {
    const service = new MemoryService(database())
    await service.add('user', '偏好白茶')
    const pending = deferred<Array<{ action: 'ADD'; category: 'project'; text: string }>>()
    const ingest = service.ingestProposed('旧提取', () => pending.promise)
    service.configure({ recallEnabled: true, extractionEnabled: false })
    expect((await service.recall('推荐饮料')).ids).toHaveLength(1)
    service.configure({ recallEnabled: true, extractionEnabled: true })
    pending.release([{ action: 'ADD', category: 'project', text: '停用前项目' }]); await ingest
    expect(service.active().map((fact) => fact.text)).toEqual(['偏好白茶'])
  })

  it('cancels an extraction when clearing during embedding rather than only during model generation', async () => {
    const db = database(); const service = new MemoryService(db)
    const vector = deferred<number[]>()
    embedding.mockImplementationOnce(() => vector.promise)
    const ingest = service.ingestProposed('资料', async () => [{ action: 'ADD', category: 'project', text: '索引中的旧项目' }])
    await vi.waitFor(() => expect(embedding).toHaveBeenCalled())
    await service.clear()
    vector.release([1, ...Array<number>(511).fill(0)]); await ingest
    expect(new MemoryService(db).active()).toEqual([])
  })

  it('reports extraction failures distinctly and only notifies observers after a committed change', async () => {
    const db = database(); const service = new MemoryService(db)
    let events = 0
    service.subscribe(() => { events++ })
    const failed = await service.ingestProposed('资料', async () => { throw new Error('controlled model failure') })
    expect(failed).toMatchObject({ status: 'failed' })
    expect(events).toBe(0)
    const saved = await service.ingestProposed('资料', async () => [{ action: 'ADD', category: 'project', text: '新项目' }])
    expect(saved).toMatchObject({ status: 'saved' })
    expect(events).toBe(1)
    const noop = await service.ingestProposed('资料', async () => [])
    expect(noop).toMatchObject({ status: 'unchanged' })
    expect(events).toBe(1)
  })
  it('treats an unchanged edit as a no-op even when local embeddings are unavailable', async () => {
    embedding.mockResolvedValue(null as unknown as number[])
    const db = database(); const service = new MemoryService(db)
    const added = await service.add('user', '喜欢绿茶')
    if (!added.ok) throw new Error(added.error)
    const result = await service.update(added.data.id, 'user', '喜欢绿茶')
    if (!result.ok) throw new Error(result.error)
    expect(result.data.id).toBe(added.data.id)
    expect(db.prepare('SELECT * FROM memories').all()).toHaveLength(1)
  })

  it('saves unchanged text, category-only edits and old text without duplicate primary keys', async () => {
    const db = database(); const service = new MemoryService(db)
    const added = await service.add('user', '喜欢绿茶')
    if (!added.ok) throw new Error(added.error)
    expect((await service.update(added.data.id, 'user', '喜欢绿茶')).ok).toBe(true)
    const edited = await service.update(added.data.id, 'feedback', '喜欢绿茶')
    expect(edited.ok).toBe(true)
    if (!edited.ok) throw new Error(edited.error)
    const changed = await service.update(edited.data.id, 'user', '喜欢红茶')
    if (!changed.ok) throw new Error(changed.error)
    expect((await service.update(changed.data.id, 'user', '喜欢绿茶')).ok).toBe(true)
    expect(new MemoryService(db).list().map((item) => item.text)).toEqual(['喜欢绿茶'])
  })

  it('rolls back both SQLite and suppression state when a write fails mid-transaction', async () => {
    const db = database(); const service = new MemoryService(db)
    const a = await service.add('user', '喜欢绿茶'); await service.add('user', '项目白桦')
    if (!a.ok) throw new Error(a.error)
    db.exec("CREATE TRIGGER reject_memory BEFORE INSERT ON memories WHEN NEW.text = '项目白桦' BEGIN SELECT RAISE(ABORT, 'injected failure'); END")
    expect((await service.delete(a.data.id)).ok).toBe(false)
    expect(new MemoryService(db).active().map((item) => item.text).sort()).toEqual(['喜欢绿茶', '项目白桦'])
    expect(db.prepare('SELECT * FROM suppressed_facts').all()).toEqual([])
  })

  it.each(['clear', 'disable', 'source'] as const)('does not revive data after %s during model extraction', async (action) => {
    const db = database(); const service = new MemoryService(db)
    await service.add('user', '喜欢绿茶')
    const pending = deferred<Array<{ action: 'ADD'; category: 'project'; text: string }>>()
    const ingest = service.ingestProposed('项目资料', () => pending.promise, 'deleted-chat')
    if (action === 'clear') await service.clear()
    else if (action === 'disable') service.enabled = false
    else await service.clearSource('deleted-chat')
    pending.release([{ action: 'ADD', category: 'project', text: '迟到项目' }])
    await ingest
    expect(new MemoryService(db).active().map((item) => item.text)).toEqual(action === 'clear' ? [] : ['喜欢绿茶'])
  })

  it('merges independently completed extractions instead of overwriting newer facts', async () => {
    const db = database(); const service = new MemoryService(db)
    const a = deferred<Array<{ action: 'ADD'; category: 'project'; text: string }>>()
    const b = deferred<Array<{ action: 'ADD'; category: 'project'; text: string }>>()
    const first = service.ingestProposed('甲', () => a.promise)
    const second = service.ingestProposed('乙', () => b.promise)
    b.release([{ action: 'ADD', category: 'project', text: '项目乙' }]); await second
    a.release([{ action: 'ADD', category: 'project', text: '项目甲' }]); await first
    expect(new MemoryService(db).active().map((item) => item.text).sort()).toEqual(['项目乙', '项目甲'].sort())
  })

  it('does not overwrite a manually corrected fact with a stale extraction proposal', async () => {
    const db = database(); const service = new MemoryService(db)
    const old = await service.add('user', '喜欢绿茶')
    if (!old.ok) throw new Error(old.error)
    const pending = deferred<Array<{ action: 'UPDATE'; category: 'user'; text: string; replaces: string }>>()
    const ingest = service.ingestProposed('偏好', () => pending.promise)
    await service.update(old.data.id, 'user', '喜欢白茶')
    pending.release([{ action: 'UPDATE', category: 'user', text: '喜欢红茶', replaces: '喜欢绿茶' }]); await ingest
    expect(service.active().map((item) => item.text)).toEqual(['喜欢白茶'])
  })

  it('refreshes the edited embedding, preserves its source, and hides invalidated versions', async () => {
    const db = database(); const service = new MemoryService(db)
    await service.ingestProposed('偏好', async () => [{ action: 'ADD', category: 'user', text: '不能吃花生' }], 'source-chat')
    await service.update(service.active()[0].id, 'feedback', '对坚果过敏')
    expect(service.active()[0].vector).toHaveLength(512)
    expect((await service.recall('晚饭怎么选')).text).toBe('对坚果过敏')
    expect(new MemoryService(db).active()[0].source).toBe('source-chat')
    expect(service.list().map((item) => item.text)).toEqual(['对坚果过敏'])
    await service.clearSource('source-chat')
    expect(service.list()).toEqual([])
  })

  it('allows unrelated recall to return no memory and reports only entries inside the injection budget', () => {
    expect(recallMemories('排查网络错误', [{ id: 'tea', text: '喜欢红茶', category: 'user', vector: [1, 0] }], [0, 1]).ids).toEqual([])
    const recalled = recallMemories('偏好', [
      { id: 'a', text: '偏好' + '甲'.repeat(1000), category: 'user', vector: [1, 0] },
      { id: 'b', text: '偏好' + '乙'.repeat(1000), category: 'user', vector: [1, 0] }
    ], [1, 0])
    expect(recalled.ids).toEqual(['a'])
    expect(recalled.injected).toHaveLength(1)
  })

  it.each([50, 500])('exposes and corrects facts beyond the first 30 among %i entries', async (count) => {
    let facts = [] as ReturnType<typeof applyMemoryAction>
    for (let index = 1; index <= count; index++) facts = applyMemoryAction(facts, { category: 'user', text: `偏好${index}` }, 'ADD', 'old', new Set())
    const result = await runModelExtraction('更正末条', facts, new Set(), async (_text, known) => {
      expect(known).toContain(`偏好${count}`)
      return [{ action: 'UPDATE', category: 'user', text: '喜欢白茶', replaces: `偏好${count}` }]
    })
    expect(result.failed).toBe(false)
    expect(result.facts.filter((item) => !item.validUntil).map((item) => item.text)).not.toContain(`偏好${count}`)
  })
})
