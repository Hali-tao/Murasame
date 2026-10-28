import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { organizeManifest, resolveInside } from '../../tools/filesystem'
import type { IsolatedRunner } from '../../tools/terminal'
import { Notification } from 'electron'
import type { SqliteDatabase } from '../../data/sqlite-types'
import { approvalExpired, type ApprovalScope } from '../../agent/approval-gate'
import { isAbsolute } from 'node:path'
import { executeGoal, extractRoot, chooseTool, localRulePlan, type GoalOutcome, type TaskPlan, type StepCheckpoint } from '../../agent/executor'
import { recognizeIntent } from '../../agent/planner'
import { summarizeCalls } from '../../agent/verifier'
import { interruptOnRestart, transition, type TaskPhase } from '../../agent/state-machine'
import type { Evidence, ToolCallRecord, Verdict } from '../../../shared/evidence'
import type { ApprovalRequest, Result, Task, TaskStep, Tone } from '../../../shared/types'
import { getSettings } from '../../settings'
import type { SummaryGenerator } from '../../agent/grounded-summary'
import type { GroundedCheckpoint } from '../../../shared/grounded-summary'
import type { GroundedExecutionOptions } from '../../agent/grounded-executor'
import { normalizeTaskRoot, taskRootsEqual } from '../../agent/task-root'


function notifyTask(task: Task): void {
  if (!getSettings().taskNotifications) return
  if (!['已完成', '失败', '部分完成', '已取消'].includes(task.status)) return
  if (!Notification.isSupported()) return
  new Notification({ title: `任务${task.status}`, body: (task.result || task.title).slice(0, 180) }).show()
}
const ok = <T>(data: T): Result<T> => ({ ok: true, data })
const fail = <T>(error: string): Result<T> => ({ ok: false, error })

interface TaskRow {
  id: string
  title: string
  status: TaskPhase
  tone: string
  progress: number
  model_profile_id: string | null
  scope: string
  summary: string
  result: string
  approval_json: string | null
  artifacts_json: string | null
  created_at: string
}

export interface TaskModelSnapshot { id: string; model?: string; name?: string; provider?: string; endpoint?: string }
export interface TaskModelBinding extends TaskModelSnapshot { apiKey?: string }
interface StoredTaskModelSnapshot extends TaskModelSnapshot { bindingSalt?: string; bindingFingerprint?: string }

export type TaskPlanner = (goal: string, model: TaskModelBinding | null) => Promise<TaskPlan | null>

function bindingFingerprint(model: TaskModelBinding, salt: string): string {
  return createHash('sha256').update(salt).update(JSON.stringify({
    id: model.id, provider: model.provider, endpoint: model.endpoint, model: model.model, apiKey: model.apiKey
  })).digest('hex')
}

function snapshotModel(model: TaskModelBinding): StoredTaskModelSnapshot {
  const bindingSalt = randomUUID()
  return {
    id: model.id, model: model.model, name: model.name, provider: model.provider,
    endpoint: model.endpoint ? (() => { try { const url = new URL(model.endpoint); url.username = ''; url.password = ''; url.search = ''; url.hash = ''; return url.href } catch { return undefined } })() : undefined,
    bindingSalt, bindingFingerprint: bindingFingerprint(model, bindingSalt)
  }
}

function confirmedDirectory(path: string): string {
  const canonical = normalizeTaskRoot(path)
  try { if (!statSync(canonical).isDirectory()) throw new Error('所选对象不是目录') } catch (error) { throw new Error('工作目录不存在、不可访问或不是目录；请重新选择实际目录', { cause: error }) }
  return canonical
}

export class TaskService {
  private modelSnapshotProvider?: () => TaskModelBinding | null
  private modelResolver?: (id: string) => TaskModelBinding | null
  private readonly modelBindings = new Map<string, TaskModelBinding | null>()
  private planner: TaskPlanner | null = null
  private summaryGenerator?: SummaryGenerator
  private toolGate: ((tool: string) => string | null) | null = null
  private changed: ((task: Task) => void) | null = null
  private readonly plans = new Map<string, TaskPlan>()
  private readonly running = new Map<string, { stop: boolean; controller: AbortController }>()
  private isolatedRunner?: IsolatedRunner
  private readonly executionGuards = new Map<string, () => string | null>()
  private readonly pending = new Map<string, Promise<void>>()

  constructor(private readonly db?: SqliteDatabase) {
    this.db?.exec('CREATE TABLE IF NOT EXISTS task_execution_plans(task_id TEXT PRIMARY KEY, plan_json TEXT NOT NULL)')
    this.db?.exec('CREATE TABLE IF NOT EXISTS task_execution_checkpoints(task_id TEXT NOT NULL, step_id TEXT NOT NULL, checkpoint_json TEXT NOT NULL, PRIMARY KEY(task_id,step_id))')
    this.db?.exec('CREATE TABLE IF NOT EXISTS task_model_snapshots(task_id TEXT PRIMARY KEY, snapshot_json TEXT NOT NULL)')
    this.db?.exec('CREATE TABLE IF NOT EXISTS task_teammate_requests(task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE, request_json TEXT NOT NULL)')
    this.db?.exec('CREATE TABLE IF NOT EXISTS task_grounded_checkpoints(task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE, checkpoint_json TEXT NOT NULL)')
    this.recover()
  }

  setModelSnapshotProvider(provider: () => TaskModelBinding | null, resolver?: (id: string) => TaskModelBinding | null): void {
    this.modelSnapshotProvider = provider
    this.modelResolver = resolver
  }

