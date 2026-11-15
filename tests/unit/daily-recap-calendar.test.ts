import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const serviceUrl = new URL('../../src/main/core/services/daily-recap-service.ts', import.meta.url).href
const cases = [
  { name: '纽约春季23小时日', zone: 'America/New_York', date: [2026, 2, 8], end: '2026-03-09T04:00:00.000Z' },
  { name: '纽约秋季25小时日', zone: 'America/New_York', date: [2026, 10, 1], end: '2026-11-02T05:00:00.000Z' },
  { name: '豪勋爵岛23.5小时日', zone: 'Australia/Lord_Howe', date: [2026, 9, 4], end: '2026-10-04T13:00:00.000Z' },
  { name: '上海普通月末', zone: 'Asia/Shanghai', date: [2026, 1, 28], end: '2026-02-28T16:00:00.000Z' },
  { name: '上海跨年日', zone: 'Asia/Shanghai', date: [2026, 11, 31], end: '2026-12-31T16:00:00.000Z' }
]

describe('[FR-RECAP-10] 本地自然日按日历划分，不假定固定24小时', () => {
  it.each(cases)('[FR-RECAP-11] $name 只统计当天事实，不多算次日也不遗漏深夜', ({ zone, date, end }) => {
    const script = `
      import { DatabaseSync } from 'node:sqlite';
      import { localDayWindow, queryDailyRecap } from ${JSON.stringify(serviceUrl)};
      const [year, month, day] = ${JSON.stringify(date)};
      const window = localDayWindow(new Date(year, month, day, 12));
      const db = new DatabaseSync(':memory:');
      try {
        db.exec('CREATE TABLE messages (conversation_id TEXT, created_at TEXT); CREATE TABLE memories (created_at TEXT); CREATE TABLE tasks (status TEXT, created_at TEXT); CREATE TABLE tool_calls (tool_id TEXT, declared_json TEXT, created_at TEXT);');
        const times = [new Date(year, month, day), new Date(year, month, day, 23, 59), new Date(year, month, day + 1, 0, 1)];
        for (const [index, time] of times.entries()) {
          const iso = time.toISOString();
          db.prepare('INSERT INTO messages VALUES (?, ?)').run('calendar-chat-' + index, iso);
          db.prepare('INSERT INTO memories VALUES (?)').run(iso);
          db.prepare('INSERT INTO tasks VALUES (?, ?)').run('已完成', iso);
          db.prepare('INSERT INTO tool_calls VALUES (?, ?, ?)').run('prompt', JSON.stringify({ args: { memoryIds: ['fixture-memory'] } }), iso);
        }
        console.log(JSON.stringify({ window, recap: queryDailyRecap(db, window) }));
      } finally { db.close(); }
    `
    // TZ only applies to this child, so parallel tests and Windows keep their timezone.
    const result = JSON.parse(execFileSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', script], {
      env: { ...process.env, TZ: zone }, encoding: 'utf8', timeout: 10_000,
      stdio: ['ignore', 'pipe', 'pipe']
    })) as { window: { endIso: string }; recap: Record<string, unknown> }
    expect.soft(result.window.endIso).toBe(end)
    expect.soft(result.recap).toMatchObject({ messages: 2, conversations: 2, memoriesAdded: 2, tasksCompleted: 2, memoryRecalls: 2 })
  })
})
