export interface RegionRect { x: number; y: number; width: number; height: number }
export function regionPixels(rect: RegionRect, view: { width: number; height: number }, image: { width: number; height: number }): RegionRect {
  if (![rect.x, rect.y, rect.width, rect.height, view.width, view.height, image.width, image.height].every(Number.isFinite)
    || view.width <= 0 || view.height <= 0 || image.width <= 0 || image.height <= 0
    || rect.x < 0 || rect.y < 0 || rect.width < 8 || rect.height < 8
    || rect.x + rect.width > view.width || rect.y + rect.height > view.height) throw new Error('选区无效，请在同一块屏幕内重新框选。')
  const x = Math.floor(rect.x * image.width / view.width)
  const y = Math.floor(rect.y * image.height / view.height)
  return { x, y, width: Math.min(image.width, Math.ceil((rect.x + rect.width) * image.width / view.width)) - x,
    height: Math.min(image.height, Math.ceil((rect.y + rect.height) * image.height / view.height)) - y }
}
