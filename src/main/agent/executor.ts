import { readdirSync } from 'node:fs'
import type { Evidence, Verdict } from '../../shared/evidence'
import type { TaskPhase } from './state-machine'
import { readVisiblePage } from '../tools/browser'
import { organizeByKind, verifyWritten, type WorkControl } from '../tools/filesystem'
import { runGit } from '../tools/git'
import { runTerminal, type ToolRun } from '../tools/terminal'

export interface AgentCall {
  agentRole: 'Planner' | 'Worker' | 'Critic'
  toolId: string
  declared: string
  executionStatus: ToolRun['status']
  raw: string
  evidence: Evidence[]
  verdict: Verdict
}

export interface TaskPlan {
  tool: 'filesystem' | 'terminal' | 'git' | 'browser'
  root?: string
  url?: string
  command?: string
  steps: Array<{ title: string; detail: string; expected: string }>
  question: string
}

export interface GoalOutcome {
  status: TaskPhase
  calls: AgentCall[]
  artifacts: string[]
  approval: { target: string; impact: string; tool: string; requestedAt: number } | null
  summary: string
  result: string
  steps: Array<{ id: string; title: string; detail: string; state: '完成' | '进行中' | '待执行' | '等待批准' | '已取消'; tone: 'blue' | 'green' | 'amber' | 'red' | 'gray' }>
}