  private boundModel(id: string): TaskModelBinding | null {
    if (this.modelBindings.has(id)) return structuredClone(this.modelBindings.get(id) ?? null)
    const row = this.db?.prepare('SELECT snapshot_json FROM task_model_snapshots WHERE task_id = ?').get(id) as { snapshot_json: string } | undefined
    if (!row) {
      if (this.read(id).model_profile_id) throw new Error('任务缺少原模型绑定证据，未重新规划；请检查原配置或创建新任务')
      this.modelBindings.set(id, null)
      return null
    }
    const snapshot = JSON.parse(row.snapshot_json) as StoredTaskModelSnapshot
    const resolved = this.modelResolver?.(snapshot.id)
    if (!resolved || !snapshot.bindingSalt || !snapshot.bindingFingerprint || bindingFingerprint(resolved, snapshot.bindingSalt) !== snapshot.bindingFingerprint) {
      throw new Error('任务原模型配置已变更、被删除或无法核对，未改用当前模型；原任务已保留，请恢复原配置或创建新任务')
    }
    const binding = structuredClone(resolved)
    this.modelBindings.set(id, binding)
    return structuredClone(binding)
  }

  private rememberImageRequest(id: string, request: unknown): void {
    if (request && typeof request === 'object' && 'tool' in request && request.tool === 'copy-image') {
      this.db?.prepare('INSERT INTO task_teammate_requests(task_id, request_json) VALUES (?, ?) ON CONFLICT(task_id) DO NOTHING').run(id, JSON.stringify(request))
    }
  }

  setIsolatedRunner(runner: IsolatedRunner): void { this.isolatedRunner = runner }

  /** 返回不能用的原因；返回 null 表示这个工具当前已启用。 */
  setToolGate(gate: (tool: string) => string | null): void {
    this.toolGate = gate
  }

  /** 后台执行的每一步进度、结束结果都从这里推出去。 */
  onChange(listener: (task: Task) => void): void {
    this.changed = listener
  }

  /** 等后台执行结束。 */
  settled(id: string): Promise<void> {
    return this.pending.get(id) ?? Promise.resolve()
  }

  private emit(id: string): Task {
    const task = this.require(id)
    this.changed?.(task)
    return task
  }

  /** 有已验证的模型时由模型出计划；没有时 planner 返回 null，执行器按规则处理并如实标注。 */
  setPlanner(planner: TaskPlanner): void {
    this.planner = planner
  }

  setSummaryGenerator(generator: SummaryGenerator): void { this.summaryGenerator = generator }

  private groundedOptions(id: string): GroundedExecutionOptions {
    if (!this.getPlan(id)?.workflow) return {}
    return { summaryGenerator: this.summaryGenerator, summaryModel: this.boundModel(id), groundedCheckpoint: this.groundedCheckpoint(id),
      onGroundedCheckpoint: checkpoint => { this.db?.prepare('INSERT INTO task_grounded_checkpoints(task_id, checkpoint_json) VALUES (?, ?) ON CONFLICT(task_id) DO UPDATE SET checkpoint_json = excluded.checkpoint_json').run(id, JSON.stringify(checkpoint)) } }
  }

  private groundedCheckpoint(id: string): GroundedCheckpoint | undefined {
    const row = this.db?.prepare('SELECT checkpoint_json FROM task_grounded_checkpoints WHERE task_id = ?').get(id) as { checkpoint_json: string } | undefined
    return row ? JSON.parse(row.checkpoint_json) as GroundedCheckpoint : undefined
  }

  private groundedModelGuard(id: string): string | null {
    if (!this.getPlan(id)?.workflow || !this.modelResolver) return null
    const row = this.db?.prepare('SELECT snapshot_json FROM task_model_snapshots WHERE task_id = ?').get(id) as { snapshot_json: string } | undefined
    if (!row) return '摘要任务缺少原模型绑定证据，需重新确认'
    const snapshot = JSON.parse(row.snapshot_json) as StoredTaskModelSnapshot
    const model = this.modelResolver(snapshot.id)
    return !model || !snapshot.bindingSalt || bindingFingerprint(model, snapshot.bindingSalt) !== snapshot.bindingFingerprint ? '任务原模型配置已变更或被删除，未向其他服务发送来源；请恢复原配置或新建任务' : null
  }

  private async plan(title: string, model: TaskModelBinding | null): Promise<TaskPlan | null> {
    if (!this.planner) return null
    try {
      return await this.planner(title, structuredClone(model))
    } catch (error) {
      throw new Error(`计划生成失败，没有执行：${error instanceof Error ? error.message : String(error)}`, { cause: error })
    }
  }

  list(): Task[] {
    if (!this.db) return []
    try {
      const rows = this.db.prepare(
        `SELECT id, title, status, tone, progress, model_profile_id, scope, summary, result, approval_json, artifacts_json, created_at FROM tasks ORDER BY updated_at DESC`
      ).all() as TaskRow[]
      return rows.map((row) => this.toTask(row))
    } catch {
      return []
    }
  }

  /** 判定只认证据：把执行器产出的 ToolCallRecord 交给 Verifier 汇总。 */
  private judge(outcome: GoalOutcome): TaskPhase {
    const verdict = summarizeCalls(outcome.calls.map((call) => ({
      agentRole: call.agentRole,
      execution: { status: call.executionStatus, raw: call.raw, startedAt: '', endedAt: '' },
      verification: { method: call.evidence[0]?.kind ?? 'fs-stat', evidence: call.evidence, verdict: call.verdict }
    })))
    if (verdict === '成功') return '已完成'
    if (verdict === '已取消') return '已取消'
    if (verdict === '部分完成') return '部分完成'
    return '失败'
  }

