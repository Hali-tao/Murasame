import type { Evidence, ToolCallRecord, Verdict } from '../../shared/evidence'

export type TaskJudgement = '成功' | '失败' | '部分完成' | '已取消'

export function judgeCall(executionStatus: ToolCallRecord['execution']['status'], verdict: Verdict, raw: unknown): TaskJudgement {
  if (executionStatus === 'aborted') return '已取消'
  if (executionStatus !== 'ok') return '失败'
  if (raw == null || raw === '') return '失败'
  if (verdict === 'confirmed') return '成功'
  if (verdict === 'refuted') return '失败'
  return '部分完成'
}

export function summarizeCalls(calls: readonly Pick<ToolCallRecord, 'execution' | 'verification'>[]): TaskJudgement {
  const judgements = calls.map((call) => judgeCall(call.execution.status, call.verification.verdict, call.execution.raw))
  if (judgements.every((item) => item === '成功')) return '成功'
  if (judgements.some((item) => item === '已取消')) return '已取消'
  if (judgements.some((item) => item === '部分完成' || item === '成功') && judgements.some((item) => item !== '成功')) return '部分完成'
  return '失败'
}

export function divergenceText(declared: string, actual: string): string {
  return `模型声称 ${declared}，核验发现 ${actual}`
}

export function visibleTrace(record: { declared: string; actual: string; secret?: string }): { declared: string; actual: string; divergence: string } {
  const hide = (value: string) => value.replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-••••')
  return {
    declared: hide(record.declared),
    actual: hide(record.actual),
    divergence: divergenceText(hide(record.declared), hide(record.actual))
  }
}

export type { Evidence }
