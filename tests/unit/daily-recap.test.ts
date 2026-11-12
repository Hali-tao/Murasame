import { afterEach, describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import type { SqliteDatabase } from '../../src/main/data/sqlite-types'
import { localDayWindow, queryDailyRecap } from '../../src/main/core/services/daily-recap-service'

const databases: DatabaseSync[] = []
afterEach(() => {
  for (const db of databases.splice(0)) db.close()
})

function rawDatabase(): DatabaseSync {
  const raw = new DatabaseSync(':memory:')
  databases.push(raw)
  raw.exec(`
    CREATE TABLE messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, role TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE memories (id TEXT PRIMARY KEY, category TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE tool_calls (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, tool_id TEXT NOT NULL, declared_json TEXT NOT NULL, created_at TEXT NOT NULL);
  `)
  return raw
}

function sqlite(raw: DatabaseSync): SqliteDatabase {
  return {
    prepare: (statement) => raw.prepare(statement) as unknown as ReturnType<SqliteDatabase['prepare']>,
    exec(statement) { raw.exec(statement); return this },
    pragma: (statement) => raw.prepare(`PRAGMA ${statement}`).get(),
    close: () => raw.close(),
    transaction: (job) => () => {
      raw.exec('BEGIN')
      try {
        const result = job()
        raw.exec('COMMIT')
        return result
      } catch (error) {
        raw.exec('ROLLBACK')
        throw error
      }
    }
  }
}

const window = localDayWindow(new Date(2026, 10, 13, 12, 0, 0))
const inWindow = window.startIso
const yesterday = new Date(new Date(window.startIso).getTime() - 60_000).toISOString()

describe('[FR-RECAP-00] 每日回顾（事实版）', () => {
  it('[FR-RECAP-01] 空数据库返回 hasActivity=false 且所有计数为 0', () => {
    const recap = queryDailyRecap(sqlite(rawDatabase()), window)
    expect(recap.hasActivity).toBe(false)
    expect(recap.date).toBe(window.date)
    expect(recap.messages + recap.memoriesAdded + recap.memoryRecalls + recap.tasksCompleted).toBe(0)
  })

  it('[FR-RECAP-02] 只统计本地自然日内新增的对话/记忆，窗口外不计入', () => {
    const raw = rawDatabase()
    raw.exec(`INSERT INTO messages VALUES ('m1','chat-1','user','今天的问题','${inWindow}')`)
    raw.exec(`INSERT INTO messages VALUES ('m2','chat-1','assistant','今天的回答','${inWindow}')`)
    raw.exec(`INSERT INTO messages VALUES ('m3','chat-2','user','昨天的问题','${yesterday}')`)
    raw.exec(`INSERT INTO memories VALUES ('mem-1','user','今天的偏好','${inWindow}')`)
    raw.exec(`INSERT INTO memories VALUES ('mem-2','user','昨天的偏好','${yesterday}')`)
    const recap = queryDailyRecap(sqlite(raw), window)
    expect(recap.messages).toBe(2)
    expect(recap.conversations).toBe(1)
    expect(recap.memoriesAdded).toBe(1)
    expect(recap.hasActivity).toBe(true)
  })

  it('[FR-RECAP-03] 任务按状态分类：完成/失败/进行中/取消', () => {
    const raw = rawDatabase()
    for (const [index, status] of ['已完成', '部分完成', '失败', '执行中', '等待批准', '已取消', '已中断'].entries()) {
      raw.exec(`INSERT INTO tasks VALUES ('task-${index}','任务','${status}','${inWindow}')`)
    }
    const recap = queryDailyRecap(sqlite(raw), window)
    expect(recap.tasksCompleted).toBe(2)
    expect(recap.tasksFailed).toBe(1)
    expect(recap.tasksActive).toBe(2)
    expect(recap.tasksCancelled).toBe(2)
    expect(recap.hasActivity).toBe(true)
  })

  it('[FR-RECAP-04] 只有真正把记忆带进上下文的轮次才计入回忆触发', () => {
    const raw = rawDatabase()
    raw.exec(`INSERT INTO tool_calls VALUES ('c1','chat-1','prompt','${JSON.stringify({ args: { turnId: 't1', memoryIds: ['mem-1'] } })}','${inWindow}')`)
    raw.exec(`INSERT INTO tool_calls VALUES ('c2','chat-1','prompt','${JSON.stringify({ args: { turnId: 't2', memoryIds: [] } })}','${inWindow}')`)
    raw.exec(`INSERT INTO tool_calls VALUES ('c3','chat-1','prompt','not-json','${inWindow}')`)
    raw.exec(`INSERT INTO tool_calls VALUES ('c4','task-1','filesystem','${JSON.stringify({ args: { memoryIds: ['mem-1'] } })}','${inWindow}')`)
    const recap = queryDailyRecap(sqlite(raw), window)
    expect(recap.memoryRecalls).toBe(1)
    expect(recap.hasActivity).toBe(true)
  })

  it('[FR-RECAP-05] 本地自然日窗口覆盖当天且日期格式正确', () => {
    expect(window.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(new Date(window.endIso).getTime() - new Date(window.startIso).getTime()).toBe(24 * 60 * 60 * 1000)
    const now = Date.now()
    // 用当前时间重新取窗口，确保「现在」落在窗口内。
    const current = localDayWindow()
    expect(Date.parse(current.startIso)).toBeLessThanOrEqual(now)
    expect(Date.parse(current.endIso)).toBeGreaterThan(now)
  })
})
