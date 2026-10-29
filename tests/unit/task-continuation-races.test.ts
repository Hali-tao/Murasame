import { afterEach, describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SqliteDatabase } from '../../src/main/data/sqlite-types'
import type { TaskPlan } from '../../src/main/agent/executor'

vi.mock('electron', () => ({ Notification: { isSupported: () => false } }))
vi.mock('../../src/main/settings', () => ({ getSettings: () => ({ taskNotifications: false }) }))
import { TaskService } from '../../src/main/core/services/task-service'

const databases: DatabaseSync[] = []
const roots: string[] = []
afterEach(() => { vi.restoreAllMocks(); databases.splice(0).forEach(db => db.close()); roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })) })
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function plan(root: string, label: string, question = ''): TaskPlan {
  return { tool: 'filesystem', root, question, steps: [{ id: 'write', title: label, detail: label, expected: '', args: { action: 'write', path: `${label}.txt`, content: label }, checks: [{ kind: 'file-content', path: `${label}.txt`, value: label }] }] }
}
async function fixture(withModel = false) {
  const root = mkdtempSync(join(tmpdir(), 'task-continuation-')); roots.push(root)
  const db = new DatabaseSync(':memory:'); databases.push(db)
  db.exec(readFileSync('src/main/data/migrations/001_init.sql', 'utf8')); db.exec(readFileSync('src/main/data/migrations/003_trace.sql', 'utf8'))
  const service = new TaskService(db as unknown as SqliteDatabase)
  if (withModel) {
    const binding = { id: 'test-model', endpoint: 'http://127.0.0.1:12345/v1', model: 'fixture', apiKey: 'synthetic-key' }
    service.setModelSnapshotProvider(() => binding, () => binding)
  }
  service.setPlanner(async () => plan(root, 'original', '请补充要求'))
  const created = await service.create('创建文件任务', root)
  if (!created.ok) throw new Error(created.error)
  const id = created.data.id
  const savedPlan = () => (db.prepare('SELECT plan_json FROM task_execution_plans WHERE task_id = ?').get(id) as { plan_json: string }).plan_json
  return { root, db, service, id, savedPlan, task: () => service.list().find(task => task.id === id)! }
}

