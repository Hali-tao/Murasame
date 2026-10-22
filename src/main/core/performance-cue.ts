import { PERFORMANCE_INTENTS, resolveIntent, type PerformanceIntent } from '../../shared/avatar/intent'
import type { PadState } from '../../shared/avatar/pad'

export interface PerformanceCue {
  intent: PerformanceIntent
  motion: string | null
  expression: string | null
  degraded: boolean
  pad: PadState
}

/** 意图来自结构化输出。解析失败时调用方传入「思考」，这里不再扫描正文。 */
export function performanceCue(avatarId: string, intent: PerformanceIntent, pad: PadState): PerformanceCue {
  const resolved = resolveIntent(avatarId, intent)
  return {
    intent,
    motion: resolved.motion,
    expression: resolved.expression,
    degraded: resolved.degraded,
    pad
  }
}

export { PERFORMANCE_INTENTS }