  async create(title: string, selectedRoot?: string): Promise<Result<Task>> {
    if (!this.db) return fail('任务存储不可用')
    const intent = recognizeIntent(title, true)
    if (intent.question) return fail(intent.question)
    let root: string | null
    try { root = selectedRoot !== undefined ? confirmedDirectory(selectedRoot) : extractRoot(title) } catch (error) { return fail(error instanceof Error ? error.message : '目录无法核对') }
    const selected = structuredClone(this.modelSnapshotProvider?.() ?? null)
    const snapshot = selected ? snapshotModel(selected) : null
    let plan: TaskPlan | null
    const plannerGoal = selectedRoot !== undefined && root ? `${title}\n用户明确确认的工作目录："${root}"；所有文件操作限定在该目录内。` : title
    try { plan = await this.plan(plannerGoal, selected) ?? localRulePlan(title) } catch (error) { return fail(error instanceof Error ? error.message : String(error)) }
    const id = `task-${randomUUID()}`
    let planned: string | null
    try {
      planned = plan.root?.trim() ? normalizeTaskRoot(plan.root) : null
      if (planned && root && !taskRootsEqual(planned, root)) return fail('计划目录与用户指定目录不一致，需重新确认')
      if (root && plan.tool !== 'browser') root = confirmedDirectory(root)
      if (planned) plan.root = planned
    } catch (error) { return fail(error instanceof Error ? error.message : '计划目录无法核对') }
    const now = new Date().toISOString()
    this.db.prepare(
      `INSERT INTO tasks(id, title, status, tone, progress, scope, summary, result, artifacts_json, created_at, updated_at)
       VALUES (?, ?, '待确认', 'blue', 0, ?, '', '', '[]', ?, ?)`
    ).run(id, title, root ?? '', now, now)
    this.modelBindings.set(id, selected)
    if (snapshot) { this.db.prepare('INSERT INTO task_model_snapshots(task_id, snapshot_json) VALUES (?, ?)').run(id, JSON.stringify(snapshot)); this.db.prepare('UPDATE tasks SET model_profile_id = ? WHERE id = ?').run(snapshot.id, id) }
    if (plan) { try { this.savePlan(id, plan) } catch (error) { this.touch(id, error instanceof Error ? error.message : String(error), '计划产物范围需要确认'); return ok(this.emit(id)) } }
    const blocked = plan ? this.toolGate?.(plan.tool) : null
    if (blocked) {
      this.touch(id, `任务受阻：${blocked}`, '需要的工具已停用，没有执行')
      return ok(this.emit(id))
    }
    const question = plan?.question.trim()
    if (question && question !== '无') {
      this.touch(id, `${question} 回答之前不会执行。`, '计划还缺信息')
      return ok(this.emit(id))
    }
    if (!root && (plan?.tool ?? chooseTool(title)) !== 'browser') {
      this.touch(id, planned ? `计划建议的工作目录是 ${planned}。请使用“选择目录并继续”确认实际位置；确认前不会读取文件内容或执行操作。` : '要处理哪个目录或文件？请使用“选择目录并继续”确认实际位置；确认前不会执行。', '还缺少明确确认的目录')
      return ok(this.emit(id))
    }
    this.move(id, '已确认')
    this.move(id, '规划中')
    const preview = await executeGoal({ goal: title, root, approved: false, cancelled: false, plan: this.getPlan(id) ?? plan, ...this.groundedOptions(id) })
    if (preview.status === '等待批准') {
      this.move(id, '执行中')
      this.move(id, '等待批准')
      this.saveOutcome(id, preview)
      return ok(this.emit(id))
    }
    if (preview.status === '待确认') {
      this.db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run('待确认', id)
      this.touch(id, preview.result, preview.summary)
      return ok(this.emit(id))
    }
    this.move(id, '执行中')
    this.move(id, this.judge(preview))
    this.saveOutcome(id, preview)
    notifyTask(this.require(id))
    return ok(this.emit(id))
  }

