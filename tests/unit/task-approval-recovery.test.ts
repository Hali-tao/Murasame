import { afterEach, describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { SqliteDatabase } from '../../src/main/data/sqlite-types'
import { executeGoal, type StepCheckpoint, type TaskPlan } from '../../src/main/agent/executor'
vi.mock('electron', () => ({ Notification: { isSupported: () => false } }))
vi.mock('../../src/main/settings', () => ({ getSettings: () => ({ taskNotifications: false }) }))
import { TaskService } from '../../src/main/core/services/task-service'
import { approvalPresentation } from '../../src/shared/task-approval'
const roots: string[] = []
const temp = () => { const root = mkdtempSync(join(tmpdir(), 'approval-recovery-')); roots.push(root); return root }
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { force: true, recursive: true })))
describe('expired approvals and scoped continuation', () => {
  it('marks persisted in-flight steps as needing verification after restart, without claiming they still run', async () => {
    const db = new DatabaseSync(':memory:')
    db.exec(readFileSync('src/main/data/migrations/001_init.sql', 'utf8')); db.exec(readFileSync('src/main/data/migrations/003_trace.sql', 'utf8'))
    try {
      const service = new TaskService(db as unknown as SqliteDatabase); const root = temp(); writeFileSync(join(root, 'a.txt'), 'a')
      const created = await service.create(`按类型整理 ${root}`); if (!created.ok) throw new Error(created.error)
      db.prepare("UPDATE tasks SET status = '执行中' WHERE id = ?").run(created.data.id)
      db.prepare("UPDATE task_steps SET state = '进行中' WHERE task_id = ?").run(created.data.id)
      const restarted = new TaskService(db as unknown as SqliteDatabase)
      expect(restarted.list()[0].status).toBe('已中断')
      expect(restarted.list()[0].steps[0]).toMatchObject({ state: '待核对', detail: expect.stringContaining('尚未恢复执行') })
      expect(existsSync(join(root, 'a.txt'))).toBe(true)
    } finally { db.close() }
  })
  it('shows the exact inherited command arguments that will reach the isolated runner', async () => {
    const root = temp()
    const plan: TaskPlan = { tool: 'terminal', command: 'ignored --unshown-value "two words"', question: '', steps: [{ id: 'run', title: '运行检查', detail: '', expected: '', args: { executable: 'safe-tool' }, checks: [{ kind: 'output-includes', value: 'done' }] }] }
    const pending = await executeGoal({ goal: '检查', root, plan, approved: false, cancelled: false })
    const shown = approvalPresentation(pending.approval!, 'once').steps[0]
    expect(shown.executable).toBe('safe-tool'); expect(shown.argv).toEqual(['--unshown-value', 'two words'])
    let invoked: { executable: string; args: readonly string[] } | undefined
    await executeGoal({ goal: '检查', root, plan, approved: true, cancelled: false, approvalScope: 'once', runner: async (input) => { invoked = input; return { status: 'ok', raw: 'done', exitCode: 0 } } })
    expect(invoked?.args).toEqual(shown.argv)
    expect(invoked?.executable).toBe(shown.executable)
  })
  it.each(['expired', 'denied'] as const)('restores an %s image request after restart without planning a different operation or copying', async (reason) => {
    const db = new DatabaseSync(':memory:')
    db.exec(readFileSync('src/main/data/migrations/001_init.sql', 'utf8')); db.exec(readFileSync('src/main/data/migrations/003_trace.sql', 'utf8'))
    try {
      const service = new TaskService(db as unknown as SqliteDatabase); const target = join(temp(), 'image.png')
      const created = service.openTeammateTask({ title: '生成图片', status: '等待批准', summary: '', result: '', approval: { tool: 'copy-image', target, impact: `生成并新增图片：${target}`, hostPath: target, requestedAt: reason === 'expired' ? 0 : Date.now() } })
      if (reason === 'expired') await service.approve(created.id); else await service.deny(created.id)
      const restarted = new TaskService(db as unknown as SqliteDatabase); let planned = 0; let copied = 0
      restarted.setPlanner(async () => { planned++; throw new Error('图片请求不能重新生成普通计划') })
      restarted.setCopyImage(async () => { copied++; return { ok: true, path: target, bytes: 1 } })
      const result = await restarted.continueTask(created.id, '继续')
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.data.approval).toMatchObject({ tool: 'copy-image', target })
      expect(planned).toBe(0); expect(copied).toBe(0); expect(existsSync(target)).toBe(false)
      const changed = await restarted.deny(created.id); expect(changed.ok).toBe(true)
      const redirected = await restarted.continueTask(created.id, '改为另一个目录')
      expect(redirected.ok).toBe(false); expect(copied).toBe(0)
    } finally { db.close() }
  })
  it('broadcasts the running step while a tool is still pending and its result when it finishes', async () => {
    const db = new DatabaseSync(':memory:')
    db.exec(readFileSync('src/main/data/migrations/001_init.sql', 'utf8')); db.exec(readFileSync('src/main/data/migrations/003_trace.sql', 'utf8'))
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve })
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => { await gate; return new Response('<html><title>Ready</title><body>Ready</body></html>', { status: 200 }) })
    try {
      const service = new TaskService(db as unknown as SqliteDatabase)
      service.setPlanner(async () => ({ tool: 'browser', url: 'https://example.com', question: '', steps: [{ id: 'read', title: '读取网页', detail: '', expected: '', args: { url: 'https://example.com' } }] }))
      const events: import('../../src/shared/types').Task[] = []; service.onChange(task => events.push(task))
      const created = await service.create('打开网页 https://example.com'); if (!created.ok) throw new Error(created.error)
      await service.approve(created.data.id)
      await vi.waitFor(() => expect(events.at(-1)?.steps[0].state).toBe('进行中'))
      expect(events.at(-1)?.toolCalls.find(c => c.agentRole === 'Worker')?.execution.status).toBe('running')
      release(); await service.settled(created.data.id)
      expect(events.at(-1)?.steps[0].state).toBe('完成')
    } finally { release(); fetcher.mockRestore(); db.close() }
  })
  it('makes an expired approval recoverable, refreshes the file manifest, and executes nothing', async () => {
    const db = new DatabaseSync(':memory:')
    db.exec(readFileSync('src/main/data/migrations/001_init.sql', 'utf8'))
    db.exec(readFileSync('src/main/data/migrations/003_trace.sql', 'utf8'))
    try {
      const service = new TaskService(db as unknown as SqliteDatabase); const root = temp(); writeFileSync(join(root, 'a.txt'), 'a')
      const created = await service.create(`按类型整理 ${root}`); if (!created.ok) throw new Error(created.error)
      const row = db.prepare('SELECT approval_json FROM tasks WHERE id = ?').get(created.data.id) as { approval_json: string }
      db.prepare('UPDATE tasks SET approval_json = ? WHERE id = ?').run(JSON.stringify({ ...JSON.parse(row.approval_json), requestedAt: Date.now() - 11 * 60_000 }), created.data.id)
      const expired = await service.approve(created.data.id); if (!expired.ok) throw new Error(expired.error)
      expect(expired.data.status).toBe('待确认'); expect(expired.data.approval).toBeNull()
      writeFileSync(join(root, 'b.txt'), 'b')
      const resumed = await service.continueTask(created.data.id, '继续'); if (!resumed.ok) throw new Error(resumed.error)
      expect(resumed.data.status).toBe('等待批准'); expect(resumed.data.approval?.impact).toContain('b.txt')
      expect(resumed.data.title).toBe(created.data.title)
      expect(existsSync(join(root, 'a.txt'))).toBe(true); expect(existsSync(join(root, 'b.txt'))).toBe(true)
    } finally { db.close() }
  })
  it('does not reuse a task grant for a different tool and includes the actual pending grant in the next approval', async () => {
    const root = temp(); const checkpoints: StepCheckpoint[] = []; let called = 0
    const plan: TaskPlan = { tool: 'filesystem', question: '', steps: [
      { id: 'list', title: '读取目录', detail: '', expected: '', args: { action: 'list' } },
      { id: 'run', tool: 'terminal', title: '执行命令', detail: '', expected: '', dependsOn: ['list'], args: { executable: 'node', argv: ['--version'] }, checks: [{ kind: 'output-includes', value: 'v22' }] }
    ] }
    const result = await executeGoal({ goal: 'task', root, plan, approved: true, cancelled: false, approvalScope: 'task', onCheckpoint: c => checkpoints.push(c), runner: async () => { called++; return { status: 'ok', raw: 'v22', exitCode: 0 } } })
    expect(called).toBe(0); expect(result.status).toBe('等待批准'); expect(result.approval?.tool).toBe('terminal')
    expect(JSON.parse(result.approval!.impact).next[0]).toMatchObject({ id: 'run', title: '执行命令', workspace: '.', network: 'none' })
    const resumed = await executeGoal({ goal: 'task', root, plan, approved: true, cancelled: false, approvalScope: 'task', checkpoints, runner: async () => { called++; return { status: 'ok', raw: 'v22', exitCode: 0 } } })
    expect(called).toBe(1); expect(resumed.status).toBe('已完成')
  })
})
