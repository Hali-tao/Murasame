import { decodeFrame } from './frame-evidence'
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

export interface ActionExpectation { text?: string; url?: string }
export interface ActionFacts { text: string; url: string }

export function verifyAfterAction(before: string, after: string, expected?: ActionExpectation, facts?: ActionFacts): { verified: boolean; note: string } {
  const oldFrame = decodeFrame(before)
  const newFrame = decodeFrame(after)
  if (!newFrame || !oldFrame) return { verified: false, note: '画面不是完整的可解码 PNG，不能核验动作结果' }
  const evidence = Boolean(expected && facts && (expected.text || expected.url)
    && (!expected.text || facts.text.includes(expected.text))
    && (!expected.url || facts.url === expected.url))
  if (evidence) return { verified: true, note: '已按独立页面事实核验预期结果' }
  return { verified: false, note: oldFrame.digest === newFrame.digest ? '画面没有变化，预期结果尚未核实' : '画面发生变化，但不能证明预期动作成功；没有重复执行' }
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
