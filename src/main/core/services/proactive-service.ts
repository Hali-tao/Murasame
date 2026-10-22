import { foregroundHint, type ForegroundHint } from '../../local/foreground'
import type { RelationshipStage } from './relationship-service'

export interface ProactiveInput extends ForegroundHint {
  hidden: boolean
  doNotDisturb: boolean
  taskRunning: boolean
  minutesSinceLast: number
  spokenThisHour: number
  spokenToday: number
  pace: 'low' | 'mid' | 'high'
  reasons: string[]
  stage: RelationshipStage
}

const paceFloor = { low: 40, mid: 20, high: 10 }

export function proactiveDecision(input: ProactiveInput): { speak: boolean; reason: string } {
  if (input.hidden) return { speak: false, reason: '桌宠已隐藏，不主动开口' }
  if (input.doNotDisturb) return { speak: false, reason: '勿扰模式中' }
  if (input.taskRunning) return { speak: false, reason: '任务还在执行' }
  const front = foregroundHint(input)
  if (front.busy) return { speak: false, reason: front.reason }
  if (input.minutesSinceLast < paceFloor[input.pace]) return { speak: false, reason: '还没到主动开口的间隔' }
  if (input.spokenThisHour >= 2 || input.spokenToday >= 12) return { speak: false, reason: '已到频率上限' }
  if (input.reasons.length === 0) return { speak: false, reason: '没有值得开口的理由' }
  return { speak: true, reason: input.reasons[0] }
}

export class ProactiveService {
  decide(input: ProactiveInput): { speak: boolean; reason: string } {
    return proactiveDecision(input)
  }
}
