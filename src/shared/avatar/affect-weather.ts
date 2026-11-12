import type { PadState } from './pad'

export type AffectWeatherTone = 'bright' | 'steady' | 'low' | 'tense'

export interface AffectWeather {
  key: AffectWeatherTone
  /** 定性天气词，不暴露任何数值。 */
  label: string
  /** 一句状态描述，只描述感受，不推断具体原因。 */
  sentence: string
  /** 设计边界：不索取安慰、不影响任务结果、重启回基线。 */
  caption: string
}

/**
 * 把 PAD 情绪状态映射成定性的「情绪天气」。
 * 约束（docs/39 F-03）：不显示数值、不猜原因、不向用户索取安慰。
 */
export function affectWeather(pad: PadState): AffectWeather {
  const { pleasure, arousal } = pad
  if (pleasure >= 0.25 || (pleasure >= 0.1 && arousal >= 0.35)) {
    return {
      key: 'bright',
      label: '晴',
      sentence: '现在的心情亮一点，愿意多说两句。',
      caption: '心情只影响语气和动作，不影响任务结果。'
    }
  }
  if (pleasure <= -0.25) {
    return {
      key: 'low',
      label: '小雨',
      sentence: '有点低落，会安静一些。',
      caption: '它不会用情绪向你提要求，也不需要你哄。'
    }
  }
  if (arousal >= 0.5) {
    return {
      key: 'tense',
      label: '起风',
      sentence: '有点紧张，动作会快一点。',
      caption: '紧张会随安静相处的时间自然回落。'
    }
  }
  return {
    key: 'steady',
    label: '多云转晴',
    sentence: '平平常常，在桌边待着。',
    caption: '重启后会回到平静基线，长期关系与记忆不受影响。'
  }
}
