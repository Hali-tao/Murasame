export function petDimensions(scale: number, chatOpen: boolean) {
  const safeScale = Math.min(1.4, Math.max(0.6, scale))
  const characterWidth = 326 * safeScale
  const characterHeight = 440 * safeScale
  const columnWidth = Math.max(360, Math.ceil(characterWidth) + 34)
  const height = Math.max(500, Math.ceil(characterHeight) + 60)
  return { characterWidth, characterHeight, columnWidth, height, width: columnWidth + (chatOpen ? 300 : 0) }
}

export function resizePetAroundFeet(
  bounds: { x: number; y: number; width: number; height: number },
  oldColumnWidth: number, columnWidth: number, height: number, oldLeft = 0, left = 0
) {
  return { x: bounds.x + oldLeft + oldColumnWidth / 2 - columnWidth / 2 - left, y: bounds.y + bounds.height - height }
}

export function alphaHit(pixels: Uint8Array | Uint8ClampedArray, width: number, height: number, x: number, y: number): boolean {
  x = Math.floor(x)
  y = Math.floor(y)
  return x >= 0 && y >= 0 && x < width && y < height && pixels[(y * width + x) * 4 + 3] > 12
}
