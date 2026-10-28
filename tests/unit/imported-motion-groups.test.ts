import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolveMotionGroup } from '../../src/shared/avatar/motion-groups'
import { getPetPreset } from '../../src/shared/pet-presets'

it('uses actual tororo actions when imported over the Nailong preset', () => {
  const model = JSON.parse(readFileSync('src/renderer/public/live2d/tororo/tororo.model3.json', 'utf8'))
  const available = Object.keys(model.FileReferences.Motions)
  expect(resolveMotionGroup(getPetPreset('naiwa').motions.tap!, available, ['Tap', 'Idle'])).toBe('Tap')
  expect(resolveMotionGroup('idle', available, ['Idle'])).toBe('Idle')
  expect(resolveMotionGroup('Working', [], ['Idle'])).toBeNull()
})
