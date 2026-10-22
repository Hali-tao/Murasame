import { markUntrusted } from '../security/hardening'
import { chooseLocator, type MarkedElement } from '../local/set-of-mark'

export interface ActivityStep {
  locator: { kind: 'control' | 'mark' | 'pixel'; target: string }
  observation: string
  verified: boolean
  hostExecution: false
}

export function planActivityStep(input: {
  controlId: string | null
  marks: readonly MarkedElement[]
  pixel: { x: number; y: number } | null
  text: string
  sourceWidth: number
  targetWidth: number
  sourceHeight: number
  targetHeight: number
  approved: boolean
  needsPermission: boolean
}): ActivityStep | { blocked: string; hostExecution: false } {
  if (input.needsPermission && !input.approved) {
    return { blocked: '批准前不会越出已允许的范围', hostExecution: false }
  }
  return {
    locator: chooseLocator(input),
    observation: markUntrusted(input.text, 'web'),
    verified: false,
    hostExecution: false
  }
}

export function verifyAfterAction(before: string, after: string): { verified: boolean; note: string } {
  if (!after.trim()) return { verified: false, note: '动作后没有新的画面，不能把自述当成完成' }
  return { verified: before !== after, note: before === after ? '画面没有变化' : '已用新画面核验' }
}

export function activityLimitReason(steps: number, elapsedMs: number, limits = ACTIVITY_LIMITS): string | null {
  if (steps > limits.steps) return `已到 ${limits.steps} 步上限，活动停止，没有记成完成。`
  if (elapsedMs >= limits.minutes * 60_000) return `已到 ${limits.minutes} 分钟上限，活动停止，没有记成完成。`
  return null
}

export function understandVideo(frames: readonly string[], captions: readonly string[]): string {
  const unique: string[] = []
  for (const frame of frames) {
    if (unique.at(-1) !== frame) unique.push(frame)
  }
  const sampled = unique.filter((_, index) => index % 30 === 0)
  const lines = [
    captions.length ? captions.join('\n') : '没有字幕，只根据抽样画面。',
    ...sampled.map((frame) => `关键帧 ${frame}`)
  ]
  return markUntrusted(lines.join('\n'), 'video')
}

export const ACTIVITY_LIMITS = { steps: 12, minutes: 10, costYuan: 1 }
