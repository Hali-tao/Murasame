import { appraise, baselinePad, containsGuiltLine, decay, idleFromPad, type Appraisal, type PadState } from '../../../shared/avatar/pad'
import type { AffectEvent } from '../../../shared/types'

const EVENT_LIMIT = 5

export class AffectService {
  // Transient appraisal is session-local. A restart begins calmly at baseline;
  // long-term relationship/history remain independently persisted.
  private state: PadState = baselinePad()
  private updatedAt: number
  private events: AffectEvent[] = []
  private nextEventId = 1

  constructor(private readonly clock: () => number = Date.now) { this.updatedAt = clock() }

  get pad(): PadState {
    const now = this.clock()
    if (Number.isFinite(now) && now > this.updatedAt) {
      const elapsed = now - this.updatedAt
      this.state = decay(this.state, elapsed / 60_000, elapsed / 300_000)
      this.updatedAt = now
    }
    return { ...this.state }
  }

  /** 最近的情绪事件（最新在前，最多 5 条；没有 reason 的底层校准不进入列表）。 */
  get recentEvents(): AffectEvent[] {
    return this.events.map((event) => ({ ...event, pad: { ...event.pad } }))
  }

  apply(event: Appraisal, meta: { reason?: string; rounds?: number; moodSteps?: number } = {}): PadState {
    this.state = decay(appraise(event, this.pad), meta.rounds ?? 1, meta.moodSteps ?? 1)
    if (meta.reason) {
      this.events.unshift({
        id: this.nextEventId++,
        at: new Date(this.clock()).toISOString(),
        reason: meta.reason,
        pad: { ...this.state }
      })
      if (this.events.length > EVENT_LIMIT) this.events.length = EVENT_LIMIT
    }
    return { ...this.state }
  }

  idle(hidden: boolean): ReturnType<typeof idleFromPad> {
    return idleFromPad(this.pad, hidden)
  }

  allowSpeech(text: string): { allowed: boolean; text: string } {
    if (containsGuiltLine(text)) { return { allowed: false, text: '' } }
    return { allowed: true, text }
  }
}