  /** 队友直接记下的任务。状态按结果写入，不经过整理文件的计划器。 */
  openTeammateTask(input: {
    title: string
    status: '等待批准' | '失败' | '已完成' | '待确认' | '已取消' | '部分完成'
    progress?: number
    summary: string
    result: string
    scope?: string
    approval?: { target: string; impact: string; tool: string; requestedAt: number; containerPath?: string; hostPath?: string } | null
    artifacts?: string[]
  }): Task {
    if (!this.db) throw new Error('任务存储不可用')
    const id = `task-${randomUUID()}`
    const now = new Date().toISOString()
    this.db.prepare(
      `INSERT INTO tasks(id, title, status, tone, progress, scope, summary, result, approval_json, artifacts_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      input.title,
      input.status,
      toneOf(input.status),
      input.status === '已完成' ? 100 : Math.max(0, Math.min(99, input.progress ?? 0)),
      input.scope ?? '',
      input.summary,
      input.result,
      input.approval ? JSON.stringify(input.approval) : null,
      JSON.stringify(input.artifacts ?? []),
      now,
      now
    )
    this.rememberImageRequest(id, input.approval)
    return this.emit(id)
  }

  setCopyImage(handler: (approval: { containerPath?: string; hostPath?: string; signal?: AbortSignal; taskId?: string }) => Promise<{ ok: true; path: string; bytes: number; hash?: string; sourceHash?: string; note?: string; procedureId?: string } | { ok: false; reason: string; path?: string; bytes?: number; hash?: string; outcomeKnown?: boolean }>): void {
    this.copyImage = handler
  }

  private copyImage?: (approval: { containerPath?: string; hostPath?: string; signal?: AbortSignal; taskId?: string }) => Promise<{ ok: true; path: string; bytes: number; hash?: string; sourceHash?: string; note?: string; procedureId?: string } | { ok: false; reason: string; path?: string; bytes?: number; hash?: string; outcomeKnown?: boolean }>

  /** 批准后立即返回「执行中」，执行在后台按文件推进，进度和结果经 onChange 推送。 */
  approve(id: string, scope: ApprovalScope = 'once'): Promise<Result<Task>> {
    const current = this.read(id)
    if (current.status !== '等待批准') return Promise.resolve(fail('当前没有待批准的操作'))
    const approval = current.approval_json ? JSON.parse(current.approval_json) as { requestedAt?: number; tool?: string; containerPath?: string; hostPath?: string; impact?: string } : {}
    this.rememberImageRequest(id, approval)
    const gateTool = approval.tool === 'copy-image' ? 'filesystem' : approval.tool ?? this.getPlan(id)?.tool ?? 'filesystem'
    const gateReason = this.toolGate?.(gateTool)
    if (gateReason) { this.touch(id, `任务受阻：${gateReason}`, '工具已停用'); return Promise.resolve(ok(this.emit(id))) }
    if (typeof approval.requestedAt !== 'number' || approvalExpired(approval.requestedAt, Date.now())) {
      this.db?.prepare('UPDATE tasks SET status = ?, approval_json = NULL, updated_at = ? WHERE id = ?').run('待确认', new Date().toISOString(), id)
      this.touch(id, '审批无效或已过期，没有执行；请核对并继续以重新生成审批。', '审批需要更新')
      return Promise.resolve(ok(this.emit(id)))
    }
    if (approval.tool === 'copy-image') this.appendCall(id, { agentRole: 'Planner', toolId: 'approval', declared: '批准本次准确图片目标', executionStatus: 'ok', raw: JSON.stringify({ taskId: id, scope, approval }), evidence: [], verdict: 'confirmed', stepId: 'approval', traceId: randomUUID() })
    if (approval.tool === 'copy-image') return this.copyApprovedImage(id, approval)
    const tool = approval.tool ?? this.getPlan(id)?.tool ?? 'filesystem'
    const blocked = this.toolGate?.(tool)
    if (blocked) {
      this.touch(id, `任务受阻：${blocked}`, '需要的工具已停用，没有执行')
      return Promise.resolve(ok(this.emit(id)))
    }
    this.move(id, '执行中')
    this.appendCall(id, { agentRole: 'Planner', toolId: 'approval', declared: `批准范围：${scope === 'once' ? '本次一项操作' : '本任务此版本计划'}`, executionStatus: 'ok', raw: JSON.stringify({ taskId: id, scope, root: current.scope, approvedAt: Date.now(), requestedAt: approval.requestedAt, plan: this.getPlan(id) }), evidence: [], verdict: 'confirmed', stepId: 'approval', traceId: randomUUID(), args: { scope, taskId: id, root: current.scope } })
    const control = { stop: false, controller: new AbortController() }
    const approvedPlan = JSON.stringify(this.getPlan(id) ?? null)
    const approvedAt = approval.requestedAt!
    this.executionGuards.set(id, () => approvalExpired(approvedAt, Date.now()) ? '批准已过期，未开始后续操作' : approvedPlan !== JSON.stringify(this.getPlan(id) ?? null) ? '计划变更，需重新批准' : this.groundedModelGuard(id))
    this.running.set(id, control)
    this.db?.prepare(`UPDATE tasks SET approval_json = NULL, summary = ?, result = ?, updated_at = ? WHERE id = ?`).run(
      '执行中',
      '正在执行，可以随时取消。取消后不会再移动新文件。',
      new Date().toISOString(),
      id
    )
    this.pending.set(id, this.run(id, current, control, scope, approval.impact))
    return Promise.resolve(ok(this.emit(id)))
  }

  private async copyApprovedImage(id: string, approval: { requestedAt?: number; containerPath?: string; hostPath?: string }): Promise<Result<Task>> {
    if (typeof approval.requestedAt !== 'number' || approvalExpired(approval.requestedAt, Date.now())) {
      this.touch(id, '任务受阻：审批无效或已超过 10 分钟，未复制。', '需要重新确认'); return ok(this.emit(id))
    }
    this.move(id, '执行中')
    const control = { stop: false, controller: new AbortController() }; this.running.set(id, control)
    const job = (async (): Promise<void> => {
      const startedAt = new Date().toISOString()
      const traceId = randomUUID()
      this.appendCall(id, { agentRole: 'Worker', toolId: 'filesystem', declared: '开始本次已批准图片复制；结果尚未知', executionStatus: 'error', raw: '开始复制，结果尚未知；恢复时先核对，不能重放', evidence: [], verdict: 'inconclusive', stepId: 'copy-image', traceId, phase: 'started', startedAt, args: { hostPath: approval.hostPath, containerPath: approval.containerPath } })
      let knownOutcome = true
      let copiedPath: string | undefined
      try {
        if (!this.copyImage || !approval.hostPath) throw new Error('没有可核对的图片路径')
        const blocked = this.toolGate?.('filesystem'); if (blocked) throw new Error(blocked)
        const copied = await this.copyImage({ ...approval, signal: control.controller.signal, taskId: id })
        if (copied.path) {
          const intended = resolveInside(approval.hostPath, '.')
          if (resolveInside(intended, copied.path) === intended) {
            copiedPath = intended
            this.db?.prepare('UPDATE tasks SET artifacts_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify([intended]), new Date().toISOString(), id)
          }
        }
        if (!copied.ok) { knownOutcome = copied.outcomeKnown ?? !/清理失败|停止尚未核实/.test(copied.reason); throw new Error(copied.reason) }
        copiedPath = resolveInside(approval.hostPath, '.')
        if (resolveInside(copiedPath, copied.path) !== copiedPath) throw new Error('实际复制位置不符合本次批准目标')
        const stat = statSync(copiedPath)
        if (!stat.isFile() || stat.size <= 0 || stat.size !== copied.bytes) throw new Error('复制结果大小或类型核验失败')
        const hash = createHash('sha256').update(readFileSync(copiedPath)).digest('hex')
        if ((copied.hash && copied.hash !== hash) || (copied.sourceHash && copied.sourceHash !== hash)) throw new Error('图片原件与导出目标哈希不一致')
        this.db?.prepare('UPDATE tasks SET artifacts_json = ?, progress = ?, updated_at = ? WHERE id = ?').run(JSON.stringify([copiedPath]), 100, new Date().toISOString(), id)
        this.appendCall(id, { agentRole: 'Worker', toolId: 'filesystem', declared: '按批准目标复制图片', executionStatus: control.stop ? 'aborted' : 'ok', raw: `${copiedPath} (${stat.size} bytes)`, evidence: [{ kind: 'fs-stat', target: copiedPath, expected: `${copied.bytes} bytes`, actual: `${stat.size} bytes`, matched: true }, { kind: 'fs-hash', target: copiedPath, expected: copied.sourceHash ?? copied.hash ?? hash, actual: hash, matched: true }], verdict: 'confirmed', stepId: 'copy-image', traceId, phase: 'result', args: { containerPath: approval.containerPath, hostPath: approval.hostPath, outcomeKnown: true, sourceHash: copied.sourceHash, procedureId: copied.procedureId }, startedAt, endedAt: new Date().toISOString() })
        this.move(id, control.stop ? '已取消' : '已完成')
        this.touch(id, `${control.stop ? '取消前已复制' : '已复制'} ${copiedPath}，${stat.size} 字节。${copied.note ?? ''}`, control.stop ? '已取消，保留实际产物' : '图片已核验')
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.appendCall(id, { agentRole: 'Worker', toolId: 'filesystem', declared: '复制图片', executionStatus: control.stop ? 'aborted' : 'error', raw: `${message}${copiedPath ? `；可能已写入 ${copiedPath}` : ''}`, evidence: [], verdict: 'refuted', stepId: 'copy-image', traceId, phase: 'result', args: { hostPath: approval.hostPath, containerPath: approval.containerPath, outcomeKnown: knownOutcome }, startedAt, endedAt: new Date().toISOString() })
        this.move(id, control.stop ? '已取消' : '失败'); this.touch(id, message, '复制未通过核验')
      } finally { this.running.delete(id); this.pending.delete(id); notifyTask(this.emit(id)) }
    })()
    this.pending.set(id, job)
    // Avoid a stale pending entry if a synchronous handler immediately settles.
    void job.finally(() => this.pending.delete(id))
    return ok(this.emit(id))
  }

  private async run(id: string, current: TaskRow, control: { stop: boolean; controller: AbortController }, scope: ApprovalScope, approvedImpact?: string): Promise<void> {
    try {
      const done = await executeGoal({
        goal: current.title,
        root: current.scope || null,
        approved: true,
        cancelled: false,
        plan: this.getPlan(id) ?? null,
        ...this.groundedOptions(id),
        approvedGroundedImpact: approvedImpact,
        runner: this.isolatedRunner,
        taskId: id,
        approvalScope: scope,
        checkpoints: this.checkpoints(id),
        onCheckpoint: (checkpoint) => { this.db?.prepare('INSERT INTO task_execution_checkpoints(task_id, step_id, checkpoint_json) VALUES (?, ?, ?) ON CONFLICT(task_id,step_id) DO UPDATE SET checkpoint_json = excluded.checkpoint_json').run(id, checkpoint.stepId, JSON.stringify(checkpoint)) },
        toolGate: (tool) => this.toolGate?.(tool) ?? null,
        executionGuard: this.executionGuards.get(id),
        onCall: (call) => {
          this.appendCall(id, call)
          if (call.agentRole !== 'Worker' || !call.stepId) return
          const running = call.phase === 'started'
          const completed = !running && call.verdict === 'confirmed'
          this.db?.prepare('UPDATE task_steps SET state = ?, tone = ?, detail = ? WHERE task_id = ? AND id = ?').run(running ? '进行中' : completed ? '完成' : '待执行', running ? 'blue' : completed ? 'green' : 'red', running ? `${call.declared || '正在执行'}；结果尚未返回。` : call.raw, id, `${id}-${call.stepId}`)
          this.db?.prepare("UPDATE tasks SET progress = (SELECT 100.0 * SUM(CASE WHEN state = '完成' THEN 1 ELSE 0 END) / MAX(COUNT(*), 1) FROM task_steps WHERE task_id = ?), updated_at = ? WHERE id = ?").run(id, new Date().toISOString(), id)
          this.emit(id)
        },
        control: {
          stopped: () => control.stop,
          signal: control.controller.signal,
          effect: (effect) => {
            const task = this.read(id); const artifacts = JSON.parse(task.artifacts_json ?? '[]') as string[]
            if (effect.status === 'moved') artifacts.push(effect.destination)
            this.db?.prepare('UPDATE tasks SET artifacts_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify([...new Set(artifacts)]), new Date().toISOString(), id)
            this.appendCall(id, { agentRole: 'Worker', toolId: 'filesystem.effect', declared: '逐文件实际影响', executionStatus: effect.status === 'moved' ? 'ok' : 'error', raw: JSON.stringify(effect), evidence: [], verdict: 'inconclusive', stepId: `effect-${randomUUID()}`, args: effect })
          },
          progress: (count, total, note) => {
            this.db?.prepare(`UPDATE tasks SET progress = ?, summary = ?, updated_at = ? WHERE id = ?`).run(
              Math.round(count / Math.max(total, 1) * 100),
              `已处理 ${count}/${total}：${note}`,
              new Date().toISOString(),
              id
            )
            this.emit(id)
          }
        }
      })
      this.move(id, control.stop ? '已取消' : done.status)
      this.saveOutcome(id, done)
    } catch (error) {
      const message = error instanceof Error ? error.message : '执行出错'
      this.move(id, control.stop ? '已取消' : '失败')
      this.touch(id, `执行中断：${message}。已经移动的文件保持原样。`, '执行出错')
    } finally {
      this.running.delete(id)
      this.executionGuards.delete(id)
      this.pending.delete(id)
      notifyTask(this.emit(id))
    }
  }

  deny(id: string): Promise<Result<Task>> {
    const current = this.read(id)
    if (current.status !== '等待批准') return Promise.resolve(fail('当前没有待批准的操作'))
    if (current.approval_json) this.rememberImageRequest(id, JSON.parse(current.approval_json))
    this.db?.prepare('UPDATE tasks SET status = ?, approval_json = NULL, updated_at = ? WHERE id = ?').run('待确认', new Date().toISOString(), id)
    this.touch(id, '任务受阻：敏感操作未获批准，没有执行。可以补充要求后重新确认。', '未批准，未执行')
    return Promise.resolve(ok(this.emit(id)))
  }

  cancel(id: string): Promise<Result<Task>> {
    const control = this.running.get(id)
    if (control) {
      control.stop = true
      control.controller.abort()
      if (this.read(id).status === '执行中') this.move(id, '正在停止')
      this.touch(id, '正在停止：手上这个文件处理完就停，不再移动新文件。', '正在停止')
      return Promise.resolve(ok(this.emit(id)))
    }
    const current = this.read(id)
    if (['已完成', '失败', '部分完成', '已取消', '已中断'].includes(current.status)) return Promise.resolve(ok(this.emit(id)))
    if (current.status === '执行中') this.move(id, '正在停止')
    const latest = this.read(id)
    this.move(latest.status === '正在停止' || latest.status === '等待批准' || latest.status === '待确认' || latest.status === '已确认' || latest.status === '规划中' ? latest.id : id, '已取消')
    this.touch(id, '任务已取消。进行中的操作已停止安排，已经产生的文件保持原样。', '已停止安排后续操作')
    return Promise.resolve(ok(this.emit(id)))
  }

  private recover(): void {
    if (!this.db) return
    try {
      const rows = this.db.prepare(`SELECT id, status FROM tasks`).all() as Array<{ id: string; status: TaskPhase }>
      for (const row of rows) {
        const next = interruptOnRestart(row.status)
        if (next !== row.status) {
          this.db.prepare(`UPDATE tasks SET status = ?, result = ?, updated_at = ? WHERE id = ?`).run(
            next,
            '已中断，待用户决定。不会自动重做已产生副作用的步骤。',
            new Date().toISOString(),
            row.id
          )
          this.db.prepare("UPDATE task_steps SET state = '待核对', tone = 'amber', detail = detail || '；上次执行已中断，实际结果需要核对，尚未恢复执行。' WHERE task_id = ? AND state IN ('进行中', '正在停止')").run(row.id)
        }
      }
    } catch {
      // 表尚未迁移时不阻断启动。
    }
  }

  private move(id: string, to: TaskPhase): void {
    const current = this.read(id)
    const next = transition(current.status, to)
    this.db?.prepare(`UPDATE tasks SET status = ?, tone = ?, updated_at = ? WHERE id = ?`).run(next, toneOf(next), new Date().toISOString(), id)
  }

  private touch(id: string, result: string, summary: string): void {
    this.db?.prepare(`UPDATE tasks SET result = ?, summary = ?, updated_at = ? WHERE id = ?`).run(result, summary, new Date().toISOString(), id)
  }

  private saveOutcome(id: string, outcome: GoalOutcome): void {
    if (!this.db) return
    const now = new Date().toISOString()
    this.db.prepare(
      `UPDATE tasks SET summary = ?, result = ?, progress = ?, approval_json = ?, artifacts_json = ?, updated_at = ? WHERE id = ?`
    ).run(
      outcome.summary,
      outcome.result,
      outcome.steps.filter((step) => step.state === '完成').length / Math.max(outcome.steps.length, 1) * 100,
      outcome.approval ? JSON.stringify(outcome.approval) : null,
      JSON.stringify([...new Set([...(JSON.parse(this.read(id).artifacts_json ?? '[]') as string[]), ...outcome.artifacts])]),
      now,
      id
    )
    this.db.prepare(`DELETE FROM task_steps WHERE task_id = ?`).run(id)
    const insertStep = this.db.prepare(
      `INSERT INTO task_steps(id, task_id, title, detail, state, tone, time_label, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    outcome.steps.forEach((step, index) => {
      insertStep.run(`${id}-${step.id}`, id, step.title, step.detail, step.state, step.tone, '', index)
    })
    outcome.calls.forEach((item) => this.appendCall(id, item))
  }

  private appendCall(id: string, item: GoalOutcome['calls'][number]): void {
    const now = new Date().toISOString()
    const snapshot = item.agentRole === 'Planner' && item.toolId === 'model' ? this.db?.prepare('SELECT snapshot_json FROM task_model_snapshots WHERE task_id = ?').get(id) as { snapshot_json: string } | undefined : undefined
    const callId = `${id}-${item.traceId ?? item.stepId ?? 'work'}-${item.agentRole}-${item.phase ?? 'result'}`
    this.db?.prepare(`INSERT INTO tool_calls(id, task_id, step_id, tool_id, declared_json, execution_json, verification_json, created_at, agent_role) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET execution_json = excluded.execution_json, verification_json = excluded.verification_json`).run(callId, id, `${id}-${item.stepId ?? 'work'}`, item.toolId, JSON.stringify({ intent: item.declared, args: { ...(typeof item.args === 'object' && item.args ? item.args : {}), traceId: item.traceId, phase: item.phase, ...(snapshot ? { modelSnapshot: JSON.parse(snapshot.snapshot_json) as TaskModelSnapshot } : {}) } }), JSON.stringify({ status: item.executionStatus, raw: item.raw, startedAt: item.startedAt ?? now, endedAt: item.endedAt ?? now }), JSON.stringify({ method: 'independent', evidence: item.evidence, verdict: item.verdict }), now, item.agentRole)
  }

  private savePlan(id: string, plan: TaskPlan, approvedRoot?: string): void {
    const root = approvedRoot ?? this.read(id).scope
    plan = structuredClone(plan)
    for (const step of plan.steps) {
      const tool = step.tool ?? plan.tool
      const needsFiles = tool === 'filesystem' || Boolean(step.outputs?.length)
      if (needsFiles) { const blocked = this.toolGate?.('filesystem'); if (blocked) throw new Error(blocked) }
      if (tool === 'filesystem' && (step.args?.action === 'organize' || plan.steps.length === 1 && /按类型|按扩展名|归类/.test(step.title))) {
        step.args = { ...step.args, action: 'organize', ...(root ? { files: organizeManifest(resolveInside(root, step.workspace ?? '.')) } : {}) }
      }
    }
    for (const step of plan.steps) for (const output of root ? step.outputs ?? [] : []) {
      const path = resolveInside(resolveInside(root, step.workspace ?? '.'), output.path)
      try { if (!statSync(path).isFile()) throw new Error('声明的产物目标不是文件'); output.baselineHash = createHash('sha256').update(readFileSync(path)).digest('hex') } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') output.baselineHash = null; else throw error }
      const check = step.checks?.find((item) => item.path === output.path && (item.kind === 'file-content' || item.kind === 'file-hash'))
      if (check?.kind === 'file-content' && output.expectedContent === undefined) output.expectedContent = check.value
      if (check?.kind === 'file-hash' && output.expectedHash === undefined) output.expectedHash = check.value
    }
    this.plans.set(id, structuredClone(plan))
    this.db?.prepare('INSERT INTO task_execution_plans(task_id, plan_json) VALUES (?, ?) ON CONFLICT(task_id) DO UPDATE SET plan_json = excluded.plan_json').run(id, JSON.stringify(plan))
  }
  private getPlan(id: string): TaskPlan | undefined {
    const current = this.plans.get(id); if (current) return current
    const row = this.db?.prepare('SELECT plan_json FROM task_execution_plans WHERE task_id = ?').get(id) as { plan_json: string } | undefined
    if (!row) return undefined
    const plan = JSON.parse(row.plan_json) as TaskPlan; this.plans.set(id, plan); return plan
  }

  private checkpoints(id: string): StepCheckpoint[] {
    const rows = this.db?.prepare('SELECT checkpoint_json FROM task_execution_checkpoints WHERE task_id = ?').all(id) as Array<{ checkpoint_json: string }> | undefined
    return (rows ?? []).map((row) => JSON.parse(row.checkpoint_json) as StepCheckpoint)
  }

  async continueTask(id: string, answer: string): Promise<Result<Task>> {
    const current = this.read(id)
    if (!['待确认', '已中断', '失败', '部分完成', '已取消'].includes(current.status)) return fail('当前任务不在可补充或恢复的状态')
    const checkpoints = this.checkpoints(id)
    const grounded = Boolean(this.getPlan(id)?.workflow)
    const resumeRequested = /^\s*(继续|恢复|resume|continue)\s*$/i.test(answer)
    const priorSummary = this.groundedCheckpoint(id)
    // Check the durable receipt before replanning: an ordinary replacement must not hide an unresolved summary write.
    if (priorSummary && !priorSummary.outcomeKnown && (!grounded || !resumeRequested)) return fail('上次摘要写入的实际结果尚未核对，不能替换原计划；请先使用“核对并继续”核对原目标，之后再新建其他任务。')
    const unknown = this.require(id).toolCalls.some((call) => {
      if (call.agentRole !== 'Worker' || call.toolId === 'filesystem.effect') return false
      // The dedicated workflow reconciles its persisted write receipt against disk before any replay.
      if (grounded && (call.toolId === 'model.summary' || call.stepId === `${id}-summary-save`)) return false
      const args = call.declared.args as { phase?: string; traceId?: string }
      return args.phase === 'started' ? !checkpoints.some((checkpoint) => checkpoint.traceId === args.traceId && checkpoint.outcomeKnown) && !this.require(id).toolCalls.some((result) => { const final = result.declared.args as { traceId?: string; phase?: string; outcomeKnown?: boolean }; return final.traceId === args.traceId && final.phase === 'result' && final.outcomeKnown === true }) : !args.traceId && checkpoints.length === 0
    })
    if (unknown || checkpoints.some((checkpoint) => !checkpoint.outcomeKnown)) return fail('仍有实际副作用未知的调用，需先核对结果；不会重放')
    const imageRow = this.db?.prepare('SELECT request_json FROM task_teammate_requests WHERE task_id = ?').get(id) as { request_json: string } | undefined
    if (imageRow) {
      if (!/^\s*(继续|恢复|resume|continue)\s*$/i.test(answer)) return fail('此任务是固定目标的图片请求。可核对并继续；若要改变画面或保存位置，请新建请求。')
      const request = JSON.parse(imageRow.request_json) as ApprovalRequest & { hostPath?: string; requestedAt: number }
      if (!request.hostPath || !isAbsolute(request.hostPath) || request.hostPath !== request.target) return fail('图片目标无法核对，请重新发起图片请求')
      if (existsSync(request.hostPath)) return fail('图片目标已经存在，请先检查已有成果；不会覆盖或重复生成')
      const blocked = this.toolGate?.('filesystem'); if (blocked) return fail(blocked)
      request.requestedAt = Date.now()
      this.db?.prepare('UPDATE tasks SET status = ?, approval_json = ?, summary = ?, result = ?, updated_at = ? WHERE id = ?').run('等待批准', JSON.stringify(request), '图片请求已重新核对，等待批准', '仍将写入原来确认的目标。批准前不会生成或复制图片。', new Date().toISOString(), id)
      return ok(this.emit(id))
    }
    const resume = (checkpoints.length > 0 || grounded) && resumeRequested
    const goal = resumeRequested ? current.title : `${current.title}\n用户补充：${answer}`
    let plan: TaskPlan | null
    try { plan = resume ? this.getPlan(id) ?? null : await this.plan(goal, this.boundModel(id)) ?? localRulePlan(goal) } catch (error) { return fail(error instanceof Error ? error.message : String(error)) }
    let root: string | null
    try {
      // Preserve the stored spelling on resume: existing checkpoint hashes include that exact scope.
      root = extractRoot(answer) ?? (current.scope || null)
      if (root && plan?.root?.trim() && !taskRootsEqual(root, plan.root)) return fail('计划目录与本次确认的目录不一致；原计划与授权范围已保留，请重新确认')
      if (root && !resume && plan?.tool !== 'browser') root = confirmedDirectory(root)
    } catch (error) { return fail(error instanceof Error ? error.message : '目录无法核对') }
    if (!root && (plan?.tool ?? chooseTool(goal)) !== 'browser') return fail('仍缺少明确授权目录')
    if (plan && !resume) this.savePlan(id, plan, root ?? '')
    let preview: GoalOutcome
    try {
      const blocked = this.groundedModelGuard(id); if (blocked) return fail(blocked)
      preview = await executeGoal({ goal, root, approved: false, cancelled: false, plan: this.getPlan(id) ?? plan, taskId: id, checkpoints, ...this.groundedOptions(id) })
    } catch (error) { return fail(error instanceof Error ? error.message : '摘要恢复失败，未自动重放') }
    this.db?.prepare('UPDATE tasks SET title = ?, scope = ?, status = ?, updated_at = ? WHERE id = ?').run(goal, root ?? '', preview.status, new Date().toISOString(), id)
    this.saveOutcome(id, preview); return ok(this.emit(id))
  }

  private require(id: string): Task {
    return this.toTask(this.read(id))
  }

  private read(id: string): TaskRow {
    const row = this.db?.prepare(
      `SELECT id, title, status, tone, progress, model_profile_id, scope, summary, result, approval_json, artifacts_json, created_at FROM tasks WHERE id = ?`
    ).get(id) as TaskRow | undefined
    if (!row) throw new Error('任务不存在')
    return row
  }

  private toTask(row: TaskRow): Task {
    const steps = this.db?.prepare(
      `SELECT id, title, detail, state, tone, time_label FROM task_steps WHERE task_id = ? ORDER BY position`
    ).all(row.id) as Array<{ id: string; title: string; detail: string; state: TaskStep['state']; tone: Tone; time_label: string }> | undefined
    const calls = this.db?.prepare(
      `SELECT id, task_id, step_id, tool_id, declared_json, execution_json, verification_json, agent_role FROM tool_calls WHERE task_id = ? ORDER BY created_at`
    ).all(row.id) as Array<{
      id: string
      task_id: string
      step_id: string
      tool_id: string
      declared_json: string
      execution_json: string
      verification_json: string
      agent_role: ToolCallRecord['agentRole']
    }> | undefined
    const approval = row.approval_json ? JSON.parse(row.approval_json) as ApprovalRequest & { requestedAt?: number } : null
    return {
      id: row.id,
      title: row.title,
      status: row.status,
      tone: toneOf(row.status),
      progress: row.progress,
      created: row.created_at,
      model: row.model_profile_id ?? '',
      modelProfileId: row.model_profile_id,
      scope: row.scope,
      summary: row.summary,
      steps: (steps ?? []).map((step) => ({
        id: step.id,
        title: step.title,
        detail: step.detail,
        state: step.state,
        tone: step.tone,
        time: step.time_label
      })),
      artifacts: row.artifacts_json ? JSON.parse(row.artifacts_json) as string[] : [],
      approval: approval && row.status === '等待批准' ? { target: approval.target, impact: approval.impact, tool: approval.tool } : null,
      result: row.result,
      toolCalls: (calls ?? []).map((item) => this.toCall(item)),
      verdict: null
    }
  }

  private toCall(item: {
    id: string
    task_id: string
    step_id: string
    tool_id: string
    declared_json: string
    execution_json: string
    verification_json: string
    agent_role: ToolCallRecord['agentRole']
  }): ToolCallRecord {
    const declared = JSON.parse(item.declared_json) as ToolCallRecord['declared']
    const execution = JSON.parse(item.execution_json) as ToolCallRecord['execution']
    const verification = JSON.parse(item.verification_json) as { method: string; evidence: Evidence[]; verdict: Verdict }
    return {
      id: item.id,
      taskId: item.task_id,
      stepId: item.step_id,
      toolId: item.tool_id,
      agentRole: item.agent_role,
      declared,
      execution,
      verification
    }
  }
}

function toneOf(status: TaskPhase): Tone {
  if (status === '失败') return 'red'
  if (status === '等待批准' || status === '已中断' || status === '部分完成' || status === '正在停止') return 'amber'
  if (status === '已完成') return 'green'
  if (status === '已取消') return 'gray'
  return 'blue'
}
