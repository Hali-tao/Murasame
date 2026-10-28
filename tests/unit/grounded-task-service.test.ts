import { afterEach, describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { TaskService, type TaskModelBinding } from '../../src/main/core/services/task-service'
import type { TaskPlan } from '../../src/main/agent/executor'
import type { SummaryGenerator, SummaryModelControl } from '../../src/main/agent/grounded-summary'
import type { GroundedCheckpoint, GroundedDraft } from '../../src/shared/grounded-summary'
import type { SqliteDatabase } from '../../src/main/data/sqlite-types'
import { createServer } from 'node:http'
import { ModelGateway, waitingRequests } from '../../src/main/model/gateway'
import type { ResolvedModel } from '../../src/main/model/types'
import { groundedDraftSchema } from '../../src/main/agent/grounded-summary'

vi.mock('electron', () => ({ Notification: { isSupported: () => false } }))
vi.mock('../../src/main/settings', () => ({ getSettings: () => ({ taskNotifications: false }) }))
const dbs: DatabaseSync[] = []; const dirs: string[] = []
afterEach(() => { vi.useRealTimers(); dbs.splice(0).forEach(db => db.close()); dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })) })
function fixture(generator?: SummaryGenerator) {
  const db = new DatabaseSync(':memory:'); dbs.push(db)
  for (const file of ['001_init.sql', '002_memory.sql', '003_trace.sql']) db.exec(readFileSync(`src/main/data/migrations/${file}`, 'utf8'))
  const root = mkdtempSync(join(tmpdir(), 'grounded-task-')); dirs.push(root)
  const secret = `source-body-only-${randomUUID()}`
  writeFileSync(join(root, 'source.md'), `已确认预算十万元。\n${secret}\n上线日期未确定。`)
  const binding: TaskModelBinding = { id: 'approved-model', name: '测试模型', provider: 'OpenAI Compatible', endpoint: 'http://127.0.0.1:12345/v1', model: 'fixture', apiKey: 'private-key-not-for-logs' }
  const plan: TaskPlan = { tool: 'filesystem', root, steps: [], question: '', workflow: { kind: 'summarize-files', sources: ['source.md'], instruction: '总结预算与日期', outputPath: 'summary.md' } }
  const seen: string[] = []
  const generate: SummaryGenerator = generator ?? (async (input, _model, control) => { control.beforeSend(); control.onDispatch(0); seen.push(input.sources[0].text); return draft() })
  function service() {
    const service = new TaskService(db as unknown as SqliteDatabase)
    service.setModelSnapshotProvider(() => binding, id => id === binding.id ? binding : null)
    service.setPlanner(async () => structuredClone(plan)); service.setSummaryGenerator(generate)
    return service
  }
  const tasks = service()
  return { db, root, secret, binding, plan, tasks, seen, restart: service, target: join(root, 'summary.md') }
}
function draft(): GroundedDraft { return { title: '项目摘要', sections: [{ text: '当前确认预算为十万元。', citations: [{ sourceId: 'source-1', fromLine: 1, toLine: 1, quote: '已确认预算十万元。' }] }], limitations: ['上线日期尚未确定。'] } }
async function create(f: ReturnType<typeof fixture>) {
  const result = await f.tasks.create(`请总结 ${f.root} 内 source.md，写入 summary.md`)
  if (!result.ok) throw new Error(result.error)
  expect(result.data.status).toBe('等待批准')
  expect(JSON.parse(result.data.approval!.impact).stage).toBe('awaiting-source-approval')
  return result.data.id
}
async function approve(tasks: TaskService, id: string) { const result = await tasks.approve(id, 'task'); expect(result.ok).toBe(true); await tasks.settled(id); return tasks.list().find(task => task.id === id)! }
function checkpoint(f: ReturnType<typeof fixture>, id: string): GroundedCheckpoint {
  return JSON.parse((f.db.prepare('SELECT checkpoint_json FROM task_grounded_checkpoints WHERE task_id = ?').get(id) as { checkpoint_json: string }).checkpoint_json)
}

