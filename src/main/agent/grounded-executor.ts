import { randomUUID } from 'node:crypto'
import { closeSync, existsSync, fstatSync, lstatSync, openSync, readSync } from 'node:fs'
import { SUMMARY_LIMITS, type GroundedCheckpoint, type SourceSnapshot, type SourceManifest } from '../../shared/grounded-summary'
import type { AgentCall, GoalOutcome, TaskPlan } from './executor'
import type { TaskModelBinding } from '../core/services/task-service'
import { resolveInside, writeInside, type WorkControl } from '../tools/filesystem'
import { assertSummarySourcesUnchanged, groundedDraftSchema, groundedWorkflowSchema, inspectSummarySources, readSummarySources, summaryHash, summaryRelativePath, validateAndRenderSummary, type SummaryGenerator } from './grounded-summary'

export interface GroundedExecutionOptions {
  summaryGenerator?: SummaryGenerator
  summaryModel?: TaskModelBinding | null
  groundedCheckpoint?: GroundedCheckpoint
  onGroundedCheckpoint?: (checkpoint: GroundedCheckpoint) => void
  approvedGroundedImpact?: string
}
type Input = GroundedExecutionOptions & { plan: TaskPlan; root: string | null; approved: boolean; cancelled: boolean; control?: WorkControl; executionGuard?: () => string | null; toolGate?: (tool: string) => string | null; onCall?: (call: AgentCall) => void }
class SummaryStopped extends Error {}
function recipient(model: TaskModelBinding): Record<string, string> {
  let endpoint = ''
  try { const url = new URL(model.endpoint ?? ''); url.username = ''; url.password = ''; url.search = ''; url.hash = ''; endpoint = url.href } catch { /* no unvalidated endpoint in approval */ }
  return { id: model.id, name: model.name ?? model.id, provider: model.provider ?? '', model: model.model ?? '', endpoint }
}
function manifestOnly(sources: SourceSnapshot[]): SourceManifest[] {
  return sources.map(({ id, relativePath, bytes, mtimeMs, ctimeMs, dev, ino, sha256 }) => ({ id, relativePath, bytes, mtimeMs, ctimeMs, dev, ino, sha256 }))
}
/** Abort queued work immediately; the gateway will reject the abandoned dispatch when it dequeues. */
export function awaitSummaryWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => { signal.removeEventListener('abort', abort); reject(signal.reason ?? new Error('摘要已停止')) }
    signal.addEventListener('abort', abort, { once: true })
    promise.then(value => { signal.removeEventListener('abort', abort); if (signal.aborted) abort(); else resolve(value) }, error => { signal.removeEventListener('abort', abort); reject(error) })
    if (signal.aborted) abort()
  })
}
function verifyOutput(root: string, relativePath: string, draft: NonNullable<GroundedCheckpoint['draft']>): string {
  const path = resolveInside(root, relativePath)
  const fd = openSync(path, 'r')
  try {
    const stat = fstatSync(fd); const expected = Buffer.byteLength(draft.markdown, 'utf8')
    if (!stat.isFile() || stat.size !== expected) throw new Error('目标文件大小或类型与批准草稿不符，未覆盖或重写')
    const bytes = Buffer.alloc(expected + 1); let offset = 0
    while (offset < bytes.length) { const count = readSync(fd, bytes, offset, bytes.length - offset, offset); if (!count) break; offset += count }
    const after = fstatSync(fd)
    const current = lstatSync(resolveInside(root, relativePath))
    if (offset !== expected || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs || current.ino !== stat.ino || current.dev !== stat.dev || current.mtimeMs !== stat.mtimeMs || current.ctimeMs !== stat.ctimeMs || summaryHash(bytes.subarray(0, offset)) !== draft.sha256) throw new Error('目标文件与批准草稿哈希不符，需人工核对；未重写')
    return path
  } finally { closeSync(fd) }
}

