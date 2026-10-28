import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { SqliteDatabase } from '../../src/main/data/sqlite-types'
import { organizeByKind, readInside, writeInside } from '../../src/main/tools/filesystem'
import { executeGoal } from '../../src/main/agent/executor'
import { runTerminal } from '../../src/main/tools/terminal'
import { readVisiblePage } from '../../src/main/tools/browser'
import { summarizeCalls } from '../../src/main/agent/verifier'
vi.mock('electron', () => ({ Notification: { isSupported: () => false } }))
vi.mock('../../src/main/settings', () => ({ getSettings: () => ({ taskNotifications: false }) }))
import { TaskService } from '../../src/main/core/services/task-service'
const roots: string[] = []
function temp(): string { const dir = mkdtempSync(join(tmpdir(), 'murasame-task-regression-')); roots.push(dir); return dir }
afterEach(() => roots.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })))
function database(): SqliteDatabase {
  const db = new DatabaseSync(':memory:')
  db.exec(readFileSync('src/main/data/migrations/001_init.sql', 'utf8'))
  db.exec(readFileSync('src/main/data/migrations/003_trace.sql', 'utf8'))
  return db as unknown as SqliteDatabase
}
describe('task reliability: preserve actual filesystem effects', () => {
  it('preserves an existing destination and reports the successfully moved prefix', async () => {
    const root = temp(); mkdirSync(join(root, '文档')); writeFileSync(join(root, 'a.txt'), 'a'); writeFileSync(join(root, 'b.txt'), 'new'); writeFileSync(join(root, '文档/b.txt'), 'OLD')
    const outcome = await executeGoal({ goal: `按类型整理 ${root}`, root, approved: true, cancelled: false })
    expect(readFileSync(join(root, '文档/b.txt'), 'utf8')).toBe('OLD')
    expect(readFileSync(join(root, 'b.txt'), 'utf8')).toBe('new')
    expect(outcome.status).toBe('部分完成'); expect(outcome.artifacts).toContain(join(root, '文档/a.txt'))
  })
  it('refuses existing files on direct write', () => {
    const root = temp(); writeFileSync(join(root, 'keep.txt'), 'old')
    expect(() => writeInside(root, 'keep.txt', 'new')).toThrow(); expect(readFileSync(join(root, 'keep.txt'), 'utf8')).toBe('old')
  })
  it('rejects real junction escapes for reads, writes and organization', async () => {
    const root = temp(); const outside = temp(); mkdirSync(join(outside, '文档')); writeFileSync(join(outside, 'secret.txt'), 'secret')
    symlinkSync(outside, join(root, 'escape'), 'junction'); symlinkSync(join(outside, '文档'), join(root, '文档'), 'junction'); writeFileSync(join(root, 'a.txt'), 'a')
    expect(() => readInside(root, 'escape/secret.txt')).toThrow(/授权目录外/)
    expect(() => writeInside(root, 'escape/new.txt', 'new')).toThrow(/授权目录外/)
    const result = await organizeByKind(root); expect(result.moved).toHaveLength(0); expect(existsSync(join(outside, '文档/a.txt'))).toBe(false)
  })
  it('independently verifies every moved output, including a missing second output', async () => {
    const root = temp(); writeFileSync(join(root, 'a.txt'), 'a'); writeFileSync(join(root, 'b.txt'), 'b')
    const result = await executeGoal({ goal: `按类型整理 ${root}`, root, approved: true, cancelled: false, control: { stopped: () => false, progress: (n) => { if (n === 2) rmSync(join(root, '文档/b.txt')) } } })
    expect(result.status).toBe('部分完成'); expect(result.calls.filter((c) => c.agentRole === 'Critic').flatMap((c) => c.evidence).some((e) => e.target.endsWith('b.txt') && !e.matched)).toBe(true)
  })
  it('does not treat planning or zero output as partial success', () => {
    expect(summarizeCalls([])).toBe('失败')
  })
})
describe('task reliability: async isolation and cancellation', () => {
  it('never executes a host command without an injected isolated runner', async () => {
    const root = temp(); const file = join(root, 'host.txt')
    const result = await runTerminal(root, process.execPath, ['-e', `require('node:fs').writeFileSync(${JSON.stringify(file)},'HOST')`])
    expect(existsSync(file)).toBe(false); expect(result.status).toBe('error')
  })
  it('propagates browser abort and settles a hanging request', async () => {
    const controller = new AbortController(); let received: AbortSignal | undefined
    const fetcher = (async (_url, options) => { received = options?.signal as AbortSignal; return await new Promise<Response>((_resolve, reject) => received?.addEventListener('abort', () => reject(new Error('aborted')))) }) as typeof fetch
    const result = readVisiblePage('https://example.com', fetcher, { signal: controller.signal }); controller.abort()
    expect((await result).status).toBe('aborted'); expect(received?.aborted).toBe(true)
  })
})
describe('task reliability: persisted service transitions', () => {
  it('broadcasts creation and denial and removes stale approval', async () => {
    const db = database(); const service = new TaskService(db); const root = temp(); writeFileSync(join(root, 'a.txt'), 'a')
    const events: string[] = []; service.onChange((task) => events.push(task.status))
    const created = await service.create(`按类型整理 ${root}`); if (!created.ok) throw new Error(created.error)
    expect(events).toContain('等待批准'); const denied = await service.deny(created.data.id); if (!denied.ok) throw new Error(denied.error)
    expect(denied.data.approval).toBeNull(); expect(events.at(-1)).toBe('待确认'); db.close()
  })
  it('blocks copy-image when filesystem is disabled', async () => {
    const db = database(); const service = new TaskService(db); let copied = false
    service.setToolGate(() => '文件工具停用'); service.setCopyImage(async () => { copied = true; return { ok: true, path: 'x', bytes: 1 } })
    const task = service.openTeammateTask({ title: 'copy', status: '等待批准', summary: '', result: '', approval: { tool: 'copy-image', target: 'x', impact: 'copy', requestedAt: Date.now(), hostPath: 'x' } })
    await service.approve(task.id); expect(copied).toBe(false); db.close()
  })
})
import { findSkill, rememberSkill, skillFits, noteSkillFailure, readSkills, type LocalSkill } from '../../src/main/agent/skills'
describe('task reliability: controlled plan steps and skills', () => {
  it('runs each executable step independently and verifies literal output conditions', async () => {
    const root = temp()
    const result = await executeGoal({ goal: `创建结果 ${root}`, root, approved: true, cancelled: false, plan: { tool: 'filesystem', question: '', steps: [
      { title: 'list', detail: 'list directory', expected: '', args: { action: 'list' } },
      { title: 'write', detail: 'write result', expected: 'done', args: { action: 'write', path: 'required.txt', content: 'done' }, checks: [{ kind: 'file-content', path: 'required.txt', value: 'done' }] }
    ] } })
    expect(result.status).toBe('已完成'); expect(readFileSync(join(root, 'required.txt'), 'utf8')).toBe('done')
    const tickets = result.calls.filter((c) => c.agentRole === 'Worker').map((c) => (c.args as { ticket: { id: string } }).ticket.id)
    expect(tickets).toHaveLength(2); expect(new Set(tickets).size).toBe(2)
  })
  it('requires a real expected output even when an isolated command exits zero', async () => {
    const root = temp()
    const result = await executeGoal({ goal: 'write required output', root, approved: true, cancelled: false, runner: async () => ({ status: 'ok', raw: 'v22', exitCode: 0 }), plan: { tool: 'terminal', command: 'node --version', question: '', steps: [{ title: 'run', detail: 'run', expected: 'required.txt contains done', checks: [{ kind: 'file-content', path: 'required.txt', value: 'done' }] }] } })
    expect(result.status).toBe('失败'); expect(existsSync(join(root, 'required.txt'))).toBe(false)
  })
  it('refuses skills without verified successful evidence and respects workspace', () => {
    const dir = temp(); const skill: LocalSkill = { id: 'candidate', kind: 'draw-image', steps: 'draw', check: 'file exists', allowedTools: ['files'], workspace: 'pictures', createdAt: 'now', superseded: false, lastFailure: '' }
    expect(() => rememberSkill(dir, skill)).toThrow(/核验/)
    rememberSkill(dir, skill, { taskId: 'successful-task', status: '已完成', evidence: [{ kind: 'fs-hash', target: 'picture.png', expected: 'hash', actual: 'hash', matched: true }] })
    expect(skillFits(findSkill(dir, 'draw-image')!, ['files'], { workspace: 'isolation' })).toBe(false)
    noteSkillFailure(dir, 'draw-image', 'later failure'); expect(readSkills(dir)[0].lastFailure).toBe('later failure')
  })
  it('continues a clarification on the same persisted task without executing before approval', async () => {
    const db = database(); const service = new TaskService(db)
    const created = await service.create('按类型整理文件'); if (!created.ok) throw new Error(created.error)
    const root = temp(); writeFileSync(join(root, 'a.txt'), 'a')
    const continued = await service.continueTask(created.data.id, root); if (!continued.ok) throw new Error(continued.error)
    expect(continued.data.id).toBe(created.data.id); expect(continued.data.status).toBe('等待批准'); expect(existsSync(join(root, 'a.txt'))).toBe(true)
    db.close()
  })
  it('preserves copy completion facts when cancellation races the handler', async () => {
    const db = database(); const service = new TaskService(db); const root = temp(); const destination = join(root, 'picture.png')
    let finish!: () => void
    service.setCopyImage(async () => { await new Promise<void>((resolve) => { finish = resolve }); writeFileSync(destination, 'PNG'); return { ok: true, path: destination, bytes: 3 } })
    const task = service.openTeammateTask({ title: 'copy', status: '等待批准', summary: '', result: '', approval: { tool: 'copy-image', target: destination, impact: 'copy', requestedAt: Date.now(), hostPath: destination } })
    await service.approve(task.id); await service.cancel(task.id); finish(); await service.settled(task.id)
    const result = service.list().find((item) => item.id === task.id)!
    expect(result.status).toBe('已取消'); expect(result.artifacts).toContain(destination); expect(result.toolCalls.length).toBeGreaterThan(0); db.close()
  })
})
describe('task reliability: permissions stay current between files', () => {
  it('stops after tool revocation and keeps confirmed progress as partial, not user cancellation', async () => {
    const root = temp(); writeFileSync(join(root, 'a.txt'), 'a'); writeFileSync(join(root, 'b.txt'), 'b'); let disabled = false
    const result = await executeGoal({ goal: `整理 ${root}`, root, approved: true, cancelled: false, toolGate: () => disabled ? 'disabled' : null, control: { stopped: () => false, progress: () => { disabled = true } } })
    expect(result.status).toBe('部分完成'); expect(existsSync(join(root, 'b.txt'))).toBe(true); expect(result.artifacts).toContain(join(root, '文档/a.txt'))
  })
})
describe('task reliability: observer failures cannot erase effects', () => {
  it('keeps the completed file when a progress listener throws', async () => {
    const root = temp(); writeFileSync(join(root, 'a.txt'), 'a'); writeFileSync(join(root, 'b.txt'), 'b')
    const result = await executeGoal({ goal: `整理 ${root}`, root, approved: true, cancelled: false, control: { stopped: () => false, progress: () => { throw new Error('observer failed') } } })
    expect(result.status).toBe('部分完成'); expect(result.artifacts).toContain(join(root, '文档/a.txt')); expect(existsSync(join(root, 'b.txt'))).toBe(true)
  })
})
describe('task isolated runtime adapter', () => {
  it('mounts only the approved root, preserves nonzero exit code and removes its own container', async () => {
    const { createTaskRunner } = await import('../../src/main/isolation/task-runner')
    const root = temp(); const commands: string[][] = []
    const run = async (_command: string, args: string[]): Promise<string> => {
      commands.push(args)
      if (args[0] === 'image' && args[1] === 'inspect') return '2'
      if (args[0] === 'inspect') return 'true'
      if (args[0] === 'ps') return ''
      if (args[0] === 'run') return 'owned-container'
      if (args[0] === 'exec' && args.some((arg) => arg.includes('MURASAME_EXIT_'))) { const marker = args.find((arg) => arg.includes('MURASAME_EXIT_'))!.match(/MURASAME_EXIT_[a-z0-9]+/)![0]; return `actual process output\n${marker}=7\n` }
      return ''
    }
    const outcome = await createTaskRunner(run)({ root, executable: 'git', args: ['status'], timeoutMs: 1000, readOnly: true, ticketId: 'ticket' })
    expect(outcome.status).toBe('error'); expect(outcome.exitCode).toBe(7); expect(outcome.raw).toBe('actual process output')
    const start = commands.find((args) => args[0] === 'run')!; expect(start).toContain(`type=bind,readonly,source=${root},target=/shared`); expect(start).toContain('none')
    expect(commands.at(-1)).toEqual(['rm', '-f', 'owned-container'])
  })
  it('waits for cleanup before settling cancellation and never starts the command', async () => {
    const { createTaskRunner } = await import('../../src/main/isolation/task-runner')
    const root = temp(); const controller = new AbortController(); let removed = false; let commands = 0
    const run = async (_command: string, args: string[]): Promise<string> => {
      if (args[0] === 'image' && args[1] === 'inspect') return '2'
      if (args[0] === 'inspect') return 'true'
      if (args[0] === 'ps') return ''
      if (args[0] === 'run') { controller.abort(); return 'cancelled-container' }
      if (args[0] === 'exec') { commands += 1; return '' }
      if (args[0] === 'rm') removed = true
      return ''
    }
    const outcome = await createTaskRunner(run)({ root, executable: 'touch', args: ['a.txt'], timeoutMs: 1000, signal: controller.signal })
    expect(outcome.status).toBe('aborted'); expect(removed).toBe(true); expect(commands).toBe(0)
  })
})
describe('isolated image export', () => {
  it('protects an existing approved target before creating any isolated image', async () => {
    const { executeImageCopy } = await import('../../src/main/isolation/image-workflow')
    const root = temp(); const path = join(root, 'keep.png'); writeFileSync(path, 'OLD')
    const result = await executeImageCopy({ hostPath: path, assertAllowed: () => undefined }, async () => { throw new Error('should never start') })
    expect(result.ok).toBe(false); expect(readFileSync(path, 'utf8')).toBe('OLD')
  })
  it('generates and independently checks a source before exporting with exclusive create', async () => {
    const { executeImageCopy } = await import('../../src/main/isolation/image-workflow')
    const { createHash } = await import('node:crypto')
    const root = temp(); const path = join(root, 'sample.png'); let image = Buffer.alloc(0); const operations: string[][] = []; let gates = 0
    const run = async (_command: string, args: string[]): Promise<string> => {
      operations.push(args)
      if (args[0] === 'image' && args[1] === 'inspect') return '2'
      if (args[0] === 'inspect') return 'true'
      if (args[0] === 'ps') return ''
      if (args[0] === 'run') return 'image-owned-container'
      if (args[0] === 'exec' && args.some((arg) => arg.includes('bytes.fromhex'))) { image = Buffer.from(args.at(-1)!, 'hex'); return '' }
      if (args[0] === 'exec' && args.some((arg) => arg.includes('b64encode'))) return JSON.stringify({ bytes: image.length, hash: createHash('sha256').update(image).digest('hex'), base64: image.toString('base64') })
      return ''
    }
    const result = await executeImageCopy({ hostPath: path, assertAllowed: () => { gates += 1 } }, run)
    expect(result.ok).toBe(true); expect(readFileSync(path)).toEqual(image); expect(gates).toBeGreaterThanOrEqual(4)
    if (result.ok) { expect(result.hash).toMatch(/^[a-f0-9]{64}$/); expect(result.sourceHash).toBe(result.hash); expect(result.note).toContain('示例') }
    expect(operations.at(-1)).toEqual(['rm', '-f', 'image-owned-container']); expect(operations.find((args) => args[0] === 'run')).not.toContain('--mount')
  })
})
