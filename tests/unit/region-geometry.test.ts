import { expect, it } from 'vitest'
import { regionPixels } from '../../src/main/core/region-geometry'
it('maps local CSS coordinates to native pixels on high-DPI displays', () => {
  expect(regionPixels({ x: 50, y: 25, width: 100, height: 80 }, { width: 800, height: 600 }, { width: 1600, height: 1200 })).toEqual({ x: 100, y: 50, width: 200, height: 160 })
})
it('rounds fractional scaling without exceeding the bitmap', () => {
  expect(regionPixels({ x: 10, y: 10, width: 90, height: 70 }, { width: 100, height: 80 }, { width: 125, height: 100 })).toEqual({ x: 12, y: 12, width: 113, height: 88 })
})
it.each([
  { x: -1, y: 0, width: 20, height: 20 }, { x: 90, y: 0, width: 20, height: 20 },
  { x: 0, y: 0, width: 1, height: 20 }, { x: NaN, y: 0, width: 20, height: 20 }
])('rejects invalid/outside selections: %o', rect => {
  expect(() => regionPixels(rect, { width: 100, height: 100 }, { width: 200, height: 200 })).toThrow()
})