describe('task continuation result ownership', () => {
  it('does not resurrect a cancelled task or replace its saved plan when planning returns late', async () => {
    const { root, service, id, savedPlan, task } = await fixture()
    const before = savedPlan(); const later = deferred<TaskPlan>(); service.setPlanner(() => later.promise)
    const events: string[] = []; service.onChange(task => events.push(task.status))
    const pending = service.continueTask(id, '写新文件')
    await service.cancel(id); const cancelled = task()
    later.resolve(plan(root, 'late')); const result = await pending
    expect(result.ok).toBe(false)
    expect(task()).toEqual(cancelled); expect(savedPlan()).toBe(before)
    expect(events).toEqual(['已取消'])
    expect(task().status).toBe('已取消'); expect(existsSync(join(root, 'late.txt'))).toBe(false)
  })

  it.each(['older-first', 'newer-first'] as const)('uses only the latest request with %s completion', async order => {
    const { root, service, id, task, savedPlan } = await fixture()
    const older = deferred<TaskPlan>(); const newer = deferred<TaskPlan>()
    service.setPlanner(goal => goal.includes('新要求') ? newer.promise : older.promise)
    const first = service.continueTask(id, '旧要求'); const second = service.continueTask(id, '新要求')
    let firstResult
    if (order === 'older-first') {
      older.resolve(plan(root, 'older')); firstResult = await first
      expect(task().status).toBe('待确认'); expect(savedPlan()).not.toContain('older')
      newer.resolve(plan(root, 'newer'))
    } else { newer.resolve(plan(root, 'newer')); await second; older.resolve(plan(root, 'older')); firstResult = await first }
    expect((await second).ok).toBe(true); expect(firstResult.ok).toBe(false)
    expect(task().title).toContain('新要求'); expect(task().title).not.toContain('旧要求')
    expect(savedPlan()).toContain('newer'); expect(savedPlan()).not.toContain('older')
    await service.approve(id, 'once'); await service.settled(id)
    expect(task().status).toBe('已完成'); expect(readFileSync(join(root, 'newer.txt'), 'utf8')).toBe('newer')
    expect(existsSync(join(root, 'older.txt'))).toBe(false)
  })

  it('does not reactivate an older request when the latest planner fails', async () => {
    const { root, service, id, task, savedPlan } = await fixture()
    const before = savedPlan(); const older = deferred<TaskPlan>(); const newer = deferred<TaskPlan>()
    service.setPlanner(goal => goal.includes('新要求') ? newer.promise : older.promise)
    const first = service.continueTask(id, '旧要求'); const second = service.continueTask(id, '新要求')
    newer.reject(new Error('temporary planner failure')); expect((await second).ok).toBe(false)
    older.resolve(plan(root, 'older')); expect((await first).ok).toBe(false)
    expect(task().status).toBe('待确认'); expect(savedPlan()).toBe(before)
    expect(task().title).toBe('创建文件任务')
  })

  it('keeps cancellation while checkpoint verification is pending and never persists its proposed replacement', async () => {
    const { root, service, id, task, savedPlan } = await fixture()
    const browserStep = { id: 'read', tool: 'browser' as const, title: 'read', detail: 'read', expected: '', args: { url: 'https://example.com/source' }, checks: [{ kind: 'output-includes' as const, value: 'source' }] }
    const make = (label: string): TaskPlan => ({ ...plan(root, label), steps: [browserStep, { ...plan(root, label).steps[0], dependsOn: ['read'] }] })
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('source', { status: 200 }))
    service.setPlanner(async () => make('original'))
    await service.continueTask(id, '读取后写文件'); await service.approve(id, 'once'); await service.settled(id); await service.deny(id)
    expect(task().status).toBe('待确认')
    const before = savedPlan(); const entered = deferred<void>(); const release = deferred<void>()
    fetcher.mockImplementation(async () => { entered.resolve(); await release.promise; return new Response('source', { status: 200 }) })
    service.setPlanner(async () => make('replacement'))
    const pending = service.continueTask(id, '换成新文件')
    await entered.promise
    const planDuringPreview = savedPlan()
    await service.cancel(id); const cancelled = task()
    release.resolve(); const result = await pending
    expect(result.ok).toBe(false); expect(planDuringPreview).toBe(before); expect(savedPlan()).toBe(before)
    expect(task()).toEqual(cancelled); expect(existsSync(join(root, 'replacement.txt'))).toBe(false)
  })

  it('keeps independent tasks separate and allows an explicit new continuation after cancellation', async () => {
    const { root, service, id, task } = await fixture()
    const secondCreated = await service.create('另一个文件任务', root); if (!secondCreated.ok) throw new Error(secondCreated.error)
    const secondId = secondCreated.data.id
    const first = deferred<TaskPlan>(); const second = deferred<TaskPlan>()
    service.setPlanner(goal => goal.includes('另一个') ? second.promise : first.promise)
    const one = service.continueTask(id, '第一次'); const two = service.continueTask(secondId, '第二次')
    await service.cancel(id); first.resolve(plan(root, 'cancelled')); second.resolve(plan(root, 'independent'))
    await one; expect((await two).ok).toBe(true)
    expect(task().status).toBe('已取消'); expect(service.list().find(task => task.id === secondId)?.status).toBe('等待批准')
    service.setPlanner(async () => plan(root, 'resumed'))
    expect((await service.continueTask(id, '重新开始')).ok).toBe(true)
    await service.approve(id); await service.settled(id)
    expect(task().status).toBe('已完成'); expect(readFileSync(join(root, 'resumed.txt'), 'utf8')).toBe('resumed')
    expect(existsSync(join(root, 'cancelled.txt'))).toBe(false)
  })

  it('retains the last plan and task when the candidate workspace cannot be prepared', async () => {
    const { root, service, id, task, savedPlan } = await fixture()
    const before = savedPlan(); const previous = task()
    const candidate = plan(root, 'invalid'); candidate.steps[0].workspace = '..'; candidate.steps[0].outputs = [{ path: 'out.txt' }]
    service.setPlanner(async () => candidate)
    const result = await service.continueTask(id, '尝试新计划')
    expect(result.ok).toBe(false); expect(savedPlan()).toBe(before); expect(task()).toEqual(previous)
  })

  it('previews a newly selected summary workflow with the original bound model and saves its approval receipt', async () => {
    const { root, db, service, id, task, savedPlan } = await fixture(true)
    writeFileSync(join(root, 'source.md'), '合成资料，没有真实用户内容。')
    service.setPlanner(async () => ({ tool: 'filesystem', root, question: '', steps: [], workflow: { kind: 'summarize-files', sources: ['source.md'], outputPath: 'summary.md', instruction: '总结资料' } }))
    const result = await service.continueTask(id, '改为摘要')
    expect(result.ok).toBe(true); expect(task().status).toBe('等待批准')
    expect(savedPlan()).toContain('summarize-files')
    expect(JSON.parse(task().approval!.impact)).toMatchObject({ stage: 'awaiting-source-approval', recipient: { id: 'test-model' } })
    const row = db.prepare('SELECT checkpoint_json FROM task_grounded_checkpoints WHERE task_id = ?').get(id) as { checkpoint_json: string }
    expect(JSON.parse(row.checkpoint_json)).toMatchObject({ modelSnapshotId: 'test-model', stage: 'awaiting-source-approval', dispatchCount: 0 })
    expect(existsSync(join(root, 'summary.md'))).toBe(false)
  })
})
