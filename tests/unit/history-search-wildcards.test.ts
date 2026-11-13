import { afterEach, describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { SqliteDatabase } from '../../src/main/data/sqlite-types'
import { ModelRegistry } from '../../src/main/model/registry'
import { ConversationService } from '../../src/main/core/services/conversation-service'

vi.mock('electron-store', () => ({ default: class {
  get() { return [] }
  set() { /* no-op */ }
} }))
vi.mock('electron', () => ({ safeStorage: {
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from(`encrypted:${value}`),
  decryptString: (value: Buffer) => value.toString().replace(/^encrypted:/, '')
} }))
vi.mock('../../src/main/logger', () => ({ default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

const databases: DatabaseSync[] = []
afterEach(() => { for (const db of databases.splice(0)) db.close() })

function databaseWithMessages(): SqliteDatabase {
  const raw = new DatabaseSync(':memory:')
  databases.push(raw)
  for (const file of ['001_init.sql', '002_memory.sql', '003_trace.sql']) raw.exec(readFileSync(resolve('src/main/data/migrations', file), 'utf8'))
  const db: SqliteDatabase = {
    prepare: sql => raw.prepare(sql) as unknown as ReturnType<SqliteDatabase['prepare']>,
    exec(sql) { raw.exec(sql); return this },
    pragma: sql => raw.prepare(`PRAGMA ${sql}`).get(),
    close: () => raw.close(),
    transaction: job => () => {
      raw.exec('BEGIN')
      try { const result = job(); raw.exec('COMMIT'); return result } catch (error) { raw.exec('ROLLBACK'); throw error }
    }
  }
  const now = '2026-11-13T00:00:00.000Z'
  db.prepare('INSERT INTO conversations (id, title, pinned, created_at, updated_at) VALUES (?, ?, 0, ?, ?)').run('chat-1', '报表讨论', now, now)
  db.prepare('INSERT INTO messages (id, conversation_id, role, text, created_at) VALUES (?, ?, ?, ?, ?)').run('msg-1', 'chat-1', 'user', '这个月完成度 100%，剩下的是其他文本', now)
  db.prepare('INSERT INTO conversations (id, title, pinned, created_at, updated_at) VALUES (?, ?, 0, ?, ?)').run('chat-2', '普通会话', now, now)
  db.prepare('INSERT INTO messages (id, conversation_id, role, text, created_at) VALUES (?, ?, ?, ?, ?)').run('msg-2', 'chat-2', 'assistant', '没有百分号的普通回复', now)
  return db
}

const service = (): ConversationService => {
  const registry = new ModelRegistry()
  return new ConversationService(databaseWithMessages(), registry, { chat: async () => 'unused' }, {})
}

describe('[QA-SEARCH-00] 历史搜索的 SQL 通配符处理', () => {
  it('[QA-SEARCH-01] 只输入 % 或 _ 时不能命中全部历史（当前会被清洗成空模式导致全匹配）', () => {
    const conversations = service()
    // % 按字面匹配：只命中真的含 % 的会话，而不是把全部历史都当成命中。
    const percent = conversations.search('%')
    expect(percent.status).toBe('ok')
    expect(percent.status === 'ok' ? percent.items.map((hit) => hit.id) : []).toEqual(['chat-1'])
    expect(conversations.search('_').status).toBe('empty')
  })

  it('[QA-SEARCH-02] 普通关键词与带百分号的字面量都能按字面匹配', () => {
    const conversations = service()
    const literalPercent = conversations.search('100%')
    expect(literalPercent.status).toBe('ok')
    expect(literalPercent.status === 'ok' ? literalPercent.items.map((hit) => hit.id) : []).toEqual(['chat-1'])
    const normal = conversations.search('普通')
    expect(normal.status).toBe('ok')
    expect(normal.status === 'ok' ? normal.items.map((hit) => hit.id).sort() : []).toEqual(['chat-2'])
  })
})


describe('[QA-SEARCH-03] 反斜杠查询', () => {
  it('反斜杠是 ESCAPE 自身，必须被正确转义且不报错', () => {
    const conversations = service()
    expect(conversations.search('\\').status).toBe('empty')
  })
})
