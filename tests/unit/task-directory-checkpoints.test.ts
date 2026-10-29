import { afterEach, describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { executeGoal, type StepCheckpoint, type TaskPlan } from '../../src/main/agent/executor'
import type { SqliteDatabase } from '../../src/main/data/sqlite-types'
vi.mock('electron', () => ({ Notification: { isSupported: () => false } }))
vi.mock('../../src/main/settings', () => ({ getSettings: () => ({ taskNotifications: false }) }))
import { TaskService } from '../../src/main/core/services/task-service'

const roots: string[] = []
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })))
function fixture(listPath = '.', outputDirectory = '', workspace = '.') {
  const root = mkdtempSync(join(tmpdir(), 'directory-checkpoint-')); roots.push(root)
  const work = join(root, workspace); const observed = join(work, listPath)
  mkdirSync(observed, { recursive: true }); writeFileSync(join(observed, 'input.txt'), 'synthetic input')
  const a = join(outputDirectory, 'a.txt'); const b = join(outputDirectory, 'b.txt')
  const plan: TaskPlan = { tool: 'filesystem', root, question: '', steps: [
    { id: 'inspect', workspace, title: '读取目录', detail: '', expected: '', args: { action: 'list', path: listPath } },
    { id: 'a', workspace, dependsOn: ['inspect'], title: '创建a', detail: '', expected: '', args: { action: 'write', path: a, content: 'first result' } },
    { id: 'b', workspace, dependsOn: ['a'], title: '创建b', detail: '', expected: '', args: { action: 'write', path: b, content: 'second result' } }
  ] }
  const checkpoints: StepCheckpoint[] = []
  const run = (saved = checkpoints) => executeGoal({ goal: '读取目录并创建两个文件', root, plan, approved: true, cancelled: false, approvalScope: 'once', checkpoints: [...saved], onCheckpoint: checkpoint => {
    const index = checkpoints.findIndex(item => item.stepId === checkpoint.stepId)
    if (index >= 0) checkpoints[index] = checkpoint; else checkpoints.push(checkpoint)
  } })
  return { root, work, observed, plan, checkpoints, run, a: join(work, a), b: join(work, b) }
}
async function pause(f: ReturnType<typeof fixture>, approvals = 2) {
  for (let i = 0; i < approvals; i++) expect((await f.run()).status).toBe('等待批准')
  expect(readFileSync(f.a, 'utf8')).toBe('first result')
}