export async function executeGroundedSummary(input: Input): Promise<GoalOutcome> {
  const calls: AgentCall[] = []; const artifacts: string[] = []
  const steps: GoalOutcome['steps'] = [
    { id: 'summary-source', title: '批准来源并生成摘要', detail: '仅在批准后读取并向指定模型发送来源', state: '待执行', tone: 'blue' },
    { id: 'summary-save', title: '审阅草稿并保存', detail: '再次批准准确草稿后，新建文件并独立核验', state: '待执行', tone: 'blue' }
  ]
  const record = (call: AgentCall): void => { calls.push(call); input.onCall?.(call) }
  const finish = (status: GoalOutcome['status'], result: string, approval: GoalOutcome['approval'] = null): GoalOutcome => ({ status, result, summary: result, calls, artifacts, approval, steps })
  const stopped = (): boolean => input.cancelled || Boolean(input.control?.stopped() || input.control?.signal?.aborted)
  const guard = (): void => {
    if (stopped()) throw new SummaryStopped('摘要任务已取消')
    const reason = input.executionGuard?.() || input.toolGate?.('filesystem')
    if (reason) throw new SummaryStopped(reason)
  }
  if (stopped()) return finish('已取消', '任务已取消，已产生的文件保留。')
  if (input.plan.question.trim() && input.plan.question.trim() !== '无') return finish('待确认', input.plan.question)
  if (!input.root) return finish('待确认', '请明确授权来源和目标所在目录。')
  if (!input.summaryModel) return finish('待确认', '摘要需要任务原来绑定的可用模型；请检查原配置或新建任务。')
  const root = input.root; const model = input.summaryModel
  let checkpoint: GroundedCheckpoint | undefined = input.groundedCheckpoint ? structuredClone(input.groundedCheckpoint) : undefined
  const persist = (): void => { if (checkpoint) input.onGroundedCheckpoint?.(structuredClone(checkpoint)) }
  try {
    if (input.plan.tool !== 'filesystem' || input.plan.steps.length || input.plan.command || input.plan.url) throw new Error('摘要计划含额外可执行步骤，已拒绝旁路')
    const workflow = groundedWorkflowSchema.parse(input.plan.workflow)
    workflow.sources = workflow.sources.map(path => summaryRelativePath(path))
    workflow.outputPath = summaryRelativePath(workflow.outputPath, true)
    if (workflow.sources.some(path => path.toLowerCase() === workflow.outputPath.toLowerCase())) throw new Error('摘要目标不能覆盖来源文件')
    const target = resolveInside(root, workflow.outputPath)
    const to = recipient(model)
    const workflowHash = summaryHash(JSON.stringify({ root: resolveInside(root, '.'), workflow, recipient: to }))
    if (checkpoint && checkpoint.workflowHash !== workflowHash) {
      if (!checkpoint.outcomeKnown) throw new Error('旧摘要写入结果尚未核对，不能改变任务后重放')
      checkpoint = undefined
    }
    const freshSourceCheckpoint = (): GroundedCheckpoint => ({ version: 1, stage: 'awaiting-source-approval', workflowHash, sourceManifest: inspectSummarySources(root, workflow.sources), modelSnapshotId: model.id, dispatchCount: 0, outcomeKnown: true })
    const approvalEnvelope = (): Record<string, unknown> => ({ workflowKind: workflow.kind, stage: checkpoint!.stage, workflowHash, sourceManifest: checkpoint!.sourceManifest, recipient: to, instruction: workflow.instruction, outputPath: workflow.outputPath, draftHash: checkpoint!.stage === 'awaiting-write-approval' ? checkpoint!.draft?.sha256 : undefined })
    const request = (note?: string): GoalOutcome => {
      persist()
      const sourceStage = checkpoint!.stage === 'awaiting-source-approval'
      const stageIndex = sourceStage ? 0 : 1
      if (!sourceStage) steps[0] = { ...steps[0], state: '完成', tone: 'green', detail: `已生成草稿并核对引用；实际模型请求 ${checkpoint!.dispatchCount} 次` }
      steps[stageIndex] = { ...steps[stageIndex], state: '等待批准', tone: 'amber' }
      const envelope = approvalEnvelope()
      const scopeKey = summaryHash(JSON.stringify(envelope))
      const next = [{ id: steps[stageIndex].id, title: steps[stageIndex].title, detail: sourceStage ? '批准后读取并把列明文件正文发送给指定模型；不保存文件' : '新建本次完整草稿，不覆盖已有文件', tool: 'filesystem', workspace: '.', network: sourceStage ? 'bridge' : 'none', scopeKey, args: sourceStage ? { action: 'read' } : { action: 'write', path: workflow.outputPath, content: checkpoint!.draft!.markdown }, expected: sourceStage ? '可核对真实引用的草稿' : '目标文件字节与批准草稿完全一致' }]
      const impact = JSON.stringify({ ...envelope, envelopeHash: scopeKey, limits: SUMMARY_LIMITS, next, remaining: next, ...(sourceStage ? {} : { draft: checkpoint!.draft }) })
      return finish('等待批准', note ?? (sourceStage ? '请批准读取与发送来源；模型将收到所列文件的正文，生成后还需审阅草稿才能保存。' : '草稿已生成，引用已核对。请审阅完整正文后批准保存；尚未创建文件。'), { target: sourceStage ? root : target, impact, tool: 'filesystem', requestedAt: Date.now() })
    }
    const assertApproval = (): void => {
      guard()
      let approved: { envelopeHash?: string } = {}
      try { approved = JSON.parse(input.approvedGroundedImpact ?? '{}') } catch { /* fails closed */ }
      if (approved.envelopeHash !== summaryHash(JSON.stringify(approvalEnvelope()))) throw new SummaryStopped('摘要阶段或准确范围已变化，需重新批准')
    }
    const recordVerified = (path: string): GoalOutcome => {
      artifacts.push(path); checkpoint!.stage = 'verified'; checkpoint!.outcomeKnown = true; persist()
      steps.forEach(step => { step.state = '完成'; step.tone = 'green' })
      record({ agentRole: 'Critic', toolId: 'filesystem', declared: '独立读取目标并核对已批准字节', executionStatus: 'ok', raw: `${path}；SHA-256 ${checkpoint!.draft!.sha256}`, evidence: [{ kind: 'fs-hash', target: path, expected: checkpoint!.draft!.sha256, actual: checkpoint!.draft!.sha256, matched: true }], verdict: 'confirmed', traceId: checkpoint!.traceId ?? randomUUID(), stepId: 'summary-save', args: { outcomeKnown: true } })
      return finish(stopped() ? '已取消' : '已完成', `${stopped() ? '取消前已保存' : '已保存并核验'}：${path}。引用和保存字节已核对；摘要语义仍以审阅为准。`)
    }
    if (checkpoint?.stage === 'writing' || checkpoint?.stage === 'verified') {
      if (!checkpoint.draft || summaryHash(checkpoint.draft.markdown) !== checkpoint.draft.sha256) throw new Error('已批准草稿无法核对，未重放')
      if (existsSync(target)) return recordVerified(verifyOutput(root, workflow.outputPath, checkpoint.draft))
      if (checkpoint.stage === 'verified') throw new Error('已完成摘要文件不存在，未自动重写')
      checkpoint.stage = 'awaiting-write-approval'; checkpoint.outcomeKnown = true; persist()
      assertSummarySourcesUnchanged(root, checkpoint.sourceManifest)
      return request('上次写入中断，当前未发现目标文件。请重新批准原草稿，未自动重写。')
    }
    if (existsSync(target)) throw new Error('摘要目标已经存在，未覆盖；请补充新的输出文件名')
    if (!checkpoint || checkpoint.stage === 'generating') { checkpoint = freshSourceCheckpoint(); return request() }
    if (checkpoint.stage === 'awaiting-write-approval') {
      if (!checkpoint.draft || summaryHash(checkpoint.draft.markdown) !== checkpoint.draft.sha256) throw new Error('草稿校验失败，未写入')
      try { assertSummarySourcesUnchanged(root, checkpoint.sourceManifest) } catch { checkpoint = freshSourceCheckpoint(); return request('来源已经变化，旧草稿不能保存。请重新批准来源，尚未再次向模型发送。') }
      if (!input.approved) return request()
      assertApproval()
      steps[0] = { ...steps[0], state: '完成', tone: 'green' }
      const traceId = randomUUID(); checkpoint.traceId = traceId; checkpoint.stage = 'writing'; checkpoint.outcomeKnown = false; persist()
      record({ agentRole: 'Worker', toolId: 'filesystem', declared: '保存已批准的准确摘要', executionStatus: 'running', raw: '写入结果尚待核验', evidence: [], verdict: 'inconclusive', stepId: 'summary-save', traceId, phase: 'started', args: { target, draftHash: checkpoint.draft.sha256, outcomeKnown: false } })
      try {
        guard(); assertSummarySourcesUnchanged(root, checkpoint.sourceManifest)
        writeInside(root, workflow.outputPath, checkpoint.draft.markdown)
        artifacts.push(target)
        const path = verifyOutput(root, workflow.outputPath, checkpoint.draft)
        record({ agentRole: 'Worker', toolId: 'filesystem', declared: '已独占新建摘要文件', executionStatus: 'ok', raw: path, evidence: [], verdict: 'confirmed', stepId: 'summary-save', traceId, phase: 'result', args: { outcomeKnown: true } })
        return recordVerified(path)
      } catch (error) {
        checkpoint.outcomeKnown = !existsSync(target)
        if (checkpoint.outcomeKnown) checkpoint.stage = 'awaiting-write-approval'
        persist()
        record({ agentRole: 'Worker', toolId: 'filesystem', declared: '保存摘要未通过核验', executionStatus: stopped() ? 'aborted' : 'error', raw: error instanceof Error ? error.message : '保存失败', evidence: [], verdict: 'refuted', stepId: 'summary-save', traceId, phase: 'result', args: { outcomeKnown: checkpoint.outcomeKnown } })
        throw error
      }
    }
    if (!input.approved) { checkpoint = freshSourceCheckpoint(); return request() }
    assertApproval()
    try { assertSummarySourcesUnchanged(root, checkpoint.sourceManifest) } catch { checkpoint = freshSourceCheckpoint(); return request('批准后来源发生变化，请重新核对来源范围；尚未发送正文。') }
    if (!input.summaryGenerator) throw new Error('摘要模型服务不可用，没有发送正文')
    const controller = new AbortController()
    const cancel = (): void => controller.abort(new SummaryStopped('摘要任务已取消'))
    input.control?.signal?.addEventListener('abort', cancel, { once: true })
    const started = Date.now(); const traceId = randomUUID()
    const timer = setTimeout(() => controller.abort(new SummaryStopped('摘要超过 120 秒总预算，已停止本轮请求')), SUMMARY_LIMITS.runMs)
    let snapshots: SourceSnapshot[] = []
    try {
      guard()
      snapshots = await readSummarySources(root, workflow.sources, controller.signal, checkpoint.sourceManifest)
      checkpoint = { ...checkpoint, stage: 'generating', sourceManifest: manifestOnly(snapshots), dispatchCount: 0, traceId, outcomeKnown: true }; persist()
      const check = (): void => {
        try {
          controller.signal.throwIfAborted(); guard()
          if (Date.now() - started >= SUMMARY_LIMITS.runMs) throw new SummaryStopped('摘要超过 120 秒总预算')
          if (checkpoint?.stage !== 'generating' || checkpoint.workflowHash !== workflowHash) throw new SummaryStopped('摘要阶段已变化')
          assertSummarySourcesUnchanged(root, checkpoint.sourceManifest)
        } catch (error) { controller.abort(error); throw error }
      }
      const beforeSend = (): void => { check(); if (checkpoint!.dispatchCount >= SUMMARY_LIMITS.dispatches) { const error = new SummaryStopped('摘要最多允许 3 次模型请求'); controller.abort(error); throw error } }
      record({ agentRole: 'Worker', toolId: 'model.summary', declared: '已读取批准的来源，等待模型生成摘要', executionStatus: 'running', raw: '正文仅用于本轮模型请求，不写入调用日志', evidence: [], verdict: 'inconclusive', stepId: 'summary-source', traceId, phase: 'started', args: { sources: checkpoint.sourceManifest, model: to, outcomeKnown: true } })
      input.control?.progress(0, 2, '等待摘要模型；可以继续聊天或取消')
      const response = await awaitSummaryWithAbort(input.summaryGenerator({ instruction: workflow.instruction, sources: snapshots }, model, { signal: controller.signal, beforeSend, onDispatch: waitMs => { beforeSend(); checkpoint!.dispatchCount++; persist(); input.control?.progress(0, 2, `正在生成摘要，第 ${checkpoint!.dispatchCount} 次请求（排队 ${waitMs} 毫秒）`) } }).catch(() => {
        if (controller.signal.aborted) throw controller.signal.reason
        throw new SummaryStopped('摘要模型未返回可核验草稿；请检查模型服务后重试，没有创建文件')
      }), controller.signal)
      check()
      if (!checkpoint.dispatchCount) throw new SummaryStopped('摘要缺少实际模型派发回执，未接受草稿')
      const value = groundedDraftSchema.parse(response)
      const rendered = validateAndRenderSummary(value, snapshots)
      checkpoint.stage = 'awaiting-write-approval'; checkpoint.draft = { ...rendered, citations: value.sections }; persist()
      record({ agentRole: 'Worker', toolId: 'model.summary', declared: '根据真实来源生成摘要草稿', executionStatus: 'ok', raw: `草稿 ${[...rendered.markdown].length} 字符；实际请求 ${checkpoint.dispatchCount} 次；耗时 ${Date.now() - started} 毫秒`, evidence: [], verdict: 'confirmed', stepId: 'summary-source', traceId, phase: 'result', args: { draftHash: rendered.sha256, outcomeKnown: true } })
      record({ agentRole: 'Critic', toolId: 'summary.citations', declared: '核对来源引用，不声称完成语义事实认证', executionStatus: 'ok', raw: '所有引用均属于本次来源及指定行区间', evidence: [{ kind: 'schema-check', target: 'summary.citations', expected: '引用原文出现在指定来源行内', actual: '引用逐项匹配', matched: true }], verdict: 'confirmed', traceId, stepId: 'summary-source', args: { outcomeKnown: true } })
      return request()
    } catch (error) {
      // Provider errors may echo source contents; only local controlled diagnostics reach persistent logs.
      const local = error instanceof SummaryStopped || /^(摘要引用|摘要结构|引用片段|摘要超过|来源|批准后来源)/.test(error instanceof Error ? error.message : '')
      const message = local && error instanceof Error ? error.message : '摘要模型未返回可核验草稿；请检查模型服务后重试，没有创建文件'
      record({ agentRole: 'Worker', toolId: 'model.summary', declared: '摘要生成已停止', executionStatus: stopped() ? 'aborted' : 'error', raw: message, evidence: [], verdict: 'refuted', stepId: 'summary-source', traceId, phase: 'result', args: { outcomeKnown: true, dispatchCount: checkpoint.dispatchCount } })
      return finish(stopped() ? '已取消' : '失败', message)
    } finally { clearTimeout(timer); input.control?.signal?.removeEventListener('abort', cancel); controller.abort(new SummaryStopped('本轮摘要已结束')); snapshots = [] }
  } catch (error) {
    return finish(stopped() ? '已取消' : '失败', error instanceof Error ? error.message : '摘要任务失败，未自动重放')
  }
}
