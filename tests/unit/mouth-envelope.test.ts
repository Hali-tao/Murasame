import { describe, expect, it } from 'vitest'
import { mouthEnvelope } from '../../src/renderer/src/avatar/orchestrator'

describe('mouthEnvelope', () => {
  it('opens the mouth on the loud frame and closes it on silence', () => {
    const samples = [0, 0, 0, 0, 1, 1, 0, 0]
    const frames = mouthEnvelope(samples, 4, 2)
    expect(frames).toHaveLength(4)
    expect(frames[0]).toBe(0)
    expect(frames[2]).toBe(1)
    expect(frames[3]).toBe(0)
  })

  it('returns an empty list for empty audio', () => {
    expect(mouthEnvelope([], 16_000)).toEqual([])
  })
})