export function extractRoot(goal: string): string | null {
  const match = /[A-Za-z]:[\\/][^\s"'，。]+/.exec(goal)
  return match ? match[0].replace(/[\\/]+$/, '') : null
}

export function chooseTool(goal: string): 'terminal' | 'git' | 'browser' | 'filesystem' {
  if (/https?:\/\//.test(goal) || /打开网页/.test(goal)) return 'browser'
  if (/\bgit\b|差异|提交记录/.test(goal)) return 'git'
  if (/运行命令|终端/.test(goal)) return 'terminal'
  return 'filesystem'
}

export function nextAfterCritic(verdict: Verdict, replanCount: number): 'continue' | 'stop' | 'partial' {
  if (verdict === 'confirmed') return 'continue'
  if (replanCount >= 3) return 'partial'
  return 'stop'
}

function verdictOf(run: ToolRun): Verdict {
  if (run.evidence.matched) return 'confirmed'
  if (run.status === 'timeout' || run.raw === '') return 'inconclusive'
  return 'refuted'
}

function call(agentRole: AgentCall['agentRole'], toolId: string, declared: string, run: ToolRun): AgentCall {
  return {
    agentRole,
    toolId,
    declared,
    executionStatus: run.status,
    raw: run.raw,
    evidence: [run.evidence],
    verdict: verdictOf(run)
  }
}

function plannerCall(plan: TaskPlan | null, tool: TaskPlan['tool'], root: string | null): AgentCall {
  if (plan) {
    const text = plan.steps.map((step, index) => `${index + 1}. ${step.title}：${step.detail}（预期：${step.expected}）`).join('\n')
    return call('Planner', 'model', text, {
      status: 'ok',
      raw: JSON.stringify(plan),
      evidence: { kind: 'schema-check', target: 'taskPlanSchema', expected: '模型返回的计划符合结构', actual: `${plan.steps.length} 步，结构校验通过`, matched: true }
    })
  }
  const text = tool === 'filesystem'
    ? '没有可用的模型，按规则处理：按扩展名把目录根上的文件移入「图片 / 文档 / 代码 / 其他」，不改子目录里已有的文件。'
    : `没有可用的模型，按规则选择了 ${tool}。`
  return call('Planner', 'rules', text, {
    status: 'ok',
    raw: text,
    evidence: { kind: 'exit-code', target: root ?? '未指定', expected: '按规则选出工具', actual: tool, matched: true }
  })
}

export async function executeGoal(input: {
  goal: string
  root: string | null
  approved: boolean
  cancelled: boolean
  now?: number
  plan?: TaskPlan | null
  control?: WorkControl
}): Promise<GoalOutcome> {
  const plan = input.plan ?? null
  const tool = plan?.tool ?? chooseTool(input.goal)
  const sensitive = tool !== 'git'
  const planner = plannerCall(plan, tool, input.root)
  const steps = [
    { id: 'plan', title: '规划步骤', detail: planner.declared, state: '完成' as const, tone: 'green' as const },
    { id: 'work', title: '执行并核验', detail: sensitive ? '写入、终端和对外访问需要单独批准' : '只读查看', state: '待执行' as const, tone: 'blue' as const }
  ]
  if (input.cancelled) {
    return {
      status: '已取消',
      calls: [{ ...planner, executionStatus: 'aborted', verdict: 'inconclusive' }],
      artifacts: [],
      approval: null,
      summary: '已停止安排后续操作',
      result: '任务已取消。已经产生的文件保持原样，没有回滚。',
      steps: steps.map((step) => ({ ...step, state: step.id === 'plan' ? '完成' : '已取消', tone: step.id === 'plan' ? 'green' : 'gray' }))
    }
  }
  if (!input.root && tool !== 'browser') {
    return {
      status: '待确认',
      calls: [planner],
      artifacts: [],
      approval: null,
      summary: '还缺少具体目录',
      result: '要处理哪个目录或文件？未确认具体对象前不会执行。',
      steps
    }
  }
  if (sensitive && !input.approved) {
    return {
      status: '等待批准',
      calls: [planner],
      artifacts: [],
      approval: {
        target: input.root ?? input.goal,
        impact: '可能写入文件、执行命令或访问网络。拒绝后不会发生这些操作。',
        tool,
        requestedAt: input.now ?? Date.now()
      },
      summary: '等待批准后才会执行敏感操作',
      result: '任务受阻：敏感操作尚未批准，没有执行。',
      steps: steps.map((step) => step.id === 'work' ? { ...step, state: '等待批准', tone: 'amber' } : step)
    }
  }
  const workerRun = await runWorker(tool, input.goal, input.root, plan, input.control)
  const worker = call('Worker', tool, `执行 ${tool}`, workerRun)
  if (workerRun.status === 'aborted') {
    return {
      status: '已取消',
      calls: [planner, { ...worker, verdict: 'inconclusive' }],
      artifacts: [],
      approval: null,
      summary: '已停止，没有再移动新文件',
      result: `任务已取消。${workerRun.raw}`,
      steps: [steps[0], { ...steps[1], state: '已取消', tone: 'gray', detail: workerRun.raw }]
    }
  }
  const critic = call('Critic', 'critic', `只核对证据：预期 ${worker.evidence[0]?.expected ?? ''}，实际 ${worker.evidence[0]?.actual ?? ''}`, {
    status: worker.verdict === 'confirmed' ? 'ok' : 'error',
    raw: worker.evidence.map((item) => `${item.expected} / ${item.actual}`).join('，'),
    evidence: worker.evidence[0]
  })
  const decision = nextAfterCritic(worker.verdict, worker.verdict === 'confirmed' ? 0 : 1)
  const status: TaskPhase = worker.verdict === 'confirmed'
    ? '已完成'
    : worker.verdict === 'inconclusive' || decision === 'partial'
      ? '部分完成'
      : '失败'
  return {
    status,
    calls: [planner, worker, critic],
    artifacts: workerRun.evidence.matched && workerRun.evidence.kind === 'fs-stat' ? [workerRun.evidence.target] : [],
    approval: null,
    summary: status === '已完成' ? '核验通过' : '核验未通过，后续依赖步骤已停止',
    result: status === '已完成' ? '步骤已核验。' : `模型声称已处理，核验发现 ${workerRun.evidence.actual}。`,
    steps: [
      steps[0],
      { ...steps[1], state: status === '已完成' ? '完成' : '待执行', tone: status === '已完成' ? 'green' : 'red', detail: worker.raw }
    ]
  }
}

async function runWorker(tool: GoalOutcome['calls'][number]['toolId'], goal: string, root: string | null, plan: TaskPlan | null, control?: WorkControl): Promise<ToolRun> {
  if (tool === 'browser') {
    const url = plan?.url && /^https?:\/\//i.test(plan.url) ? plan.url : /https?:\/\/\S+/.exec(goal)?.[0] ?? ''
    return readVisiblePage(url)
  }
  if (!root) {
    return { status: 'error', raw: '没有授权目录', evidence: { kind: 'fs-stat', target: '', expected: '存在', actual: '不存在', matched: false } }
  }
  if (tool === 'git') return runGit(root, ['status'])
  if (tool === 'terminal') {
    const parts = plan?.command?.trim().split(/\s+/).filter(Boolean)
    const command = /运行命令\s+(\S+)(?:\s+(.+))?/.exec(goal)
    const executable = parts?.[0] ?? command?.[1] ?? ''
    const args = parts ? parts.slice(1) : command?.[2]?.split(/\s+/).filter(Boolean) ?? []
    return runTerminal(root, executable, args)
  }
  try {
    readdirSync(root)
  } catch {
    return { status: 'error', raw: '授权目录不存在', evidence: { kind: 'fs-stat', target: root, expected: '存在', actual: '不存在', matched: false } }
  }
  try {
    const organized = await organizeByKind(root, control)
    const sample = organized.moved[0]
    const checked = sample
      ? verifyWritten(sample, true)
      : { kind: 'fs-stat' as const, target: root, expected: '有文件可归类', actual: organized.note, matched: false }
    if (organized.stopped) {
      const list = organized.moved.map((file) => `- ${file}`).join('\n')
      return { status: 'aborted', raw: `${organized.note}。${list ? `已移动：\n${list}` : '一个文件也没有移动。'}`, evidence: checked }
    }
    return {
      status: organized.moved.length && checked.matched ? 'ok' : 'error',
      raw: organized.note,
      evidence: checked
    }
  } catch (error) {
    return {
      status: 'error',
      raw: error instanceof Error ? error.message : '整理失败',
      evidence: { kind: 'fs-stat', target: root, expected: '文件已归类', actual: '没有移动', matched: false }
    }
  }
}

export function stopAfterFailure(results: ReadonlyArray<'ok' | 'error'>): number {
  const failed = results.indexOf('error')
  return failed === -1 ? results.length : failed + 1
}
