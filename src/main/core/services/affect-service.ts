import { appraise, baselinePad, containsGuiltLine, decay, idleFromPad, type Appraisal, type PadState } from '../../../shared/avatar/pad'

export class AffectService {
  pad: PadState = baselinePad()

  apply(event: Appraisal, rounds = 1, moodSteps = 1): PadState {
    this.pad = decay(appraise(event, this.pad), rounds, moodSteps)
    return this.pad
  }

  idle(hidden: boolean): ReturnType<typeof idleFromPad> {
    return idleFromPad(this.pad, hidden)
  }

  allowSpeech(text: string): { allowed: boolean; text: string } {
    if (containsGuiltLine(text)) return { allowed: false, text: '' }
    return { allowed: true, text }
  }
}
