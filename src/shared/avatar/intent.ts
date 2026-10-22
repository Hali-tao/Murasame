import { canPerform, capabilityOf } from './capability'

export const PERFORMANCE_INTENTS = ['打招呼', '开心', '思考', '困惑', '抱歉', '否定', '惊讶', '安抚'] as const
export type PerformanceIntent = (typeof PERFORMANCE_INTENTS)[number]

const nearest: Record<PerformanceIntent, PerformanceIntent> = {
  打招呼: '开心',
  开心: '打招呼',
  思考: '困惑',
  困惑: '思考',
  抱歉: '安抚',
  否定: '困惑',
  惊讶: '开心',
  安抚: '抱歉'
}

const mapping: Record<string, Partial<Record<PerformanceIntent, { motion: string; expression: string | null }>>> = {
  tororo: {
    打招呼: { motion: 'Tap', expression: null },
    开心: { motion: 'FlickUp', expression: null },
    思考: { motion: 'Idle', expression: null },
    困惑: { motion: 'Flick', expression: null },
    抱歉: { motion: 'FlickDown', expression: null },
    否定: { motion: 'Flick', expression: null },
    惊讶: { motion: 'FlickUp', expression: null },
    安抚: { motion: 'Idle', expression: null }
  },
  'whale-girl': {
    打招呼: { motion: 'aidale', expression: '开心兴奋' },
    开心: { motion: 'selfie', expression: '爱心眼' },
    思考: { motion: 'idle', expression: '问号' },
    困惑: { motion: 'idle', expression: '问号' },
    抱歉: { motion: 'idle', expression: '悲伤' },
    否定: { motion: 'splash', expression: '生气' },
    惊讶: { motion: 'openLid', expression: '感叹号' },
    安抚: { motion: 'bubble', expression: '脸红' }
  },
  naiwa: {
    开心: { motion: 'Idle', expression: 'dan' },
    思考: { motion: 'Idle', expression: 'sikao' },
    安抚: { motion: 'Idle', expression: 'pengfu' },
    否定: { motion: 'Idle', expression: 'expression1' }
  }
}

export function resolveIntent(avatarId: string, intent: PerformanceIntent): { motion: string | null; expression: string | null; text: string; degraded: boolean } {
  const direct = mapping[avatarId]?.[intent]
  const fallback = mapping[avatarId]?.[nearest[intent]]
  const chosen = direct ?? fallback
  if (!chosen) return { motion: null, expression: null, text: '这个形象没有对应动作，已用文字回应。', degraded: true }
  const check = canPerform(avatarId, chosen.motion, chosen.expression)
  if (!check.motion && capabilityOf(avatarId).motions.length === 0) {
    return { motion: null, expression: null, text: '这个形象没有对应动作，已用文字回应。', degraded: true }
  }
  return {
    motion: check.motion ? chosen.motion : capabilityOf(avatarId).motions[0] ?? null,
    expression: check.expression ? chosen.expression : null,
    text: direct ? intent : `改用接近的表现：${nearest[intent]}`,
    degraded: !direct
  }
}
