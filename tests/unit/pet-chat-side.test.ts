import { describe, expect, it } from 'vitest'
import { choosePetChatSide } from '../../src/main/desktop/placement'

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
