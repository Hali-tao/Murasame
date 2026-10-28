import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import type { SqliteDatabase } from '../../src/main/data/sqlite-types'
import { executeGoal, type TaskPlan } from '../../src/main/agent/executor'
vi.mock('electron', () => ({ Notification: { isSupported: () => false } }))
vi.mock('../../src/main/settings', () => ({ getSettings: () => ({ taskNotifications: false }) }))
import { TaskService } from '../../src/main/core/services/task-service'
const dirs: string[] = []
const stages: string[] = []
function temp(): string { const root = mkdtempSync(join(tmpdir(), 'murasame-checkpoint-')); dirs.push(root); return root }
afterEach(async () => { const { removeStage } = await import('../../src/main/task/staging'); for (const stage of stages.splice(0)) await removeStage(stage); vi.unstubAllGlobals(); dirs.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })) })
function db(): SqliteDatabase { const db = new DatabaseSync(':memory:'); db.exec(readFileSync('src/main/data/migrations/001_init.sql', 'utf8')); db.exec(readFileSync('src/main/data/migrations/003_trace.sql', 'utf8')); return db as unknown as SqliteDatabase }
function writes(root: string): TaskPlan { return { tool: 'filesystem', root, question: '', steps: [ { id: 'a', title: 'first', detail: 'write a', expected: '', args: { action: 'write', path: 'a.txt', content: 'first' }, checks: [{ kind: 'file-content', path: 'a.txt', value: 'first' }] }, { id: 'b', dependsOn: ['a'], title: 'second', detail: 'write b', expected: '', args: { action: 'write', path: 'b.txt', content: 'second' }, checks: [{ kind: 'file-content', path: 'b.txt', value: 'second' }] } ] } }
describe('task graph and durable approval checkpoints', () => {
  it('consumes once for exactly one dispatch and resumes without repeating the completed write', async () => {
    const database = db(); const service = new TaskService(database); const root = temp(); service.setPlanner(async () => writes(root))
    const made = await service.create(`创建任务 ${root}`); if (!made.ok) throw new Error(made.error)
    await service.approve(made.data.id, 'once'); await service.settled(made.data.id)
    const pending = service.list()[0]; expect(pending.status).toBe('等待批准'); expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('first'); expect(existsSync(join(root, 'b.txt'))).toBe(false)
    await service.approve(made.data.id, 'once'); await service.settled(made.data.id)
    expect(service.list()[0].status).toBe('已完成'); expect(readFileSync(join(root, 'b.txt'), 'utf8')).toBe('second'); expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('first'); database.close()
  })
  it('restores verified checkpoints after restart and never overwrites a completed output', async () => {
    const database = db(); const root = temp(); const first = new TaskService(database); first.setPlanner(async () => writes(root))
    const made = await first.create(`创建任务 ${root}`); if (!made.ok) throw new Error(made.error)
    await first.approve(made.data.id, 'once'); await first.settled(made.data.id)
    const reopened = new TaskService(database); const continued = await reopened.continueTask(made.data.id, '继续'); expect(continued.ok).toBe(true)
    await reopened.approve(made.data.id, 'task'); await reopened.settled(made.data.id)
    expect(reopened.list()[0].status).toBe('已完成'); expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('first'); expect(readFileSync(join(root, 'b.txt'), 'utf8')).toBe('second'); database.close()
  })
  it('respects a dependency graph whose prerequisites appear later in the plan', async () => {
    const root = temp(); const plan = writes(root); plan.steps.reverse()
    const result = await executeGoal({ goal: 'write both', root, plan, approved: true, cancelled: false })
    expect(result.status).toBe('已完成'); expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('first'); expect(readFileSync(join(root, 'b.txt'), 'utf8')).toBe('second')
    expect(result.calls.filter((call) => call.agentRole === 'Worker').map((call) => call.stepId)).toEqual(['a', 'b'])
  })
  it('runs two independent read-only tickets concurrently while keeping their contexts distinct', async () => {
    const root = temp(); let active = 0; let peak = 0; const releases: Array<() => void> = []
    vi.stubGlobal('fetch', async () => { active += 1; peak = Math.max(peak, active); await new Promise<void>((resolve) => { releases.push(resolve); if (releases.length >= 2) releases.forEach((release) => release()) }); active -= 1; return new Response('visible target', { status: 200 }) })
    const plan: TaskPlan = { tool: 'browser', question: '', steps: ['a','b'].map((id) => ({ id, dependsOn: [], tool: 'browser', title: id, detail: id, expected: '', args: { url: `https://example.com/${id}` }, checks: [{ kind: 'output-includes', value: 'target' }] })) }
    const result = await executeGoal({ goal: 'read pages', root, plan, approved: true, cancelled: false })
    expect(result.status).toBe('已完成'); expect(peak).toBe(2)
    const ids = result.calls.filter((call) => call.agentRole === 'Worker').map((call) => (call.args as { ticket: { id: string } }).ticket.id); expect(new Set(ids).size).toBe(2)
  }, 1500)
})
describe('terminal staging and explicit exports', () => {
  it('exports declared outputs and pauses for new approval before exporting undeclared changes', async () => {
    const { createTaskRunner } = await import('../../src/main/isolation/task-runner')
    const root = temp(); writeFileSync(join(root, 'input.txt'), 'original'); let mounted = ''; let executed = 0
    const runner = createTaskRunner(async (_command, args) => {
      if (args[0] === 'image' && args[1] === 'inspect') return '2'
      if (args[0] === 'inspect') return 'true'
      if (args[0] === 'ps') return ''
      if (args[0] === 'run') { mounted = args[args.indexOf('--mount') + 1].match(/source=(.*),target=\/shared/)![1]; return 'stage-container' }
      if (args[0] === 'exec' && args.some((arg) => arg.includes('MURASAME_EXIT_'))) { executed += 1; writeFileSync(join(mounted, 'out.txt'), 'done'); writeFileSync(join(mounted, 'extra.txt'), 'pending'); const marker = args.find((arg) => arg.includes('MURASAME_EXIT_'))!.match(/MURASAME_EXIT_[a-z0-9]+/)![0]; return `done\n${marker}=0\n` }
      return ''
    })
    const first = await runner({ root, executable: 'python3', args: ['script.py'], timeoutMs: 2000, outputs: [{ path: 'out.txt', expectedContent: 'done', baselineHash: null }] })
    expect(mounted).not.toBe(root); expect(readFileSync(join(root, 'out.txt'), 'utf8')).toBe('done'); expect(existsSync(join(root, 'extra.txt'))).toBe(false); expect(first.awaitingExport?.changes.map((change) => change.path)).toEqual(['extra.txt'])
    const resumed = await runner({ root, executable: '', args: [], timeoutMs: 2000, resumeStageId: first.awaitingExport!.stageId })
    expect(resumed.status).toBe('ok'); expect(executed).toBe(1); expect(readFileSync(join(root, 'extra.txt'), 'utf8')).toBe('pending'); expect(readFileSync(join(root, 'input.txt'), 'utf8')).toBe('original')
  })
  it('never overwrites a changed original while exporting an explicitly approved existing output', async () => {
    const { createTaskRunner } = await import('../../src/main/isolation/task-runner')
    const { createHash } = await import('node:crypto'); const root = temp(); writeFileSync(join(root, 'code.txt'), 'before'); let mounted = ''
    const runner = createTaskRunner(async (_command, args) => { if (args[0] === 'image' && args[1] === 'inspect') return '2'
      if (args[0] === 'inspect') return 'true'
      if (args[0] === 'ps') return ''; if (args[0] === 'run') { mounted = args[args.indexOf('--mount') + 1].match(/source=(.*),target=\/shared/)![1]; return 'conflict-container' } if (args[0] === 'exec' && args.some((arg) => arg.includes('MURASAME_EXIT_'))) { writeFileSync(join(mounted, 'code.txt'), 'model change'); writeFileSync(join(root, 'code.txt'), 'user change'); const marker = args.find((arg) => arg.includes('MURASAME_EXIT_'))!.match(/MURASAME_EXIT_[a-z0-9]+/)![0]; return `\n${marker}=0\n` } return '' })
    const result = await runner({ root, executable: 'python3', args: [], timeoutMs: 2000, outputs: [{ path: 'code.txt', overwrite: true, baselineHash: createHash('sha256').update('before').digest('hex') }] })
    if (result.awaitingExport) stages.push(result.awaitingExport.stageId)
    expect(result.status).toBe('error'); expect(readFileSync(join(root, 'code.txt'), 'utf8')).toBe('user change'); expect(result.raw).toContain('变化')
  })
})
it('resumes a retained staging export through TaskService without repeating the command', async () => {
  const { createTaskRunner } = await import('../../src/main/isolation/task-runner')
  const root = temp(); const database = db(); const service = new TaskService(database); let mounted = ''; let executed = 0
  service.setPlanner(async () => ({ tool: 'terminal', root, command: 'python3 make.py', question: '', steps: [{ id: 'create', title: 'make output', detail: 'make output', expected: '', checks: [{ kind: 'file-content', path: 'result.txt', value: 'finished' }] }] }))
  service.setIsolatedRunner(createTaskRunner(async (_command, args) => { if (args[0] === 'image' && args[1] === 'inspect') return '2'
      if (args[0] === 'inspect') return 'true'
      if (args[0] === 'ps') return ''; if (args[0] === 'run') { mounted = args[args.indexOf('--mount') + 1].match(/source=(.*),target=\/shared/)![1]; return 'service-stage-container' } if (args[0] === 'exec' && args.some((arg) => arg.includes('MURASAME_EXIT_'))) { executed += 1; writeFileSync(join(mounted, 'result.txt'), 'finished'); const marker = args.find((arg) => arg.includes('MURASAME_EXIT_'))!.match(/MURASAME_EXIT_[a-z0-9]+/)![0]; return `created\n${marker}=0\n` } return '' }))
  const created = await service.create(`创建任务 ${root}`); if (!created.ok) throw new Error(created.error)
  await service.approve(created.data.id, 'once'); await service.settled(created.data.id)
  const pending = service.list()[0]; expect(pending.status).toBe('等待批准'); expect(pending.approval?.impact).toContain('result.txt'); expect(existsSync(join(root, 'result.txt'))).toBe(false)
  await service.approve(created.data.id, 'once'); await service.settled(created.data.id)
  expect(service.list()[0].status).toBe('已完成'); expect(readFileSync(join(root, 'result.txt'), 'utf8')).toBe('finished'); expect(executed).toBe(1); database.close()
})
it('does not count HTTP transport success as a completed goal when every result condition fails', async () => {
  vi.stubGlobal('fetch', async () => new Response('unrelated text', { status: 200 }))
  const result = await executeGoal({ goal: 'find target', root: null, approved: true, cancelled: false, plan: { tool: 'browser', question: '', steps: [{ title: 'read', detail: 'read', expected: '', args: { url: 'https://example.com' }, checks: [{ kind: 'output-includes', value: 'missing target' }] }] } })
  expect(result.status).toBe('失败')
})
it('does not replay a verified output when its contents changed after the first approval', async () => {
  const database = db(); const root = temp(); const service = new TaskService(database); service.setPlanner(async () => writes(root))
  const made = await service.create(`创建任务 ${root}`); if (!made.ok) throw new Error(made.error)
  await service.approve(made.data.id, 'once'); await service.settled(made.data.id); writeFileSync(join(root, 'a.txt'), 'user revision')
  await service.approve(made.data.id, 'task'); await service.settled(made.data.id)
  expect(service.list()[0].status).toBe('失败'); expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('user revision'); expect(existsSync(join(root, 'b.txt'))).toBe(false); database.close()
})
it('never dispatches a tool excluded from the independent worker ticket', async () => {
  const root = temp()
  const result = await executeGoal({ goal: 'write', root, approved: true, cancelled: false, plan: { tool: 'filesystem', question: '', steps: [{ title: 'write', detail: 'write', expected: '', allowedTools: ['browser'], args: { action: 'write', path: 'forbidden.txt', content: 'no' } }] } })
  expect(result.status).toBe('失败'); expect(existsSync(join(root, 'forbidden.txt'))).toBe(false)
})
it('stores the selected model snapshot without credentials and does not let later profile edits alter it', async () => {
  const database = db(); const root = temp(); const service = new TaskService(database)
  const profile = { id: 'selected-model', model: 'original-version', name: 'model', endpoint: 'https://example.com', apiKey: 'DO-NOT-STORE' }
  service.setModelSnapshotProvider(() => profile); service.setPlanner(async () => writes(root))
  const created = await service.create(`创建任务 ${root}`); if (!created.ok) throw new Error(created.error)
  profile.model = 'changed-version'
  const task = service.list()[0]; expect(task.modelProfileId).toBe('selected-model'); expect(JSON.stringify(task.toolCalls)).toContain('original-version'); expect(JSON.stringify(task.toolCalls)).not.toContain('DO-NOT-STORE'); database.close()
})
it('preserves quoted command arguments and records the actual dispatched argv', async () => {
  const root = temp(); let seen: readonly string[] = []
  const result = await executeGoal({ goal: 'run quoted command', root, approved: true, cancelled: false, runner: async (request) => { seen = request.args; return { status: 'ok', raw: 'a b', exitCode: 0, outcomeKnown: true } }, plan: { tool: 'terminal', root, command: `python3 -c 'print("a b")'`, question: '', steps: [{ title: 'run', detail: 'run', expected: '', checks: [{ kind: 'output-includes', value: 'a b' }] }] } })
  expect(result.status).toBe('已完成'); expect(seen).toEqual(['-c', 'print("a b")'])
  expect(result.calls.find((call) => call.agentRole === 'Worker')?.args).toMatchObject({ operation: { executable: 'python3', argv: ['-c', 'print("a b")'] } })
})
it('learns only verified image procedure results and preserves skills for other authorized roots', async () => {
  const { learnVerifiedImageSkill } = await import('../../src/main/agent/learn-verified-image-skill')
  const { readSkills } = await import('../../src/main/agent/skills')
  const { solidPng } = await import('../../src/main/agent/teammates')
  const { createHash } = await import('node:crypto')
  const database = db(); const service = new TaskService(database); const skillDir = temp(); const firstRoot = temp(); const secondRoot = temp(); const png = solidPng(); const hash = createHash('sha256').update(png).digest('hex')
  service.setCopyImage(async (approval) => { writeFileSync(approval.hostPath!, png, { flag: 'wx' }); return { ok: true, path: approval.hostPath!, bytes: png.length, hash, sourceHash: hash, procedureId: 'isolated-example-image-v1' } })
  for (const root of [firstRoot, secondRoot]) { const target = join(root, 'picture.png'); const task = service.openTeammateTask({ title: '示例图片', status: '等待批准', summary: '', result: '', approval: { target, impact: 'copy', tool: 'copy-image', requestedAt: Date.now(), hostPath: target } }); expect(learnVerifiedImageSkill(skillDir, task)).toBeNull(); await service.approve(task.id); await service.settled(task.id); const done = service.list().find((item) => item.id === task.id)!; expect(learnVerifiedImageSkill(skillDir, done)?.procedure).toBe('isolated-example-image-v1'); learnVerifiedImageSkill(skillDir, done) }
  const active = readSkills(skillDir).filter((skill) => !skill.superseded); expect(active).toHaveLength(2); expect(active.map((skill) => skill.root).sort()).toEqual([firstRoot, secondRoot].sort())
  const target = join(firstRoot, 'picture.png'); const failed = service.openTeammateTask({ title: '示例图片失败', status: '等待批准', summary: '', result: '', approval: { target, impact: 'copy', tool: 'copy-image', requestedAt: Date.now(), hostPath: target } }); await service.approve(failed.id); await service.settled(failed.id)
  const failedTask = service.list().find((task) => task.id === failed.id)!; expect(failedTask.status).toBe('失败'); learnVerifiedImageSkill(skillDir, failedTask); learnVerifiedImageSkill(skillDir, failedTask)
  const versions = readSkills(skillDir); expect(versions.find((skill) => skill.root === firstRoot)?.failures).toHaveLength(1); expect(versions.find((skill) => skill.root === secondRoot)?.failures ?? []).toHaveLength(0)
  database.close()
})
it('executes only the approved organize manifest and leaves later additions untouched', async () => {
  const database = db(); const root = temp(); writeFileSync(join(root, 'approved.txt'), 'approved'); const service = new TaskService(database)
  const made = await service.create(`按类型整理 ${root}`); if (!made.ok) throw new Error(made.error)
  expect(made.data.approval?.impact).toContain('approved.txt'); expect(made.data.approval?.impact).toContain('文档/approved.txt')
  writeFileSync(join(root, 'later.txt'), 'later')
  await service.approve(made.data.id, 'once'); await service.settled(made.data.id)
  expect(readFileSync(join(root, '文档/approved.txt'), 'utf8')).toBe('approved'); expect(readFileSync(join(root, 'later.txt'), 'utf8')).toBe('later'); expect(existsSync(join(root, '文档/later.txt'))).toBe(false); database.close()
})
