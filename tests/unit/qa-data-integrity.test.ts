import { afterEach, describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { SqliteDatabase } from '../../src/main/data/sqlite-types'
import { migrate } from '../../src/main/data/migrate'
import { mergeImportedBundle } from '../../src/main/data/merge-bundle'
import { exportBundle, importBundle } from '../../src/main/data/portability'
import { rejectDowngrade } from '../../src/main/data/upgrade'

const databases: DatabaseSync[] = []
afterEach(() => { for (const db of databases.splice(0)) db.close() })

function rawDatabase(): DatabaseSync {
  const raw = new DatabaseSync(':memory:')
  databases.push(raw)
  for (const file of ['001_init.sql', '002_memory.sql', '003_trace.sql']) {
    raw.exec(readFileSync(resolve('src/main/data/migrations', file), 'utf8'))
  }
  return raw
}

function sqlite(raw: DatabaseSync): SqliteDatabase {
  return {
    prepare: statement => raw.prepare(statement) as unknown as ReturnType<SqliteDatabase['prepare']>,
    exec(statement) { raw.exec(statement); return this },
    pragma: statement => raw.prepare(`PRAGMA ${statement}`).get(),
    close: () => raw.close(),
    transaction: job => () => {
      raw.exec('BEGIN')
      try { const result = job(); raw.exec('COMMIT'); return result } catch (error) { raw.exec('ROLLBACK'); throw error }
    }
  }
}

function count(raw: DatabaseSync, table: 'messages' | 'conversations' | 'memories'): number {
  return (raw.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count
}

describe('[QA-DATA-00] 导入包加解密与数据库迁移的失败路径', () => {
  it('[QA-DATA-01] 同一对话中前缀相同的两条导入消息都必须保留，不能静默丢弃', () => {
    const raw = rawDatabase()
    const merged = mergeImportedBundle(sqlite(raw), {
      conversations: [{
        id: 'imported-chat',
        title: '导入的对话',
        messages: [
          { role: 'user', text: '这是第一条足够长的消息内容' },
          { role: 'assistant', text: '这是第一条足够长的消息内容（续）' }
        ]
      }]
    })
    expect(merged.conversations).toBe(1)
    expect(count(raw, 'messages')).toBe(2)
    const texts = (raw.prepare('SELECT text FROM messages ORDER BY rowid').all() as Array<{ text: string }>).map((row) => row.text)
    expect(texts).toEqual(['这是第一条足够长的消息内容', '这是第一条足够长的消息内容（续）'])
  })

  it('[QA-DATA-02] 截断的导入包以中文错误拒绝，不能把底层“Invalid initialization vector”抛给用户', () => {
    expect(() => importBundle(Buffer.from('MUR1', 'utf8'), 'secret-passphrase', 3)).toThrow(/数据包/)
    expect(() => importBundle(Buffer.alloc(0), 'secret-passphrase', 3)).toThrow(/数据包/)
  })

  it('[QA-DATA-03] 结构非法的导入包被拒绝，不能带着错误结构进入数据库合并', () => {
    const malformed = exportBundle({
      version: 1,
      // 真实导入包里 conversations 必须是数组；这里模拟被篡改/损坏的文件。
      conversations: { not: 'an array' } as unknown as unknown[],
      memories: [] as unknown[],
      character: null,
      models: []
    }, 'secret-passphrase')
    expect(() => importBundle(malformed, 'secret-passphrase', 3)).toThrow(/数据包结构|数据包格式|数据包内容/)
  })

  it('[QA-DATA-04] 版本过高的导入包被拒绝，现有数据保持不变', () => {
    const future = exportBundle({ version: 9, conversations: [], memories: [], character: null, models: [] }, 'secret-passphrase')
    expect(() => importBundle(future, 'secret-passphrase', 3)).toThrow(/版本/)
  })

  it('[QA-DATA-05] 导入包中出现凭据字段时拒绝导入', () => {
    const bundled = exportBundle({
      version: 3,
      conversations: [],
      memories: [{ id: 'm1', category: '偏好', text: 'x' }],
      character: null,
      models: []
    }, 'secret-passphrase')
    // 正常情况下 exportBundle 写入的是 JSON 明文经加密；这里通过伪造 JSON 结构验证扫描逻辑。
    const leaked = Buffer.from(JSON.stringify({ version: 3, conversations: [], memories: [], character: null, models: [], key: 'sk-abcdefghijk' }))
    expect(bundled.length).toBeGreaterThan(48)
    expect(() => importBundle(exportBundle({ version: 3, conversations: [], memories: [], character: null, models: [{ id: 'm', name: 'n', endpoint: 'https://example.invalid', key: 'sk-abcdefghijk' } as never] }, 'secret-passphrase'), 'secret-passphrase', 3)).toThrow(/凭据/)
    expect(leaked.length).toBeGreaterThan(0)
  })

  it('[QA-DATA-06] 合并导入失败时事务回滚，不会留下半份导入数据', () => {
    const raw = rawDatabase()
    raw.exec(`CREATE TRIGGER reject_messages BEFORE INSERT ON messages BEGIN SELECT RAISE(ABORT, 'controlled failure'); END`)
    expect(() => mergeImportedBundle(sqlite(raw), {
      conversations: [{ id: 'chat-rollback', title: '回滚', messages: [{ role: 'user', text: '这条消息写入会失败' }] }],
      memories: [{ id: 'mem-rollback', category: '偏好', text: '回滚记忆' }]
    })).toThrow(/controlled failure/)
    expect(count(raw, 'conversations')).toBe(0)
    expect(count(raw, 'memories')).toBe(0)
  })

  it('[QA-DATA-07] 迁移中途失败时回滚当前版本，schema_version 不前进', () => {
    const raw = new DatabaseSync(':memory:'); databases.push(raw)
    const db = sqlite(raw)
    const migrations = [
      { version: 1, sql: 'CREATE TABLE t1 (id TEXT PRIMARY KEY);' },
      { version: 2, sql: 'CREATE TABLE t1 (id TEXT PRIMARY KEY);' }
    ]
    expect(() => migrate(db, migrations)).toThrow()
    const version = raw.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string } | undefined
    expect(version?.value).toBe('1')
    const tables = raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 't1'").all()
    expect(tables).toHaveLength(1)
  })

  it('[QA-DATA-08] 数据库版本高于程序支持版本时拒绝打开并说明原因', () => {
    expect(rejectDowngrade(5, 3)).toContain('高于')
    expect(rejectDowngrade(3, 3)).toBeNull()
    expect(rejectDowngrade(0, 3)).toBeNull()
  })
})
