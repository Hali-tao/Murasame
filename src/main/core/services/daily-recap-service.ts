import type { SqliteDatabase } from '../../data/sqlite-types'
import type { DailyRecap } from '../../../shared/types'

export interface DailyWindow {
  /** 本地日期 YYYY-MM-DD。 */
  date: string
  /** 本地自然日的起止（ISO/UTC 字符串，与数据库 created_at 一致）。 */
  startIso: string
  endIso: string
}

const pad = (value: number): string => String(value).padStart(2, '0')

/** 本轮回顾只统计「本地自然日」内的真实事实。 */
export function localDayWindow(now: Date = new Date()): DailyWindow {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  return {
    date: `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`,
    startIso: start.toISOString(),
    endIso: end.toISOString()
  }
}

function count(db: SqliteDatabase, sql: string, ...params: unknown[]): number {
  const row = db.prepare(sql).get(...params) as { n?: number } | undefined
  return Number(row?.n ?? 0)
}

/** 只从本地数据库汇总今天真实发生的事；没有活动时 hasActivity=false（UI 显示「还没有可回顾的记录」）。 */
export function queryDailyRecap(db: SqliteDatabase, window: DailyWindow): DailyRecap {
  const messages = count(db, 'SELECT COUNT(*) AS n FROM messages WHERE created_at >= ? AND created_at < ?', window.startIso, window.endIso)
  const conversations = count(db, 'SELECT COUNT(DISTINCT conversation_id) AS n FROM messages WHERE created_at >= ? AND created_at < ?', window.startIso, window.endIso)
  const memoriesAdded = count(db, 'SELECT COUNT(*) AS n FROM memories WHERE created_at >= ? AND created_at < ?', window.startIso, window.endIso)

  let tasksCompleted = 0
  let tasksFailed = 0
  let tasksActive = 0
  let tasksCancelled = 0
  const taskRows = db.prepare('SELECT status, COUNT(*) AS n FROM tasks WHERE created_at >= ? AND created_at < ? GROUP BY status').all(window.startIso, window.endIso) as Array<{ status: string; n: number }>
  for (const row of taskRows) {
    const amount = Number(row.n ?? 0)
    switch (row.status) {
      case '已完成':
      case '部分完成':
        tasksCompleted += amount
        break
      case '失败':
        tasksFailed += amount
        break
      case '已取消':
      case '已中断':
        tasksCancelled += amount
        break
      default:
        tasksActive += amount
    }
  }

  let memoryRecalls = 0
  const recallRows = db.prepare(`SELECT declared_json FROM tool_calls WHERE tool_id = 'prompt' AND created_at >= ? AND created_at < ?`).all(window.startIso, window.endIso) as Array<{ declared_json: string }>
  for (const row of recallRows) {
    try {
      const args = (JSON.parse(row.declared_json) as { args?: { memoryIds?: unknown } } | null)?.args
      if (args && Array.isArray(args.memoryIds) && args.memoryIds.length > 0) memoryRecalls += 1
    } catch {
      // 损坏的历史记录不参与统计，也不让整页回顾失败。
    }
  }

  const hasActivity = messages + memoriesAdded + memoryRecalls + tasksCompleted + tasksFailed + tasksActive + tasksCancelled > 0
  return {
    date: window.date,
    messages,
    conversations,
    memoriesAdded,
    memoryRecalls,
    tasksCompleted,
    tasksFailed,
    tasksActive,
    tasksCancelled,
    hasActivity
  }
}
