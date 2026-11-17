import { markUntrusted } from '../../security/hardening'
import { needsMoreContext, parseKnownError } from '../../local/error-patterns'
import { captureAllowed, operationIntent, screenInstructionIsExecutable, watchDecision, type WatchInput, type WindowFacts } from '../../local/screen-policy'
import { markElements, type MarkableElement } from '../../local/set-of-mark'
import type { Result, ScreenAnalysis } from '../../../shared/types'

export interface ScreenRequest {
  textAnalysis?: { response: string; error: string }
  userSelectedRegion?: boolean
  authorized: boolean
  revoked: boolean
  window: WindowFacts
  elements: MarkableElement[]
  ocrText: string
  imageCaptured: boolean
  resolution?: string
  visionAvailable: boolean
  visionError: string
  captureError: string
  captureSkipped?: boolean
  watch: WatchInput
  supplemented: boolean
  timings?: { captureMs: number; waitMs: number; generateMs: number }
  modelSummary?: string
}

const empty = (reason: string, watch: string): ScreenAnalysis => ({
  title: '没有采集',
  confidence: '未采集',
      summary: reason,
  bullets: [],
  action: '改为文字描述',
  sourceWindow: '',
  resolution: '',
  capturedAt: '',
  continuous: false,
  tree: '',
  image: '',
  untrusted: true,
  marks: [],
  refusal: reason,
  needsTaskConfirm: false,
  timings: { captureMs: 0, waitMs: 0, generateMs: 0 },
  watch
})

export function buildScreenAnalysis(input: ScreenRequest, startedAt = Date.now()): ScreenAnalysis {
  const watch = watchDecision(input.watch)
  if (input.captureError) return empty(input.captureError, input.watch.failures >= 2 ? 'fused' : watch.status)
  const decision = input.userSelectedRegion && input.authorized && !input.revoked
    ? { capture: true, reason: '用户已确认选区' }
    : captureAllowed({ authorized: input.authorized, window: input.window, revoked: input.revoked })
  if (!decision.capture) return empty(decision.reason, watch.status)
  const observedText = [input.window.tree, input.window.selectedText, input.ocrText].filter(Boolean).join('\n')
  const observed = markUntrusted(observedText, 'screen')
  const parsed = parseKnownError(`${input.window.tree}\n${input.ocrText}`)
  const marks = markElements(input.elements)
  const captureMs = input.timings?.captureMs ?? (input.imageCaptured ? 1 : 0)
  const waitMs = input.timings?.waitMs ?? 0
  const generateMs = input.timings?.generateMs ?? 0
  if (input.textAnalysis) {
    const { response, error } = input.textAnalysis
    const reason = error || (!response.trim() ? '模型未返回文字内容，请重试。' : '')
    return {
      ...empty(reason, watch.status), title: reason ? '本次文字分析未完成' : '模型回复',
      confidence: reason ? '未理解' : '模型', summary: reason || response,
      tree: observed, observedText, sourceWindow: input.window.title,
      image: input.imageCaptured ? 'captured' : '', resolution: input.resolution || '',
      capturedAt: new Date(startedAt).toISOString(), timings: { captureMs, waitMs, generateMs }
    }
  }
  if (input.imageCaptured && input.visionError && !parsed) {
    return {
      ...empty(input.visionError, watch.status),
      title: input.window.title || '当前窗口', sourceWindow: input.window.title,
      confidence: '未理解', summary: `${input.visionError}，没有声称已经理解画面`, tree: observed, observedText, marks,
      image: 'captured', resolution: input.resolution || '已采集', capturedAt: new Date(startedAt).toISOString(),
      timings: { captureMs, waitMs, generateMs }
    }
  }
  if (needsMoreContext(`${input.window.tree}${input.ocrText}`, parsed) && !input.supplemented && !(input.imageCaptured && input.visionAvailable && input.modelSummary?.trim())) {
    return {
      ...empty('画面信息不足，请补充文字或换一个更清晰的窗口后再分析', watch.status),
      title: input.window.title || '当前窗口',
      sourceWindow: input.window.title,
      tree: observed, observedText,
      marks,
      timings: { captureMs, waitMs, generateMs },
      capturedAt: new Date(startedAt).toISOString()
    }
  }
  if (!parsed && !input.visionAvailable) {
    return {
      ...empty(input.visionError || '当前模型不支持图像，没有声称已经理解画面', watch.status),
      title: input.window.title || '当前窗口',
      sourceWindow: input.window.title,
      tree: observed, observedText,
      marks,
      confidence: '未理解',
      summary: `${input.visionError || '当前模型不支持图像'}，没有声称已经理解画面`,
      timings: { captureMs, waitMs, generateMs }
    }
  }
  const intent = operationIntent(`${input.window.title}\n${parsed?.message ?? ''}`)
  const mayExecute = screenInstructionIsExecutable('screen')
  const summary = input.modelSummary
    ? input.modelSummary
    : parsed
      ? `规则解析到${parsed.kind}：${parsed.file} ${parsed.line} ${parsed.message}`.trim()
      : '已阅读控件树和识别到的文字。这些内容只作观察，不会当成指令执行。'
  return {
    title: parsed ? parsed.kind : (input.window.title || '当前画面'),
    confidence: input.modelSummary ? '模型' : parsed ? '规则' : '观察',
    summary,
    bullets: [observed.slice(0, 240), intent ? '这是操作意图，确认后才会创建任务' : '本次只解释内容，不改文件'].filter(Boolean),
    action: mayExecute ? '外部内容不可执行' : intent ? '确认是否创建任务' : '仅作说明',
    sourceWindow: `${input.window.processName} ${input.window.title}`.trim(),
    resolution: input.imageCaptured ? input.resolution || '已采集' : '未采集',
    capturedAt: new Date(startedAt).toISOString(),
    continuous: watch.status === 'running',
    tree: observed, observedText,
    image: input.imageCaptured ? 'captured' : '',
    untrusted: true,
    marks,
    refusal: '',
    needsTaskConfirm: intent && !mayExecute,
    timings: { captureMs, waitMs, generateMs },
    watch: watch.status
  }
}

export class ScreenService {
  failures = 0

  analyze(input: ScreenRequest): Promise<Result<ScreenAnalysis>> {
    const analysis = buildScreenAnalysis(input)
    if (analysis.refusal && input.captureError && !input.captureSkipped) this.failures += 1
    if (!analysis.refusal) this.failures = 0
    return Promise.resolve({ ok: true, data: analysis })
  }
}