describe('resuming directory observations after verified task additions', () => {
  it.each([
    ['.', '', '.'],
    ['notes', 'notes', '.'],
    ['.', 'nested/deeper', '.'],
    ['.', 'nested', 'workspace']
  ])('finishes sequential approvals for list=%s outputs=%s workspace=%s without rewriting history', async (listPath, outputDirectory, workspace) => {
    const f = fixture(listPath, outputDirectory, workspace); await pause(f)
    const original = JSON.stringify(f.checkpoints)
    const result = await f.run()
    expect(result.status).toBe('已完成')
    expect(result.calls.filter(call => call.agentRole === 'Worker').map(call => call.stepId)).toEqual(['b'])
    expect(readFileSync(f.b, 'utf8')).toBe('second result'); expect(readFileSync(f.a, 'utf8')).toBe('first result')
    expect(JSON.stringify(f.checkpoints.slice(0, 2))).toBe(original)
    expect(result.calls.some(call => call.agentRole === 'Critic' && call.stepId === 'inspect' && call.evidence.some(item => item.matched && item.expected.includes('本任务')))).toBe(true)
  })

  it('uses dependencies rather than plan or checkpoint storage order', async () => {
    const f = fixture(); f.plan.steps.reverse(); await pause(f)
    const result = await f.run([...f.checkpoints].reverse())
    expect(result.status).toBe('已完成'); expect(readFileSync(f.b, 'utf8')).toBe('second result')
  })

  it('does not add a verified output from outside the observed subdirectory', async () => {
    const f = fixture('notes'); await pause(f)
    expect((await f.run()).status).toBe('已完成')
    expect(readFileSync(f.b, 'utf8')).toBe('second result')
  })

  it.each([true, false])('accepts legacy checkpoints only when the whole plan still matches: %s', async samePlan => {
    const f = fixture(); await pause(f)
    const saved = structuredClone(f.checkpoints)
    for (const checkpoint of saved) delete (checkpoint as Partial<StepCheckpoint>).stepHash
    if (!samePlan) saved[1].planHash = 'unrelated-plan'
    const result = await f.run(saved)
    expect(result.status).toBe(samePlan ? '已完成' : '失败')
    expect(existsSync(f.b)).toBe(samePlan)
  })

  it('treats directory enumeration order as irrelevant while preserving the saved observation', async () => {
    const f = fixture(); writeFileSync(join(f.observed, 'z.txt'), 'synthetic')
    await pause(f)
    const saved = structuredClone(f.checkpoints)
    saved[0].output.run.raw = JSON.stringify((JSON.parse(saved[0].output.run.raw) as string[]).reverse())
    const original = JSON.stringify(saved)
    expect((await f.run(saved)).status).toBe('已完成')
    expect(JSON.stringify(saved)).toBe(original)
  })

  it.each(['external-addition', 'original-removal', 'output-edit'] as const)('still blocks %s without replay or further writes', async change => {
    const f = fixture(); await pause(f)
    if (change === 'external-addition') writeFileSync(join(f.observed, 'external.txt'), 'user file')
    if (change === 'original-removal') unlinkSync(join(f.observed, 'input.txt'))
    if (change === 'output-edit') writeFileSync(f.a, 'user revision')
    const result = await f.run()
    expect(result.status).toBe('失败'); expect(result.calls.filter(call => call.agentRole === 'Worker')).toHaveLength(0)
    expect(existsSync(f.b)).toBe(false)
    expect(readFileSync(f.a, 'utf8')).toBe(change === 'output-edit' ? 'user revision' : 'first result')
  })

  it('does not hide a changed source file behind an allowed directory addition', async () => {
    const f = fixture()
    f.plan.steps.splice(1, 0, { id: 'source', dependsOn: ['inspect'], title: '读取来源', detail: '', expected: '', args: { action: 'read', path: 'input.txt' } })
    f.plan.steps[2].dependsOn = ['source']
    await pause(f, 3)
    writeFileSync(join(f.observed, 'input.txt'), 'changed source')
    const result = await f.run()
    expect(result.status).toBe('失败'); expect(result.result).toContain('source'); expect(existsSync(f.b)).toBe(false)
  })

  it.each(['incompatible', 'unfinished', 'unknown', 'failed', 'move', 'delete'] as const)('does not whitelist %s effects', async kind => {
    const f = fixture(); await pause(f)
    const saved = structuredClone(f.checkpoints); const output = saved.find(item => item.stepId === 'a')!
    if (kind === 'incompatible') output.stepHash = 'different-plan'
    if (kind === 'unfinished') output.completed = false
    if (kind === 'unknown') output.outcomeKnown = false
    if (kind === 'failed') output.output.run.status = 'error'
    if (kind === 'move') output.output.effects[0].source = join(f.root, 'previous.txt')
    if (kind === 'delete') output.output.effects[0].operation = 'delete'
    const result = await f.run(saved)
    expect(result.status).toBe('失败'); expect(existsSync(f.b)).toBe(false)
    expect(result.calls.filter(call => call.agentRole === 'Worker')).toHaveLength(0)
  })

  it('requires an actual downstream dependency even if another step created the file', async () => {
    const f = fixture(); f.plan.steps[1].dependsOn = []; await pause(f)
    const result = await f.run()
    expect(result.status).toBe('失败'); expect(existsSync(f.b)).toBe(false)
  })

  it.each(['source-path', 'dependency-edge'] as const)('does not adopt an old output after its intermediate %s changes', async change => {
    const f = fixture(); writeFileSync(join(f.root, 'new.txt'), 'new source already present')
    f.plan.steps.splice(1, 0, { id: 'source', dependsOn: ['inspect'], title: '读取依据', detail: '', expected: '', args: { action: 'read', path: 'input.txt' } })
    f.plan.steps[2].dependsOn = ['source']
    await pause(f, 3)
    if (change === 'source-path') f.plan.steps[1].args!.path = 'new.txt'
    else f.plan.steps[1].dependsOn = []
    const result = await f.run()
    expect(result.status).toBe('失败')
    expect(result.calls.filter(call => call.agentRole === 'Worker')).toHaveLength(0)
    expect(existsSync(f.b)).toBe(false); expect(readFileSync(f.a, 'utf8')).toBe('first result')
  })

  it('does not use a compatible path through the graph to hide a changed sibling prerequisite', async () => {
    const f = fixture(); writeFileSync(join(f.root, 'new.txt'), 'new source already present')
    f.plan.steps.splice(1, 0, { id: 'source', dependsOn: [], title: '独立来源', detail: '', expected: '', args: { action: 'read', path: 'input.txt' } })
    f.plan.steps[2].dependsOn = ['inspect', 'source']
    await pause(f, 3)
    f.plan.steps[1].args!.path = 'new.txt'
    const result = await f.run()
    expect(result.status).toBe('失败')
    expect(result.calls.filter(call => call.agentRole === 'Worker')).toHaveLength(0)
    expect(existsSync(f.b)).toBe(false)
  })

  it('keeps a real service replan blocked when the source behind a completed output changes', async () => {
    const f = fixture(); writeFileSync(join(f.root, 'new.txt'), 'new source already present')
    f.plan.steps.splice(1, 0, { id: 'source', dependsOn: ['inspect'], title: '读取依据', detail: '', expected: '', args: { action: 'read', path: 'input.txt' } })
    f.plan.steps[2].dependsOn = ['source']
    const db = new DatabaseSync(':memory:')
    db.exec(readFileSync('src/main/data/migrations/001_init.sql', 'utf8')); db.exec(readFileSync('src/main/data/migrations/003_trace.sql', 'utf8'))
    try {
      const service = new TaskService(db as unknown as SqliteDatabase); service.setPlanner(async () => f.plan)
      const made = await service.create('创建两个文件', f.root); if (!made.ok) throw new Error(made.error)
      for (let i = 0; i < 3; i++) { await service.approve(made.data.id, 'once'); await service.settled(made.data.id) }
      await service.deny(made.data.id)
      f.plan.steps[1].args!.path = 'new.txt'
      const continued = await service.continueTask(made.data.id, '改用新的来源'); if (!continued.ok) throw new Error(continued.error)
      expect(continued.data.status).toBe('失败'); expect(continued.data.approval).toBeNull()
      expect(continued.data.toolCalls.filter(call => call.agentRole === 'Worker' && (call.declared.args as { phase?: string }).phase === 'result')).toHaveLength(3)
      expect(readFileSync(f.a, 'utf8')).toBe('first result'); expect(existsSync(f.b)).toBe(false)
    } finally { db.close() }
  })

  it('restores from persisted SQLite checkpoints after service recreation and executes each worker only once', async () => {
    const f = fixture(); const db = new DatabaseSync(':memory:')
    db.exec(readFileSync('src/main/data/migrations/001_init.sql', 'utf8')); db.exec(readFileSync('src/main/data/migrations/003_trace.sql', 'utf8'))
    try {
      const first = new TaskService(db as unknown as SqliteDatabase); first.setPlanner(async () => f.plan)
      const made = await first.create('创建两个文件', f.root); if (!made.ok) throw new Error(made.error)
      for (let i = 0; i < 2; i++) { await first.approve(made.data.id, 'once'); await first.settled(made.data.id) }
      const restarted = new TaskService(db as unknown as SqliteDatabase)
      const continued = await restarted.continueTask(made.data.id, '继续'); if (!continued.ok) throw new Error(continued.error)
      expect(continued.data.status).toBe('等待批准')
      await restarted.approve(made.data.id, 'once'); await restarted.settled(made.data.id)
      const result = restarted.list()[0]
      expect(result.status).toBe('已完成'); expect(readFileSync(f.b, 'utf8')).toBe('second result')
      const workers = result.toolCalls.filter(call => call.agentRole === 'Worker' && (call.declared.args as { phase?: string }).phase === 'result')
      expect(workers).toHaveLength(3); expect(new Set(workers.map(call => call.stepId)).size).toBe(3)
    } finally { db.close() }
  })
})