describe('[FR-17] 两次批准的真实文件摘要', () => {
  it('用户明确用引号指定含空格的目录时，完整授权范围不会被截断', async () => {
    const f = fixture(); const root = join(f.root, 'my notes'); mkdirSync(root); writeFileSync(join(root, 'source.md'), '已确认预算十万元。')
    f.plan.root = root
    const result = await f.tasks.create(`请总结 "${root}" 内 source.md，保存为 summary.md`)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.status).toBe('等待批准'); expect(result.data.scope).toBe(root)
    await approve(f.tasks, result.data.id); expect((await approve(f.tasks, result.data.id)).status).toBe('已完成')
    expect(readFileSync(join(root, 'summary.md'), 'utf8')).toContain('已确认预算十万元。')
  })
  it('A 前无正文外发，A 后只生成待审草稿，B 后精确新建并独立核验', async () => {
    const f = fixture(); const id = await create(f)
    expect(f.seen).toEqual([]); expect(existsSync(f.target)).toBe(false)
    const reviewed = await approve(f.tasks, id)
    expect(f.seen[0]).toContain(f.secret)
    expect(reviewed.status).toBe('等待批准'); expect(existsSync(f.target)).toBe(false)
    const approval = JSON.parse(reviewed.approval!.impact)
    expect(approval.stage).toBe('awaiting-write-approval')
    expect(approval.draft.markdown).toContain('已确认预算十万元。')
    const completed = await approve(f.tasks, id)
    expect(completed.status).toBe('已完成')
    expect(readFileSync(f.target, 'utf8')).toBe(approval.draft.markdown)
    expect(createHash('sha256').update(readFileSync(f.target)).digest('hex')).toBe(approval.draftHash)
    expect(completed.artifacts).toContain(f.target)
    expect(f.seen).toHaveLength(1)
    const calls = JSON.stringify(f.db.prepare('SELECT * FROM tool_calls').all())
    expect(calls).not.toContain(f.secret); expect(calls).not.toContain(f.binding.apiKey)
    expect(JSON.stringify(checkpoint(f, id))).not.toContain(f.secret)
  })
  it('错误引用不能进入保存审批，更不能输出文件', async () => {
    const f = fixture(async (_input, _model, control) => { control.beforeSend(); control.onDispatch(0); const value = draft(); value.sections[0].citations[0].quote = '预算百万元'; return value })
    const id = await create(f); const result = await approve(f.tasks, id)
    expect(result.status).toBe('失败'); expect(result.result).toMatch(/引用/); expect(existsSync(f.target)).toBe(false)
  })
  it('模型报错即使回显来源也不会进入持久调用日志', async () => {
    const f = fixture(async (input, _model, control) => { control.beforeSend(); control.onDispatch(0); throw new Error(`来源：${input.sources[0].text}`) })
    const id = await create(f); const result = await approve(f.tasks, id)
    expect(result.status).toBe('失败')
    expect(result.result).not.toContain(f.secret)
    expect(JSON.stringify(f.db.prepare('SELECT * FROM tool_calls').all())).not.toContain(f.secret)
  })
  it.each(['before-A', 'before-B'])('来源在 %s 变化必须重新批准，禁止替换正文或保存旧草稿', async when => {
    const f = fixture(); const id = await create(f)
    if (when === 'before-B') await approve(f.tasks, id)
    writeFileSync(join(f.root, 'source.md'), '全新的未经批准内容')
    const result = await approve(f.tasks, id)
    expect(result.status).toBe('等待批准')
    expect(JSON.parse(result.approval!.impact).stage).toBe('awaiting-source-approval')
    expect(f.seen).toHaveLength(when === 'before-A' ? 0 : 1)
    expect(existsSync(f.target)).toBe(false)
  })
  it('目标并发出现保留他人文件，不覆盖', async () => {
    const f = fixture(); const id = await create(f); await approve(f.tasks, id)
    writeFileSync(f.target, '并发文件')
    const result = await approve(f.tasks, id)
    expect(result.status).toBe('失败'); expect(readFileSync(f.target, 'utf8')).toBe('并发文件')
  })
  it('A 的批准记录不能重用为 B，即使选择任务范围', async () => {
    const f = fixture(); const id = await create(f)
    const stageA = (f.db.prepare('SELECT approval_json FROM tasks WHERE id = ?').get(id) as { approval_json: string }).approval_json
    await approve(f.tasks, id)
    f.db.prepare('UPDATE tasks SET approval_json = ? WHERE id = ?').run(stageA, id)
    const result = await approve(f.tasks, id)
    expect(result.status).toBe('失败'); expect(existsSync(f.target)).toBe(false)
  })
  it('B 草稿被修改后不能沿用原批准保存', async () => {
    const f = fixture(); const id = await create(f); await approve(f.tasks, id)
    const cp = checkpoint(f, id); cp.draft!.markdown += '\n未审阅内容'
    f.db.prepare('UPDATE task_grounded_checkpoints SET checkpoint_json = ? WHERE task_id = ?').run(JSON.stringify(cp), id)
    expect((await approve(f.tasks, id)).status).toBe('失败'); expect(existsSync(f.target)).toBe(false)
  })
  it('写入后的取消保留真实产物及独立核验，不伪称未产生影响', async () => {
    const f = fixture(); const id = await create(f); const reviewed = await approve(f.tasks, id)
    let cancelled = false
    f.tasks.onChange(task => {
      if (!cancelled && task.toolCalls.some(call => call.agentRole === 'Worker' && call.stepId === `${id}-summary-save` && call.execution.status === 'ok')) { cancelled = true; void f.tasks.cancel(id) }
    })
    const result = await approve(f.tasks, id)
    expect(cancelled).toBe(true); expect(result.status).toBe('已取消'); expect(result.artifacts).toContain(f.target)
    expect(readFileSync(f.target, 'utf8')).toBe(JSON.parse(reviewed.approval!.impact).draft.markdown)
    expect(checkpoint(f, id).stage).toBe('verified')
  })
  it.each(['deny', 'expire', 'restart'])('B %s 后恢复准确原草稿，且不重调模型', async mode => {
    const f = fixture(); const id = await create(f); const stageB = await approve(f.tasks, id)
    const markdown = JSON.parse(stageB.approval!.impact).draft.markdown
    let tasks = f.tasks
    if (mode === 'deny') await tasks.deny(id)
    if (mode === 'expire') {
      const row = f.db.prepare('SELECT approval_json FROM tasks WHERE id = ?').get(id) as { approval_json: string }
      const approval = JSON.parse(row.approval_json); approval.requestedAt = Date.now() - 601000
      f.db.prepare('UPDATE tasks SET approval_json = ? WHERE id = ?').run(JSON.stringify(approval), id)
      await tasks.approve(id)
    }
    if (mode === 'restart') tasks = f.restart()
    const continued = await tasks.continueTask(id, '继续'); expect(continued.ok).toBe(true)
    if (continued.ok) expect(JSON.parse(continued.data.approval!.impact).draft.markdown).toBe(markdown)
    expect((await approve(tasks, id)).status).toBe('已完成'); expect(f.seen).toHaveLength(1)
  })
  it('已开始生成的任务取消后立即结束等待，迟到回复不能创建审批或文件', async () => {
    let reply!: (value: GroundedDraft) => void; let started!: () => void
    const ready = new Promise<void>(resolve => { started = resolve })
    const f = fixture(async (_input, _model, control) => { control.beforeSend(); control.onDispatch(0); started(); return new Promise(resolve => { reply = resolve }) })
    const id = await create(f); await f.tasks.approve(id); await ready; await f.tasks.cancel(id)
    await f.tasks.settled(id)
    reply(draft()); await new Promise(resolve => setImmediate(resolve))
    expect(f.tasks.list()[0].status).toBe('已取消'); expect(f.tasks.list()[0].approval).toBeNull(); expect(existsSync(f.target)).toBe(false)
    expect((await f.tasks.continueTask(id, '继续')).ok).toBe(true)
    expect(JSON.parse(f.tasks.list()[0].approval!.impact).stage).toBe('awaiting-source-approval')
  })
  it('排队期间来源变化阻止实际派发', async () => {
    let dispatch!: () => void; let queued!: () => void
    const ready = new Promise<void>(resolve => { queued = resolve })
    let sent = 0
    const f = fixture(async (_input, _model, control) => new Promise((resolve, reject) => { dispatch = () => { try { control.beforeSend(); control.onDispatch(0); sent++; resolve(draft()) } catch (error) { reject(error) } }; queued() }))
    const id = await create(f); await f.tasks.approve(id); await ready
    writeFileSync(join(f.root, 'source.md'), '排队后变化'); dispatch(); await f.tasks.settled(id)
    expect(sent).toBe(0); expect(existsSync(f.target)).toBe(false)
  })
  it('真实模型工作队列中取消立即结束任务，解除阻塞后也不发送正文', async () => {
    let release!: () => void; let firstArrived!: () => void; let requests = 0
    const arrived = new Promise<void>(resolve => { firstArrived = resolve })
    const server = createServer((request, response) => {
      request.resume(); request.on('end', () => {
        requests++
        release = () => { if (response.writableEnded) return; response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'fixture release' } }] })) }
        firstArrived()
      })
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('fixture address')
    const gateway = new ModelGateway()
    const f = fixture((input, model, control) => gateway.callStructured(model as ResolvedModel, groundedDraftSchema, 'grounded_summary', 'fixture', [{ role: 'user', content: JSON.stringify(input) }], undefined, control))
    f.binding.endpoint = `http://127.0.0.1:${address.port}/v1`
    const blocking = gateway.chatWithImages(f.binding as ResolvedModel, '占用工作队列', [])
    try {
      await arrived
      const id = await create(f); await f.tasks.approve(id)
      await vi.waitFor(() => expect(waitingRequests()).toBe(1))
      await f.tasks.cancel(id); await f.tasks.settled(id)
      expect(f.tasks.list()[0].status).toBe('已取消'); expect(requests).toBe(1)
      release(); await blocking
      await vi.waitFor(() => expect(waitingRequests()).toBe(0))
      expect(requests).toBe(1); expect(checkpoint(f, id).dispatchCount).toBe(0); expect(existsSync(f.target)).toBe(false)
    } finally { release?.(); await blocking.catch(() => undefined); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
  })
  it('最多三次实际派发，第四次在发送前阻断', async () => {
    let sent = 0
    const f = fixture(async (_input, _model, control) => { for (let i = 0; i < 4; i++) { control.beforeSend(); control.onDispatch(0); sent++ } return draft() })
    const id = await create(f); const result = await approve(f.tasks, id)
    expect(sent).toBe(3); expect(result.status).toBe('失败'); expect(checkpoint(f, id).dispatchCount).toBe(3); expect(existsSync(f.target)).toBe(false)
  })
  it('120 秒总预算覆盖排队，超时后的出队不能发送', async () => {
    let queued!: () => void; let controller!: SummaryModelControl
    const ready = new Promise<void>(resolve => { queued = resolve })
    const f = fixture(async (_input, _model, control) => { controller = control; queued(); return new Promise(() => {}) })
    const id = await create(f); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    await f.tasks.approve(id); await ready; await vi.advanceTimersByTimeAsync(120001); await f.tasks.settled(id)
    expect(f.tasks.list()[0].status).toBe('失败'); expect(() => controller.beforeSend()).toThrow(); expect(existsSync(f.target)).toBe(false)
  })
  it('原模型配置在排队中更改，发送前受阻，不换服务商', async () => {
    let dispatch!: () => void; let queued!: () => void; let sent = 0
    const ready = new Promise<void>(resolve => { queued = resolve })
    const f = fixture(async (_input, _model, control) => new Promise((resolve, reject) => { dispatch = () => { try { control.beforeSend(); control.onDispatch(0); sent++; resolve(draft()) } catch (error) { reject(error) } }; queued() }))
    const id = await create(f); await f.tasks.approve(id); await ready; f.binding.endpoint = 'https://other.example/v1'; dispatch(); await f.tasks.settled(id)
    expect(sent).toBe(0); expect(f.tasks.list()[0].status).toBe('失败')
  })
  it.each(['match', 'absent', 'conflict'])('writing 崩溃恢复核对磁盘事实 %s，绝不自动重写', async mode => {
    const f = fixture(); const id = await create(f); await approve(f.tasks, id)
    const cp = checkpoint(f, id); cp.stage = 'writing'; cp.outcomeKnown = false
    f.db.prepare('UPDATE task_grounded_checkpoints SET checkpoint_json = ? WHERE task_id = ?').run(JSON.stringify(cp), id)
    f.db.prepare("UPDATE tasks SET status = '执行中' WHERE id = ?").run(id)
    if (mode !== 'absent') writeFileSync(f.target, mode === 'match' ? cp.draft!.markdown : '不相符的文件')
    const tasks = f.restart(); const result = await tasks.continueTask(id, '继续'); expect(result.ok).toBe(true)
    expect(tasks.list()[0].status).toBe(mode === 'match' ? '已完成' : mode === 'absent' ? '等待批准' : '失败')
    if (mode === 'absent') expect(existsSync(f.target)).toBe(false)
    if (mode === 'conflict') expect(readFileSync(f.target, 'utf8')).toBe('不相符的文件')
    expect(f.seen).toHaveLength(1)
  })
  it('未知摘要写入不能通过补充要求改成普通计划而绕过原目标核对', async () => {
    const f = fixture(); const id = await create(f); await approve(f.tasks, id)
    const cp = checkpoint(f, id); cp.stage = 'writing'; cp.outcomeKnown = false
    f.db.prepare('UPDATE task_grounded_checkpoints SET checkpoint_json = ? WHERE task_id = ?').run(JSON.stringify(cp), id)
    f.db.prepare("UPDATE tasks SET status = '执行中' WHERE id = ?").run(id)
    writeFileSync(f.target, '上次可能只写了一部分')
    delete f.plan.workflow
    f.plan.steps = [{ id: 'write-other', title: '新建另一个文件', detail: '', expected: '', args: { action: 'write', path: 'different.md', content: '新的结果' }, checks: [{ kind: 'file-content', path: 'different.md', value: '新的结果' }] }]
    const tasks = f.restart()
    const changed = await tasks.continueTask(id, '改成新建 different.md')
    expect(changed.ok).toBe(false)
    if (!changed.ok) expect(changed.error).toMatch(/核对/)
    expect(tasks.list()[0].approval).toBeNull()
    expect(existsSync(join(f.root, 'different.md'))).toBe(false)
    const stored = f.db.prepare('SELECT plan_json FROM task_execution_plans WHERE task_id = ?').get(id) as { plan_json: string }
    expect(JSON.parse(stored.plan_json).workflow.kind).toBe('summarize-files')
    expect(checkpoint(f, id).outcomeKnown).toBe(false)
    const resumed = await tasks.continueTask(id, '继续'); expect(resumed.ok).toBe(true)
    expect(tasks.list()[0].status).toBe('失败')
    expect(readFileSync(f.target, 'utf8')).toBe('上次可能只写了一部分')
  })
})
