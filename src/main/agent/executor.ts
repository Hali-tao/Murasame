import type { DeclaredOutput } from '../task/staging'
import type { GroundedSummaryWorkflow } from '../../shared/grounded-summary'
import { executeGroundedSummary, type GroundedExecutionOptions } from './grounded-executor'
import { extractTaskRoot } from './task-root'
import { randomUUID, createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import type { Evidence, Verdict } from '../../shared/evidence'
import type { TaskPhase } from './state-machine'
import { readVisiblePage } from '../tools/browser'
import { organizeByKind, moveInside, readInside, resolveInside, writeInside, type FileEffect, type FileIntent, type WorkControl } from '../tools/filesystem'
import { taskGraph, readOnlyStep } from '../task/plan-graph'
import { expectedDirectoryListing } from '../task/directory-observation'
import { runGit } from '../tools/git'
import { runTerminal, type IsolatedRunner, type ToolRun } from '../tools/terminal'
export type TaskTool = 'filesystem' | 'terminal' | 'git' | 'browser'
export interface CheckCondition { kind: 'file-exists' | 'file-absent' | 'file-content' | 'file-hash' | 'output-includes' | 'exit-code'; path?: string; value?: string }
export interface PlanStep { id?: string; dependsOn?: string[]; workspace?: string; network?: 'none' | 'bridge'; allowedTools?: TaskTool[]; limits?: { timeoutMs?: number }; outputs?: DeclaredOutput[]; title: string; detail: string; expected: string; tool?: TaskTool; args?: { action?: 'organize' | 'list' | 'read' | 'write' | 'move'; path?: string; from?: string; to?: string; content?: string; executable?: string; argv?: string[]; url?: string; files?: FileIntent[] }; checks?: CheckCondition[] }
export interface TaskPlan { origin?: 'rules' | 'model'; tool: TaskTool; root?: string; url?: string; command?: string; steps: PlanStep[]; question: string; workflow?: GroundedSummaryWorkflow }
export interface WorkerTicket { id: string; stepId: string; root: string | null; allowedTools: TaskTool[]; limits: { timeoutMs: number; maxSteps: number } }
export interface AgentCall { agentRole: 'Planner' | 'Worker' | 'Critic'; toolId: string; declared: string; executionStatus: ToolRun['status'] | 'running'; raw: string; evidence: Evidence[]; verdict: Verdict; stepId?: string; args?: unknown; startedAt?: string; endedAt?: string; traceId?: string; phase?: 'started' | 'result' }
export interface GoalOutcome { status: TaskPhase; calls: AgentCall[]; artifacts: string[]; approval: { target: string; impact: string; tool: string; requestedAt: number } | null; summary: string; result: string; steps: Array<{ id: string; title: string; detail: string; state: '完成' | '进行中' | '待执行' | '等待批准' | '已取消'; tone: 'blue' | 'green' | 'amber' | 'red' | 'gray' }> }
export function extractRoot(goal: string): string | null {
  return extractTaskRoot(goal)
}
export function chooseTool(goal: string): TaskTool { return /https?:\/\//.test(goal) || /打开网页/.test(goal) ? 'browser' : /\bgit\b|差异|提交记录/.test(goal) ? 'git' : /运行命令|终端/.test(goal) ? 'terminal' : 'filesystem' }
export function nextAfterCritic(verdict: Verdict, replanCount: number): 'continue' | 'stop' | 'partial' { return verdict === 'confirmed' ? 'continue' : replanCount >= 3 ? 'partial' : 'stop' }
function fact(target: string, expected: string, actual: string, matched: boolean, kind: Evidence['kind'] = 'fs-stat'): Evidence { return { target, expected, actual, matched, kind } }
export interface StepResult { invocation?: unknown; run: ToolRun; effects: FileEffect[]; artifacts: string[] }
export interface StepCheckpoint { stepId: string; planHash: string; stepHash: string; traceId: string; completed: boolean; outcomeKnown: boolean; output: StepResult; evidence: Evidence[] }
function errorRun(raw: string): ToolRun { return { status: 'error', raw, evidence: fact('执行器', '受支持的受控操作', raw, false, 'schema-check') } }
export function localRulePlan(goal: string): TaskPlan {
  const tool = chooseTool(goal)
  const supplement = goal.split('用户补充：').at(-1) ?? goal
  const effective = /整理|归类|归档|改为|改成|按/.test(supplement) ? supplement : goal
  const instruction = effective.replace(/["'][A-Za-z]:[\\/][^"']+["']/g, '').replace(/[A-Za-z]:[\\/]\S+/g, '')
  const supported = /整理|归类|归档|按类型|按扩展名/.test(instruction) && !/日期|时间|年份|月份|大小|首字母|去重|重命名|删除|清空/.test(instruction) && (!/按/.test(instruction) || /按(?:文件)?类型|按扩展名|按种类/.test(instruction))
  return { origin: 'rules', tool, steps: [{ title: `执行 ${tool}`, detail: goal, expected: '', ...(tool === 'filesystem' && supported ? { args: { action: 'organize' as const } } : {}) }], question: tool === 'filesystem' && !supported ? '当前没有模型可生成该操作；本地只支持明确的按类型整理。可补充具体规则或配置模型，尚未执行。' : '' }
}
function splitCommand(text: string): string[] {
  const tokens: string[] = []; let token = ''; let quote = ''; let active = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quote) {
      if (char === quote) quote = ''
      else if (char === '\\' && quote === '"' && (text[index + 1] === '"' || text[index + 1] === '\\')) token += text[++index]
      else token += char
      continue
    }
    if (char === '"' || char === "'") { quote = char; active = true }
    else if (/\s/.test(char)) { if (active) { tokens.push(token); token = ''; active = false } }
    else { token += char; active = true }
  }
  if (quote) throw new Error('命令引号没有闭合，未执行')
  if (active) tokens.push(token)
  return tokens
}
function invocationArgs(step: PlanStep, plan: TaskPlan, goal: string): NonNullable<PlanStep['args']> {
  const tool = step.tool ?? plan.tool
  const args = step.args ?? {}
  if (tool === 'terminal') {
    const parts = splitCommand(plan.command ?? /运行命令\s+(.+)/.exec(goal)?.[1] ?? '')
    return { ...args, executable: args.executable ?? parts[0] ?? '', argv: args.argv ?? parts.slice(1) }
  }
  if (tool === 'git') return { ...args, executable: 'git', argv: args.argv ?? ['status'] }
  if (tool === 'browser') return { ...args, url: args.url ?? plan.url ?? /https?:\/\/\S+/.exec(goal)?.[0] ?? '' }
  return args
}
export async function executeGoal(input: GroundedExecutionOptions & { goal: string; root: string | null; approved: boolean; cancelled: boolean; now?: number; plan?: TaskPlan | null; control?: WorkControl; runner?: IsolatedRunner; taskId?: string; toolGate?: (tool: string) => string | null; executionGuard?: () => string | null; onCall?: (call: AgentCall) => void; approvalScope?: 'once' | 'task'; checkpoints?: StepCheckpoint[]; onCheckpoint?: (checkpoint: StepCheckpoint) => void }): Promise<GoalOutcome> {
  if (input.plan?.workflow) return executeGroundedSummary({ ...input, plan: input.plan })
  const tool = input.plan?.tool ?? chooseTool(input.goal)
  const plan = input.plan ?? localRulePlan(input.goal)
  const planHash = createHash('sha256').update(JSON.stringify({ root: input.root, plan })).digest('hex')
  const calls: AgentCall[] = []; const artifacts: string[] = []
  const record = (item: AgentCall): void => { calls.push(item); input.onCall?.(item) }
  record({ agentRole: 'Planner', toolId: input.plan && plan.origin !== 'rules' ? 'model' : 'rules', declared: input.plan && plan.origin !== 'rules' ? JSON.stringify(plan) : `没有可用的模型，仅按明确支持的本地规则处理：${JSON.stringify(plan)}`, executionStatus: 'ok', raw: JSON.stringify(plan), evidence: [fact('taskPlanSchema', '受控计划结构', `${plan.steps.length} 步`, true, 'schema-check')], verdict: 'confirmed', stepId: 'plan' })
  const steps: GoalOutcome['steps'] = plan.steps.map((step, index) => ({ id: step.id ?? `step-${index}`, title: step.title, detail: step.detail, state: '待执行', tone: 'blue' }))
  const finish = (status: TaskPhase, result: string, approval: GoalOutcome['approval'] = null): GoalOutcome => ({ status, calls, artifacts: [...new Set(artifacts)], approval, summary: status === '已完成' ? '所有执行步骤与完成条件已核验' : result, result, steps })
  const stopped = (): boolean => input.cancelled || Boolean(input.control?.stopped()) || Boolean(input.control?.signal?.aborted)
  if (stopped()) return finish('已取消', '任务已取消，已产生的影响保留。')
  if (plan.question.trim() && plan.question.trim() !== '无') return finish('待确认', `${plan.question} 回答之前不会执行。`)
  if (!input.root && plan.steps.some((step) => (step.tool ?? tool) !== 'browser')) return finish('待确认', '要处理哪个具体目录？回答之前不会执行。')
  let graph: ReturnType<typeof taskGraph>
  try { graph = taskGraph(plan.steps); if (!graph.length || graph.length > 6) throw new Error('计划必须为 1 至 6 步') } catch (error) { return finish('失败', error instanceof Error ? error.message : String(error)) }
  const done = new Set<string>(); const attempted = new Set<string>(); let confirmed = 0; let failed = false; let dispatches = 0; let awaitingExport = false
  const matchesCheckpoint = (checkpoint: StepCheckpoint, node: (typeof graph)[number]): boolean => {
    const stepHash = createHash('sha256').update(JSON.stringify({ root: input.root, step: node.step })).digest('hex')
    return (checkpoint.stepHash ?? checkpoint.planHash) === (checkpoint.stepHash ? stepHash : planHash)
  }
  const follows = (id: string, ancestor: string): boolean => graph.find(node => node.id === id)!.dependsOn.some(dependency => dependency === ancestor || follows(dependency, ancestor))
  const completed = (input.checkpoints ?? []).filter(checkpoint => {
    const node = graph.find(entry => entry.id === checkpoint.stepId)
    return node && checkpoint.completed && checkpoint.outcomeKnown && checkpoint.output.run.status === 'ok' && matchesCheckpoint(checkpoint, node)
  })
  for (const checkpoint of input.checkpoints ?? []) {
    const node = graph.find((entry) => entry.id === checkpoint.stepId)
    if (!node) { artifacts.push(...checkpoint.output.artifacts); continue }
    artifacts.push(...checkpoint.output.artifacts)
    if (!checkpoint.outcomeKnown) return finish('失败', `步骤 ${node.id} 的实际副作用未知，需要先核对；没有重放。`)
    if (!matchesCheckpoint(checkpoint, node)) continue
    if (checkpoint.completed) {
      const ticket: WorkerTicket = { id: randomUUID(), stepId: node.id, root: input.root ? resolveInside(input.root, node.step.workspace ?? '.') : null, allowedTools: [node.step.tool ?? tool], limits: { timeoutMs: node.step.limits?.timeoutMs ?? 8000, maxSteps: 1 } }
      const directoryExpected = input.root && ticket.root && ticket.allowedTools[0] === 'filesystem' && node.step.args?.action === 'list'
        ? expectedDirectoryListing(input.root, resolveInside(ticket.root, node.step.args.path ?? '.'), checkpoint.output.run.raw, completed.filter(item => follows(item.stepId, node.id)).flatMap(item => item.output.effects)) : undefined
      const checked = await independentlyVerify(ticket, node.step, checkpoint.output, input, directoryExpected)
      const verified = checked.length > 0 && checked.every(item => item.matched)
      record({ agentRole: 'Critic', toolId: 'critic', declared: `恢复前独立核对 ${node.id}，不重复执行`, executionStatus: verified ? 'ok' : 'error', raw: JSON.stringify(checked), evidence: checked, verdict: verified ? 'confirmed' : 'refuted', stepId: node.id, traceId: ticket.id, phase: 'result', args: { restoredCheckpoint: checkpoint.traceId, readOnly: true } })
      if (!verified) return finish('失败', `步骤 ${node.id} 的已完成结果发生变化；未重新执行或覆盖。`)
      done.add(node.id); attempted.add(node.id); confirmed += 1; steps[node.index] = { ...steps[node.index], state: '完成', tone: 'green', detail: `${node.step.title}：恢复后独立复核通过，未重复执行` }
    }
  }
  const scopeKey = (node: (typeof graph)[number]): string => {
    const step = node.step; const stepTool = step.tool ?? tool
    let workspace = input.root ?? ''
    try { if (input.root) workspace = resolveInside(input.root, step.workspace ?? '.') } catch { workspace = `invalid:${step.workspace}` }
    return JSON.stringify({ tool: stepTool, workspace, network: step.network ?? 'none', ...(stepTool === 'browser' ? { url: invocationArgs(step, plan, input.goal).url } : {}) })
  }
  const pendingNodes = (): typeof graph => graph.filter(node => !done.has(node.id) && (!attempted.has(node.id) || Boolean(input.checkpoints?.find(checkpoint => checkpoint.stepId === node.id)?.output.run.awaitingExport)))
  const describeNode = (node: (typeof graph)[number]): Record<string, unknown> => ({ id: node.id, title: node.step.title, detail: node.step.detail, tool: node.step.tool ?? tool, scopeKey: scopeKey(node), workspace: node.step.workspace ?? '.', network: node.step.network ?? 'none', args: invocationArgs(node.step, plan, input.goal), outputs: node.step.outputs, staged: (input.checkpoints ?? []).find(checkpoint => checkpoint.stepId === node.id)?.output.run.awaitingExport, expected: node.step.expected, checks: node.step.checks })
  const requestApproval = (): GoalOutcome => {
    const remaining = pendingNodes()
    const next = remaining.filter(node => node.dependsOn.every(id => done.has(id)))
    try { remaining.forEach(node => invocationArgs(node.step, plan, input.goal)) } catch (error) { return finish('待确认', `${error instanceof Error ? error.message : '命令参数无法解析'}；请补充明确参数后重新规划。`) }
    next.forEach((node) => { steps[node.index] = { ...steps[node.index], state: '等待批准', tone: 'amber' } })
    return finish('等待批准', confirmed || dispatches ? '已尝试的调用与已完成成果保留，下一项操作需要新的批准。' : '任务受阻：操作尚未批准，没有执行。', { target: input.root ?? plan.url ?? input.goal, impact: JSON.stringify({ taskId: input.taskId, planHash, next: next.map(describeNode), remaining: remaining.map(describeNode), plan }), tool: next[0]?.step.tool ?? tool, requestedAt: input.now ?? Date.now() })
  }
  if (!input.approved) return requestApproval()
  // D-06: task approval is limited to the next operation's tool and concrete scope.
  const firstApproved = pendingNodes().find(node => node.dependsOn.every(id => done.has(id)))
  const approvedScope = firstApproved ? scopeKey(firstApproved) : null
  const runNode = async (node: (typeof graph)[number]): Promise<void> => {
    if (stopped()) return
    dispatches += 1; attempted.add(node.id)
    const step = node.step; const stepTool = step.tool ?? tool; const stepId = node.id
    let ticketRoot = input.root; let scopeError: string | null = null
    try { if (ticketRoot) ticketRoot = resolveInside(ticketRoot, step.workspace ?? '.') } catch (error) { scopeError = error instanceof Error ? error.message : String(error) }
    const ticket: WorkerTicket = { id: randomUUID(), stepId, root: ticketRoot, allowedTools: [stepTool], limits: { timeoutMs: Math.min(60000, Math.max(1, step.limits?.timeoutMs ?? 8000)), maxSteps: 1 } }
    Object.freeze(ticket.allowedTools); Object.freeze(ticket.limits); Object.freeze(ticket)
    const startedAt = new Date().toISOString(); const args = { ticket, operation: step.args }
    const gate = scopeError ?? (step.allowedTools && !step.allowedTools.includes(stepTool) ? '当前 Worker 任务单不允许此工具' : null) ?? input.executionGuard?.() ?? input.toolGate?.(stepTool)
    input.onCall?.({ agentRole: 'Worker', toolId: stepTool, declared: step.detail, executionStatus: 'running', raw: '操作开始；结果尚未知，不得重放', evidence: [], verdict: 'inconclusive', stepId, args, startedAt, traceId: ticket.id, phase: 'started' })
    let output: StepResult
    try { output = gate ? { run: errorRun(gate), effects: [], artifacts: [] } : await runStep(ticket, step, plan, input) } catch (error) { output = { run: errorRun(error instanceof Error ? error.message : String(error)), effects: [], artifacts: [] } }
    const verifierTicket: WorkerTicket = { ...ticket, id: randomUUID(), allowedTools: [...ticket.allowedTools] }
    const evidence = await independentlyVerify(verifierTicket, step, output, input)
    const all = output.run.status === 'ok' && evidence.length > 0 && evidence.every((item) => item.matched)
    const some = output.effects.some((effect) => evidence.some((item) => item.target === effect.destination && item.matched)) || (step.checks ?? []).filter((check) => check.kind !== 'exit-code').some((check) => evidence.some((item) => item.target === (check.path ?? ticket.stepId) && item.expected === (check.value ?? check.kind) && item.matched))
    if (all || some) confirmed += 1
    artifacts.push(...output.artifacts.filter((path) => { try { return statSync(resolveInside(input.root!, path)).isFile() } catch { return false } }))
    const outcomeKnown = output.run.outcomeKnown ?? (stepTool !== 'terminal' || output.run.status === 'ok' || /^\d+$/.test(output.run.evidence.actual))
    Object.assign(args, { outcomeKnown, operation: output.invocation ?? step.args })
    const worker: AgentCall = { agentRole: 'Worker', toolId: stepTool, declared: step.detail, executionStatus: output.run.status, raw: output.run.raw, evidence, verdict: all ? 'confirmed' : some ? 'inconclusive' : 'refuted', stepId, args, startedAt, endedAt: new Date().toISOString(), traceId: ticket.id, phase: 'result' }
    record(worker)
    record({ agentRole: 'Critic', toolId: 'critic', declared: `独立核对 ${stepId} 的全部产物和完成条件`, executionStatus: all ? 'ok' : 'error', raw: JSON.stringify(evidence), evidence, verdict: all ? 'confirmed' : 'refuted', stepId, args: { ticket: { ...verifierTicket, parentId: ticket.id, readOnly: true }, conditions: step.checks ?? step.expected }, startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), traceId: ticket.id, phase: 'result' })
    const checkpoint: StepCheckpoint = { stepId, planHash, stepHash: createHash('sha256').update(JSON.stringify({ root: input.root, step })).digest('hex'), traceId: ticket.id, completed: all, outcomeKnown, output, evidence }
    input.onCheckpoint?.(checkpoint)
    steps[node.index] = { ...steps[node.index], detail: `${step.title}：${output.run.raw}`, state: all ? '完成' : stopped() ? '已取消' : '待执行', tone: all ? 'green' : 'red' }
    if (output.run.awaitingExport && checkpoint.outcomeKnown && !stopped()) { awaitingExport = true; input.checkpoints = [...(input.checkpoints ?? []).filter((item) => item.stepId !== stepId), checkpoint] }
    else if (all) done.add(node.id); else failed = true
  }
  while (done.size < graph.length && !awaitingExport && !stopped()) {
    const ready = graph.filter((node) => !done.has(node.id) && !attempted.has(node.id) && node.dependsOn.every((id) => done.has(id)))
    if (!ready.length) break
    if (input.approvalScope === 'once' && dispatches > 0) return requestApproval()
    if (input.approvalScope === 'task' && scopeKey(ready[0]) !== approvedScope) return requestApproval()
    const parallel = input.approvalScope !== 'once' ? ready.filter((node) => (input.approvalScope !== 'task' || scopeKey(node) === approvedScope) && readOnlyStep(node.step, node.step.tool ?? tool)) : []
    await Promise.all((parallel.length ? parallel : [ready[0]]).map(runNode))
  }
  if (awaitingExport && !stopped()) return requestApproval()
  if (stopped()) return finish('已取消', `任务已取消。已产生的影响保留。${artifacts.length ? `已产生文件：${artifacts.join('，')}` : ''}${steps.map((step) => step.detail).join('；')}`)
  return finish(failed ? confirmed ? '部分完成' : '失败' : confirmed ? '已完成' : '失败', failed ? '核验未通过，后续依赖步骤已停止；已产生的影响与失败项可查看。' : '所有步骤已独立核验。')
}
async function runStep(ticket: WorkerTicket, step: PlanStep, plan: TaskPlan, input: Parameters<typeof executeGoal>[0]): Promise<StepResult> {
  const tool = ticket.allowedTools[0]; const args = invocationArgs(step, plan, input.goal); const root = ticket.root
  const wrap = (run: ToolRun, invocation: unknown = step.args): StepResult => ({ run, invocation, effects: run.effects ?? [], artifacts: run.artifacts ?? [] })
  const checkpoint = input.checkpoints?.find((item) => item.stepId === ticket.stepId)
  const staged = checkpoint?.output.run.awaitingExport
  const approvedExports = staged?.changes.map((change) => ({ path: change.path, kind: change.kind, overwrite: change.baselineHash !== null, baselineHash: change.baselineHash, expectedHash: change.hash ?? undefined }))
  const options = { network: step.network, outputs: staged ? approvedExports : step.outputs, resumeStageId: staged?.stageId, assertAllowed: (boundary?: 'execute' | 'export') => { const reason = input.executionGuard?.() ?? input.toolGate?.(tool) ?? (step.network === 'bridge' ? input.toolGate?.('browser') : null) ?? (boundary === 'export' ? input.toolGate?.('filesystem') : null); if (reason) throw new Error(reason); if (input.control?.signal?.aborted || input.control?.stopped()) throw new Error('任务已取消') }, runner: input.runner, signal: input.control?.signal, timeoutMs: ticket.limits.timeoutMs, ticketId: ticket.id, taskId: input.taskId }
  if (tool === 'browser') return wrap(await readVisiblePage(args?.url ?? plan.url ?? /https?:\/\/\S+/.exec(input.goal)?.[0] ?? '', fetch, options))
  if (!root) return wrap(errorRun('没有授权目录'))
  if (tool === 'terminal') {
    const executable = args.executable!; const argv = args.argv!
    return wrap(await runTerminal(root, executable, argv, options), { executable, argv, root, network: step.network ?? 'none', outputs: options.outputs, resumeStageId: options.resumeStageId })
  }
  if (tool === 'git') return wrap(await runGit(root, args?.argv ?? ['status'], options), { executable: 'git', argv: args?.argv ?? ['status'], root, readOnly: true })
  const legacyOrganize = input.plan?.steps.length === 1 && /按类型|按扩展名|归类/.test(step.title) && /整理|归类/.test(input.goal) && !/日期|按名|按大小|删除/.test(input.goal)
  const action = args?.action ?? (legacyOrganize ? 'organize' : undefined) ?? (!input.plan && /整理/.test(input.goal) && !/日期|按名|按大小|删除/.test(input.goal) ? 'organize' : undefined)
  if (action === 'organize') {
    const organized = await organizeByKind(root, { ...input.control, files: args?.files, stopped: () => Boolean(input.control?.stopped() || input.control?.signal?.aborted), guard: () => input.executionGuard?.() ?? input.toolGate?.('filesystem') ?? null, progress: (...args) => input.control?.progress(...args) })
    return { run: { status: organized.stopped ? 'aborted' : organized.error || organized.effects.some((e) => e.status === 'failed') || !organized.moved.length ? 'error' : 'ok', raw: organized.note, evidence: fact(root, '文件归类', organized.note, false) }, effects: organized.effects, artifacts: organized.effects.filter((e) => existsSync(e.destination)).map((e) => e.destination) }
  }
  if (action === 'list') { const names = readdirSync(resolveInside(root, args?.path ?? '.')); return wrap({ status: 'ok', raw: JSON.stringify(names), evidence: fact(root, '可读取目录', `${names.length} 项`, true) }) }
  if (action === 'read' && args?.path) { const raw = readInside(root, args.path); return wrap({ status: 'ok', raw, evidence: fact(args.path, '读取文件', raw, true) }) }
  if (action === 'write' && args?.path && args.content !== undefined) { const written = writeInside(root, args.path, args.content); return { run: { status: 'ok', raw: written.path, evidence: fact(written.path, '写入', '', false) }, effects: [{ source: '', destination: written.path, hash: written.hash, status: 'moved' }], artifacts: [written.path] } }
  if (action === 'move' && args?.from && args.to) { const hash = createHash('sha256').update(readFileSync(resolveInside(root, args.from))).digest('hex'); moveInside(root, args.from, args.to); const destination = resolveInside(root, args.to); return { run: { status: 'ok', raw: destination, evidence: fact(destination, '移动', '', false) }, effects: [{ source: resolveInside(root, args.from), destination, hash, status: 'moved' }], artifacts: [destination] } }
  return wrap(errorRun('计划没有可执行的受控操作；任意自然语言指令尚未执行。'))
}
async function independentlyVerify(ticket: WorkerTicket, step: PlanStep, output: StepResult, input: Parameters<typeof executeGoal>[0], directoryExpected?: string): Promise<Evidence[]> {
  const evidence: Evidence[] = []
  let observedRaw = output.run.raw
  if (output.run.status === 'ok' && ticket.allowedTools[0] === 'browser') {
    const blocked = input.toolGate?.('browser')
    const observed = blocked ? errorRun(blocked) : await readVisiblePage(step.args?.url ?? input.plan?.url ?? /https?:\/\/\S+/.exec(input.goal)?.[0] ?? '', fetch, { signal: input.control?.signal, timeoutMs: ticket.limits.timeoutMs })
    observedRaw = observed.raw; evidence.push(observed.evidence)
  }
  if (output.run.status === 'ok' && ticket.allowedTools[0] === 'filesystem' && !output.effects.length && ['list', 'read'].includes(step.args?.action ?? '')) {
    try {
      const names = step.args?.action === 'list' ? readdirSync(resolveInside(ticket.root!, step.args.path ?? '.')) : undefined
      observedRaw = names ? JSON.stringify(names) : readInside(ticket.root!, step.args?.path ?? '')
      const actual = names && directoryExpected !== undefined ? JSON.stringify([...names].sort()) : observedRaw
      const expected = directoryExpected ?? output.run.raw
      evidence.push(fact(ticket.root!, directoryExpected === undefined ? '独立只读观察与执行返回一致' : `原目录及本任务已核验新增项：${directoryExpected}`, actual, actual === expected))
    } catch (error) { evidence.push(fact(ticket.root!, '独立只读观察', error instanceof Error ? error.message : String(error), false)) }
  }
  for (const effect of output.effects) {
    if (effect.operation === 'delete') { let missing = false; try { missing = !existsSync(resolveInside(ticket.root!, effect.destination)) } catch { /* Boundary failures cannot confirm deletion. */ } evidence.push(fact(effect.destination, '已批准文件不存在', missing ? '不存在' : '仍存在或范围无效', effect.status === 'moved' && missing)); continue }
    let actual: string; let matched = false
    try { const destination = resolveInside(ticket.root!, effect.destination); const hash = createHash('sha256').update(readFileSync(destination)).digest('hex'); const sourceGone = !effect.source || !existsSync(resolveInside(ticket.root!, effect.source)); actual = `sha256=${hash};源${sourceGone ? '不存在' : '仍存在'}${effect.error ? `;${effect.error}` : ''}`; matched = effect.status === 'moved' && hash === effect.hash && sourceGone } catch (error) { actual = error instanceof Error ? error.message : String(error) }
    evidence.push(fact(effect.destination, `sha256=${effect.hash};源不存在`, actual, matched, 'fs-hash'))
  }
  for (const check of step.checks ?? []) {
    let actual: string; let matched = false
    try {
      if (check.kind === 'output-includes') { actual = observedRaw; matched = Boolean(check.value) && actual.includes(check.value!) }
      else if (check.kind === 'exit-code') { actual = output.run.evidence.actual; matched = actual === (check.value ?? '0') }
      else { const path = resolveInside(ticket.root!, check.path ?? ''); actual = check.kind === 'file-absent' ? String(!existsSync(path)) : check.kind === 'file-exists' ? String(statSync(path).isFile()) : check.kind === 'file-content' ? readFileSync(path, 'utf8') : createHash('sha256').update(readFileSync(path)).digest('hex'); matched = actual === (check.kind === 'file-exists' || check.kind === 'file-absent' ? 'true' : check.value) }
    } catch (error) { actual = error instanceof Error ? error.message : String(error) }
    evidence.push(fact(check.path ?? ticket.stepId, check.value ?? check.kind, actual, matched, check.kind === 'file-hash' ? 'fs-hash' : check.kind.startsWith('file-') ? 'fs-stat' : 'schema-check'))
  }
  if (step.expected === '根目录只剩分类文件夹') {
    const remaining = readdirSync(resolveInside(ticket.root!, '.'), { withFileTypes: true }); evidence.push(fact(ticket.root!, step.expected, remaining.map((entry) => entry.name).join('，'), remaining.length > 0 && remaining.every((entry) => entry.isDirectory())))
  }
  if (step.expected.trim() && step.expected !== '根目录只剩分类文件夹' && !step.checks?.length && !(output.effects.length && /归类|整理|移动|按类型/.test(step.expected))) evidence.push(fact(ticket.stepId, step.expected, '自然语言完成条件缺少可执行 checks，未核验', false, 'schema-check'))
  if (!evidence.length) {
    if (ticket.allowedTools[0] === 'filesystem' && step.args?.action === 'list') {
      try { const names = JSON.stringify(readdirSync(resolveInside(ticket.root!, step.args?.path ?? '.'))); evidence.push(fact(ticket.root!, '独立目录列表一致', names, names === output.run.raw)) } catch { evidence.push(fact(ticket.root!, '可读目录', '不存在', false)) }
    } else evidence.push(fact(ticket.stepId, '独立完成条件', '没有独立核验条件；退出码或 Worker 声明不足以确认目标', false, 'schema-check'))
  }
  return evidence
}
export function stopAfterFailure(results: ReadonlyArray<'ok' | 'error'>): number { const failed = results.indexOf('error'); return failed === -1 ? results.length : failed + 1 }
