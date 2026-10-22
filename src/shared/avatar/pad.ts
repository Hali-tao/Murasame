export interface PadState {
  pleasure: number
  arousal: number
  dominance: number
}

export interface Appraisal {
  relevance: number
  consequence: number
  coping: number
  norm: number
}

export const baselinePad = (): PadState => ({ pleasure: 0, arousal: 0.2, dominance: 0 })

export function appraise(event: Appraisal, current: PadState): PadState {
  const pleasure = clamp(current.pleasure + event.consequence * 0.2 + event.norm * 0.1)
  const arousal = clamp(current.arousal + event.relevance * 0.25 - event.coping * 0.05)
  const dominance = clamp(current.dominance + event.coping * 0.2 + event.norm * 0.05)
  return { pleasure, arousal, dominance }
}

export function decay(current: PadState, rounds: number, moodSteps: number): PadState {
  const fast = Math.exp(-0.45 * rounds)
  const slow = Math.exp(-0.08 * moodSteps)
  const base = baselinePad()
  return {
    pleasure: base.pleasure + (current.pleasure - base.pleasure) * fast * slow,
    arousal: base.arousal + (current.arousal - base.arousal) * fast,
    dominance: base.dominance + (current.dominance - base.dominance) * slow
  }
}

export function idleFromPad(pad: PadState, hidden: boolean): { blinkMs: number; breath: number } | null {
  if (hidden) return null
  const energy = Math.max(0.2, pad.arousal)
  return { blinkMs: Math.round(4200 / energy), breath: 0.4 + energy * 0.4 }
}

export function containsGuiltLine(text: string): boolean {
  return /好久没理我|你是不是不喜欢我了|不要离开我/.test(text)
}

function clamp(value: number): number {
  return Math.max(-1, Math.min(1, value))
}
