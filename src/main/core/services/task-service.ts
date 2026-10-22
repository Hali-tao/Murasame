import { Notification } from 'electron'
import type { SqliteDatabase } from '../../data/sqlite-types'
import { approvalExpired, approvalKey, consumeOnce, grant, type ApprovalScope } from '../../agent/approval-gate'
import { isAbsolute } from 'node:path'
import { executeGoal, extractRoot, type GoalOutcome, type TaskPlan } from '../../agent/executor'
import { recognizeIntent } from '../../agent/planner'
import { overBudget } from '../../agent/runtime'
import { summarizeCalls } from '../../agent/verifier'
import { interruptOnRestart, transition, type TaskPhase } from '../../agent/state-machine'
import type { Evidence, ToolCallRecord, Verdict } from '../../../shared/evidence'
import type { ApprovalRequest, Result, Task, TaskStep, Tone } from '../../../shared/types'
import { getSettings } from '../../settings'

const taskGrants = new Map<string, ApprovalScope>()

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

export type TaskPlanner = (goal: string) => Promise<TaskPlan | null>

export class TaskService {
  private planner: TaskPlanner | null = null
  private toolGate: ((tool: string) => string | null) | null = null
  private changed: ((task: Task) => void) | null = null
  private readonly plans = new Map<string, TaskPlan>()
  private readonly running = new Map<string, { stop: boolean }>()
  private readonly pending = new Map<string, Promise<void>>()

  constructor(private readonly db?: SqliteDatabase) {
    this.recover()
  }

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

