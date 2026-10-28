import { readForegroundAsync } from '../local/uia'
import { proactiveDecision } from './services/proactive-service'
import type { RelationshipStage } from './services/relationship-service'

interface ForegroundActivity { title: string; idleMs: number; fullscreen: boolean }
export interface LoopDeps {
  hidden: () => boolean
  doNotDisturb: () => boolean
  taskRunning: () => boolean
  pace: () => 'low' | 'mid' | 'high'
  stage: () => RelationshipStage
  reasons: () => string[]
  say: (text: string) => void
  foreground?: (signal: AbortSignal) => Promise<ForegroundActivity>
}
const HOUR = 60 * 60 * 1000

export class ProactiveLoop {
  private timer: NodeJS.Timeout | null = null
  private pending: AbortController | null = null
  private epoch = 0
  private lastSpokeAt = 0
  private spokenThisHour = 0
  private spokenToday = 0
  private hourStartedAt = Date.now()
  private dayStartedAt = Date.now()
  constructor(private readonly deps: LoopDeps) {}

  start(intervalMs = 5 * 60 * 1000): void {
    if (this.timer) return
    this.timer = setInterval(() => { void this.tick() }, intervalMs)
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.epoch++
    this.pending?.abort()
  }

  async tick(now = Date.now()): Promise<{ spoke: boolean; reason: string }> {
    if (this.pending) return { spoke: false, reason: '上一次前台检查还未结束' }
    if (this.deps.hidden() || this.deps.doNotDisturb() || this.deps.taskRunning() || !this.deps.reasons().length) return { spoke: false, reason: '当前不适合主动开口，或没有值得分享的新内容' }
    const controller = new AbortController(); const epoch = this.epoch
    this.pending = controller
    try {
      if (now - this.hourStartedAt >= HOUR) { this.hourStartedAt = now; this.spokenThisHour = 0 }
      if (now - this.dayStartedAt >= 24 * HOUR) { this.dayStartedAt = now; this.spokenToday = 0 }
      const front = await (this.deps.foreground ? this.deps.foreground(controller.signal) : this.readActivity(controller.signal))
      if (controller.signal.aborted || epoch !== this.epoch) return { spoke: false, reason: '前台检查已取消' }
      const reasons = this.deps.reasons()
      const decision = proactiveDecision({
        ...front, typedWithinMs: front.idleMs,
        hidden: this.deps.hidden(), doNotDisturb: this.deps.doNotDisturb(), taskRunning: this.deps.taskRunning(),
        minutesSinceLast: this.lastSpokeAt === 0 ? 10_000 : Math.floor((now - this.lastSpokeAt) / 60_000),
        spokenThisHour: this.spokenThisHour, spokenToday: this.spokenToday, pace: this.deps.pace(), reasons, stage: this.deps.stage()
      })
      if (!decision.speak) return { spoke: false, reason: decision.reason }
      this.lastSpokeAt = now; this.spokenThisHour++; this.spokenToday++
      this.deps.say(reasons[0] ?? decision.reason)
      return { spoke: true, reason: reasons[0] ?? decision.reason }
    } catch { return { spoke: false, reason: '读不到可靠的前台或输入空闲状态，这次不开口' } }
    finally { if (this.pending === controller) this.pending = null }
  }

  private async readActivity(signal: AbortSignal): Promise<ForegroundActivity> {
    const facts = await readForegroundAsync(undefined, signal)
    if (facts.idleMs === undefined || !Number.isFinite(facts.idleMs) || facts.fullscreen === undefined) throw new Error('前台状态不完整')
    return { title: facts.title, idleMs: Math.max(0, facts.idleMs), fullscreen: facts.fullscreen }
  }
}
