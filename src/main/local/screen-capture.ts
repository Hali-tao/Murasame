export interface CapturedFrame {
  dataUrl: string
  width: number
  height: number
  captured: boolean
}

export async function captureDesktop(
  allowed: boolean,
  capturer: () => Promise<CapturedFrame>
): Promise<CapturedFrame> {
  if (!allowed) return { dataUrl: '', width: 0, height: 0, captured: false }
  const frame = await capturer()
  return { ...frame, captured: true, dataUrl: frame.dataUrl.slice(0, 180_000) }
}