  private async plan(title: string): Promise<TaskPlan | null> {
    if (!this.planner) return null
    try {
      return await this.planner(title)
    } catch {
      return null
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
      execution: { status: call.executionStatus, raw: call.raw, startedAt: '', endedAt: '' },
      verification: { method: call.evidence[0]?.kind ?? 'fs-stat', evidence: call.evidence, verdict: call.verdict }
    })))
    if (verdict === '成功') return '已完成'
    if (verdict === '已取消') return '已取消'
    if (verdict === '部分完成') return '部分完成'
    return '失败'
  }

  async create(title: string): Promise<Result<Task>> {
    if (!this.db) return fail('任务存储不可用')
    const intent = recognizeIntent(title, true)
    if (intent.question) return fail(intent.question)
    const plan = await this.plan(title)
    const id = `task-${Date.now()}`
    const planned = plan?.root && isAbsolute(plan.root) ? plan.root.replace(/[\\/]+$/, '') : null
    const root = planned ?? extractRoot(title)
    const now = new Date().toISOString()
    this.db.prepare(
      `INSERT INTO tasks(id, title, status, tone, progress, scope, summary, result, artifacts_json, created_at, updated_at)
       VALUES (?, ?, '待确认', 'blue', 0, ?, '', '', '[]', ?, ?)`
    ).run(id, title, root ?? '', now, now)
    if (plan) this.plans.set(id, plan)
    const blocked = plan ? this.toolGate?.(plan.tool) : null
    if (blocked) {
      this.touch(id, `任务受阻：${blocked}`, '需要的工具已停用，没有执行')
      return ok(this.require(id))
    }
    const question = plan?.question.trim()
    if (question && question !== '无') {
      this.touch(id, `${question} 回答之前不会执行。`, '计划还缺信息')
      return ok(this.require(id))
    }
    if (!root && plan?.tool !== 'browser') {
      this.touch(id, '要处理哪个目录或文件？未确认具体对象前不会执行。', '还缺少具体目录')
      return ok(this.require(id))
    }
    this.move(id, '已确认')
    this.move(id, '规划中')
    const preview = await executeGoal({ goal: title, root, approved: false, cancelled: false, plan })
    if (preview.status === '等待批准') {
      this.move(id, '执行中')
      this.move(id, '等待批准')
      this.saveOutcome(id, preview)
      return ok(this.require(id))
    }
    if (preview.status === '待确认') {
      this.touch(id, preview.result, preview.summary)
      return ok(this.require(id))
    }
    this.move(id, '执行中')
    this.move(id, this.judge(preview))
    this.saveOutcome(id, preview)
    notifyTask(this.require(id))
    return ok(this.require(id))
  }

  /** 批准后立即返回「执行中」，执行在后台按文件推进，进度和结果经 onChange 推送。 */
  approve(id: string, scope: ApprovalScope = 'once'): Promise<Result<Task>> {
    const current = this.read(id)
    if (current.status !== '等待批准') return Promise.resolve(fail('当前没有待批准的操作'))
    const approval = current.approval_json ? JSON.parse(current.approval_json) as { requestedAt?: number; tool?: string } : {}
    if (approval.requestedAt && approvalExpired(approval.requestedAt, Date.now())) {
      this.touch(id, '任务受阻：批准已超过 10 分钟，没有执行。', current.summary)
      return Promise.resolve(ok(this.require(id)))
    }
    const tool = this.plans.get(id)?.tool ?? approval.tool ?? 'filesystem'
    const blocked = this.toolGate?.(tool)
    if (blocked) {
      this.touch(id, `任务受阻：${blocked}`, '需要的工具已停用，没有执行')
      return Promise.resolve(ok(this.require(id)))
    }
    this.move(id, '执行中')
    const key = approvalKey(tool, current.scope || id)
    grant(key, scope, taskGrants)
    if (scope === 'once') consumeOnce(key, taskGrants)
    const control = { stop: false }
    this.running.set(id, control)
    this.db?.prepare(`UPDATE tasks SET approval_json = NULL, summary = ?, result = ?, updated_at = ? WHERE id = ?`).run(
      '执行中',
      '正在执行，可以随时取消。取消后不会再移动新文件。',
      new Date().toISOString(),
      id
    )
    this.pending.set(id, this.run(id, current, control))
    return Promise.resolve(ok(this.emit(id)))
  }

  private async run(id: string, current: TaskRow, control: { stop: boolean }): Promise<void> {
    try {
      const done = await executeGoal({
        goal: current.title,
        root: current.scope || null,
        approved: true,
        cancelled: false,
        plan: this.plans.get(id) ?? null,
        control: {
          stopped: () => control.stop,
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
      const budget = overBudget(done.calls.length, 24)
      this.move(id, control.stop ? '已取消' : budget === '部分完成' ? '部分完成' : this.judge(done))
      this.saveOutcome(id, done)
    } catch (error) {
      const message = error instanceof Error ? error.message : '执行出错'
      this.move(id, control.stop ? '已取消' : '失败')
      this.touch(id, `执行中断：${message}。已经移动的文件保持原样。`, '执行出错')
    } finally {
      this.running.delete(id)
      this.pending.delete(id)
      notifyTask(this.emit(id))
    }
  }

  deny(id: string): Promise<Result<Task>> {
    const current = this.read(id)
    if (current.status !== '等待批准') return Promise.resolve(fail('当前没有待批准的操作'))
    this.touch(id, '任务受阻：敏感操作未获批准，没有执行。', '未批准，文件系统没有变化')
    return Promise.resolve(ok(this.require(id)))
  }

  cancel(id: string): Promise<Result<Task>> {
    const control = this.running.get(id)
    if (control) {
      control.stop = true
      if (this.read(id).status === '执行中') this.move(id, '正在停止')
      this.touch(id, '正在停止：手上这个文件处理完就停，不再移动新文件。', '正在停止')
      return Promise.resolve(ok(this.emit(id)))
    }
    const current = this.read(id)
    if (current.status === '执行中') this.move(id, '正在停止')
    const latest = this.read(id)
    this.move(latest.status === '正在停止' || latest.status === '等待批准' || latest.status === '待确认' || latest.status === '已确认' || latest.status === '规划中' ? latest.id : id, '已取消')
    this.touch(id, '任务已取消。进行中的操作已停止安排，已经产生的文件保持原样。', '已停止安排后续操作')
    return Promise.resolve(ok(this.require(id)))
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
      JSON.stringify(outcome.artifacts),
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
    this.db.prepare(`DELETE FROM tool_calls WHERE task_id = ?`).run(id)
    const insertCall = this.db.prepare(
      `INSERT INTO tool_calls(id, task_id, step_id, tool_id, declared_json, execution_json, verification_json, created_at, agent_role)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    outcome.calls.forEach((item, index) => {
      insertCall.run(
        `${id}-call-${index}`,
        id,
        `${id}-work`,
        item.toolId,
        JSON.stringify({ intent: item.declared, args: { agentRole: item.agentRole } }),
        JSON.stringify({ status: item.executionStatus, raw: item.raw, startedAt: now, endedAt: now }),
        JSON.stringify({ method: item.evidence[0]?.kind ?? 'fs-stat', evidence: item.evidence, verdict: item.verdict }),
        now,
        item.agentRole
      )
    })
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
