import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ModelInput } from '../../src/shared/types'
import type { SqliteDatabase } from '../../src/main/data/sqlite-types'
import { ModelRegistry } from '../../src/main/model/registry'
import { ConversationService } from '../../src/main/core/services/conversation-service'

const storage = vi.hoisted(() => ({ models: [] as unknown[], failNextWrite: false }))
vi.mock('electron-store', () => ({ default: class {
  get() { return structuredClone(storage.models) }
  set(_key: string, models: unknown[]) {
    if (storage.failNextWrite) { storage.failNextWrite = false; throw new Error('controlled status storage failure') }
    storage.models = structuredClone(models)
  }
} }))
vi.mock('electron', () => ({ safeStorage: {
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from(`encrypted:${value}`),
  decryptString: (value: Buffer) => value.toString().replace(/^encrypted:/, '')
} }))
vi.mock('../../src/main/logger', () => ({ default: { error: vi.fn() } }))
const databases: DatabaseSync[] = []
function database(): SqliteDatabase {
  const raw = new DatabaseSync(':memory:'); databases.push(raw)
  for (const file of ['001_init.sql', '002_memory.sql', '003_trace.sql']) raw.exec(readFileSync(resolve('src/main/data/migrations', file), 'utf8'))
  return {
    prepare: sql => raw.prepare(sql) as unknown as ReturnType<SqliteDatabase['prepare']>,
    exec(sql) { raw.exec(sql); return this }, pragma: sql => raw.prepare(`PRAGMA ${sql}`).get(), close: () => raw.close(),
    transaction: job => () => {
      raw.exec('BEGIN')
      try { const result = job(); raw.exec('COMMIT'); return result } catch (error) { raw.exec('ROLLBACK'); throw error }
    }
  }
}
const input = (overrides: Partial<ModelInput> = {}): ModelInput => ({ name: '原服务', provider: 'OpenAI Compatible', endpoint: 'https://unused.invalid/v1', key: 'independent-test-key', model: 'original', caps: [], ...overrides })
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
function available(registry: ModelRegistry) {
  const made = registry.create()
  const pending = registry.prepareVerification(made.id, input())
  pending.commit([{ id: 'text.chat', status: 'verified', detail: 'controlled boundary', probedAt: new Date().toISOString() }], 12, '')
  return made.id
}
async function pendingTurn(registry: ModelRegistry) {
  const answer = deferred<string>(), started = deferred<void>(), replies: string[] = []
  const service = new ConversationService(database(), registry, { chat: async () => { started.resolve(); return answer.promise } }, { onReply: reply => { replies.push(reply) } })
  const conversation = service.create()
  const sending = service.send(conversation.id, '你好，请解释一下').catch((error: unknown) => error)
  await started.promise
  return { answer, service, conversation, sending, replies }
}
beforeEach(() => { storage.models = []; storage.failNextWrite = false })
afterEach(() => { for (const db of databases.splice(0)) db.close() })

describe('in-flight conversation model lifecycle', () => {
  for (const outcome of ['success', 'failure'] as const) {
    it.each([
      { name: 'endpoint', changed: { endpoint: 'https://replacement.invalid/v1' } },
      { name: 'model', changed: { model: 'replacement' } },
      { name: 'credential', changed: { key: 'replacement-test-key' } },
      { name: 'resubmitted credential', changed: { key: 'independent-test-key' } },
      { name: 'provider', changed: { provider: 'Anthropic' } }
    ])(`${outcome}: an old request cannot mark an edited $name online or offline`, async ({ changed }) => {
      const registry = new ModelRegistry(), id = available(registry), turn = await pendingTurn(registry)
      registry.save(id, input({ key: '', ...changed }))
      const edited = registry.get(id)
      if (outcome === 'success') turn.answer.resolve('完整的原请求回复。')
      else turn.answer.reject(new Error('原请求连接失败'))
      const result = await turn.sending
      expect(result).toMatchObject({ ok: outcome === 'success' })
      expect(new ModelRegistry().get(id)).toEqual(edited)
    })

    it(`${outcome}: removing the active configuration cannot replace the conversation result with a status-update error`, async () => {
      const registry = new ModelRegistry(), id = available(registry), turn = await pendingTurn(registry)
      registry.remove(id)
      if (outcome === 'success') turn.answer.resolve('已经完整收到的回复。')
      else turn.answer.reject(new Error('原请求连接失败'))
      const result = await turn.sending
      expect(result).toMatchObject(outcome === 'success' ? { ok: true } : { ok: false, error: '原请求连接失败' })
      expect(registry.list()).toEqual([])
      expect(turn.service.list()[0].messages.slice(turn.conversation.messages.length).map(message => message.text))
        .toEqual(outcome === 'success' ? ['你好，请解释一下', '已经完整收到的回复。'] : [])
      expect(turn.replies).toHaveLength(outcome === 'success' ? 1 : 0)
    })

    it(`${outcome}: a status storage failure cannot discard a completed answer or hide the original transport error`, async () => {
      const registry = new ModelRegistry(); available(registry)
      const turn = await pendingTurn(registry)
      storage.failNextWrite = true
      if (outcome === 'success') turn.answer.resolve('已成功写入会话的完整回答。')
      else turn.answer.reject(new Error('原请求连接失败'))
      const result = await turn.sending
      expect(result).toMatchObject(outcome === 'success' ? { ok: true } : { ok: false, error: '原请求连接失败' })
      expect(turn.replies).toHaveLength(outcome === 'success' ? 1 : 0)
    })
  }

  it('a configuration changed away and back is not verified by a pre-change response', async () => {
    const registry = new ModelRegistry(), id = available(registry), turn = await pendingTurn(registry)
    registry.save(id, input({ key: '', model: 'temporary' }))
    registry.save(id, input({ key: '' }))
    const restored = registry.get(id)
    turn.answer.resolve('旧请求完整回答。')
    expect(await turn.sending).toMatchObject({ ok: true })
    expect(registry.get(id)).toEqual(restored)
  })

  it('a newer explicit connection verification wins over an older failed chat', async () => {
    const registry = new ModelRegistry(), id = available(registry), turn = await pendingTurn(registry)
    registry.prepareVerification(id).commit([{ id: 'text.chat', status: 'verified', detail: 'newer evidence', probedAt: new Date().toISOString() }], 7, 'new evidence')
    const verified = registry.get(id)
    turn.answer.reject(new Error('早先请求失败'))
    expect(await turn.sending).toMatchObject({ ok: false, error: '早先请求失败' })
    expect(registry.get(id)).toEqual(verified)
  })

  it('a name-only edit retains current connection health updates and the new name', async () => {
    const registry = new ModelRegistry(), id = available(registry), turn = await pendingTurn(registry)
    registry.save(id, input({ key: '', name: '新的显示名称' }))
    turn.answer.reject(new Error('本次实际失败'))
    expect(await turn.sending).toMatchObject({ ok: false })
    expect(registry.get(id)).toMatchObject({ name: '新的显示名称', status: '离线' })
  })

  it('unchanged current configuration records a successful real response after an offline state', async () => {
    const registry = new ModelRegistry(), id = available(registry)
    registry.markOffline(id)
    const turn = await pendingTurn(registry)
    turn.answer.resolve('当前连接恢复。')
    expect(await turn.sending).toMatchObject({ ok: true })
    expect(registry.get(id)).toMatchObject({ status: '在线', tone: 'green' })
  })
})
