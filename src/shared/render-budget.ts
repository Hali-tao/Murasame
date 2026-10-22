export function passthroughFor(overCharacter: boolean): boolean {
  return !overCharacter
}

export function allowHitSample(now: number, last: number, minMs = 50): boolean {
  return now - last >= minMs
}

export function targetFps(input: { hidden: boolean; interacting: boolean; idleMs: number }): number {
  if (input.hidden) return 0
  if (input.interacting) return 60
  if (input.idleMs > 60_000) return 8
  return 24
}

export function shouldRender(hidden: boolean): boolean {
  return !hidden
}
