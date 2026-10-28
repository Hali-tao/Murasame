import { appraise, baselinePad, containsGuiltLine, decay, idleFromPad, type Appraisal, type PadState } from '../../../shared/avatar/pad'

export class AffectService {
  // Transient appraisal is session-local. A restart begins calmly at baseline;
  // long-term relationship/history remain independently persisted.
  private state: PadState = baselinePad()
  private updatedAt: number

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

  apply(event: Appraisal, rounds = 1, moodSteps = 1): PadState {
    this.state = decay(appraise(event, this.pad), rounds, moodSteps)
    return { ...this.state }
  }

  idle(hidden: boolean): ReturnType<typeof idleFromPad> {
    return idleFromPad(this.pad, hidden)
  }

  allowSpeech(text: string): { allowed: boolean; text: string } {
    if (containsGuiltLine(text)) return { allowed: false, text: '' }
    return { allowed: true, text }
  }
}
