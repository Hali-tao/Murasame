import { describe, expect, it } from 'vitest'
import { choosePetChatSide, recoverPosition } from '../../src/main/desktop/placement'

describe('choosePetChatSide', () => {
  it('keeps the dialog on the right when that side has room', () => {
    expect(choosePetChatSide({
      characterX: 100,
      characterWidth: 360,
      chatWidth: 300,
      areaX: 0,
      areaWidth: 1920
    })).toBe('right')
  })

  it('flips the dialog to the left when the character sits on the right edge', () => {
    expect(choosePetChatSide({
      characterX: 1600,
      characterWidth: 360,
      chatWidth: 300,
      areaX: 0,
      areaWidth: 1920
    })).toBe('left')
  })

  it('picks the larger side when neither side can hold the dialog', () => {
    expect(choosePetChatSide({
      characterX: 200,
      characterWidth: 360,
      chatWidth: 300,
      areaX: 0,
      areaWidth: 700
    })).toBe('left')
  })
})

describe('recoverPosition', () => {
  const laptop = { id: 'laptop', x: 0, y: 0, width: 1536, height: 864, scaleFactor: 1.25 }

  it('把记在已拔掉的外接屏幕上的窗口拉回当前屏幕', () => {
    const recovered = recoverPosition(
      { x: 1920, y: 80, width: 1400, height: 880 },
      [laptop]
    )
    expect(recovered.x).toBeGreaterThanOrEqual(laptop.x)
    expect(recovered.x).toBeLessThan(laptop.x + laptop.width)
    expect(recovered.y).toBeGreaterThanOrEqual(laptop.y)
    expect(recovered.y).toBeLessThan(laptop.y + laptop.height)
  })

  it('把带小数的屏幕坐标收成整数，避免窗口拒绝移动', () => {
    const recovered = recoverPosition(
      { x: 120.4, y: 80.6, width: 360, height: 500 },
      [laptop]
    )
    expect(recovered.x).toBe(120)
    expect(recovered.y).toBe(81)
  })
})
