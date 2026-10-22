export interface ForegroundHint {
  title: string
  idleMs: number
  fullscreen: boolean
  typedWithinMs: number
}

export function foregroundHint(input: ForegroundHint): { busy: boolean; reason: string } {
  if (input.fullscreen) return { busy: true, reason: '前台是全屏应用' }
  if (input.typedWithinMs < 30_000) return { busy: true, reason: '30 秒内有键盘输入' }
  if (input.idleMs < 60_000) return { busy: false, reason: input.title }
  return { busy: false, reason: `空闲 ${Math.round(input.idleMs / 1000)} 秒，前台是 ${input.title}` }
}
