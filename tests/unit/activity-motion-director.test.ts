import { expect, it, vi } from 'vitest'
import { ActivityMotionDirector } from '../../src/renderer/src/avatar/activity-motion-director'
import type { PetActivityMotion } from '../../src/shared/pet-work'

const work: PetActivityMotion = { key: 'run:working', motion: 'WorkingLoop', expression: null, loop: true }
const ready: PetActivityMotion = { key: 'run:ready', motion: 'Agree', expression: null, loop: false }
const flush = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve() }

it('holds one continuous state without restarting on repeated status samples', async () => {
  const play = vi.fn(async (_motion: PetActivityMotion | null, _current: () => boolean, started: () => void) => { started() })
  const director = new ActivityMotionDirector(play)
  director.setActivity(work)
  director.setActivity({ ...work })
  await flush()
  expect(play).toHaveBeenCalledTimes(1)
  expect(play.mock.calls[0][0]).toEqual(work)
})

it('plays a terminal result only once, then lets native idle resume', async () => {
  const play = vi.fn(async (_motion: PetActivityMotion | null, _current: () => boolean, started: () => void) => { started() })
  const director = new ActivityMotionDirector(play)
  director.setActivity(ready)
  director.finished()
  await flush()
  director.setActivity({ ...ready })
  expect(play).toHaveBeenCalledTimes(1)
})

it('does not interrupt a response and resumes the latest actual work state at its native end', async () => {
  const play = vi.fn(async (_motion: PetActivityMotion | null, _current: () => boolean, started: () => void) => { started() })
  const director = new ActivityMotionDirector(play)
  director.setActivity(work)
  director.transient('Greet', null)
  director.setActivity(ready)
  expect(play).toHaveBeenCalledTimes(2)
  director.finished()
  await flush()
  expect(play).toHaveBeenCalledTimes(3)
  expect(play.mock.calls[2][0]).toEqual(ready)
})

it('invalidates pending loads on state replacement, cancellation and unmount', async () => {
  const current: Array<() => boolean> = []
  const play = vi.fn(async (_motion: PetActivityMotion | null, valid: () => boolean) => { current.push(valid) })
  const director = new ActivityMotionDirector(play)
  director.setActivity(work)
  director.setActivity(ready)
  expect(current[0]()).toBe(false)
  expect(current[1]()).toBe(true)
  director.setActivity(null)
  expect(current[1]()).toBe(false)
  expect(play.mock.calls.at(-1)?.[0]).toBeNull()
  director.dispose()
  expect(current.at(-1)!()).toBe(false)
  director.setActivity(work)
  expect(play).toHaveBeenCalledTimes(3)
})

it('does not resume cancelled work after a response finishes', async () => {
  const play = vi.fn(async (_motion: PetActivityMotion | null, _current: () => boolean, started: () => void) => { started() })
  const director = new ActivityMotionDirector(play)
  director.setActivity(work)
  director.transient('Greet', null)
  director.setActivity(null)
  director.finished()
  await flush()
  expect(play.mock.calls.at(-1)?.[0]).toBeNull()
})

it('a late finish callback cannot end a more recent response', async () => {
  const play = vi.fn(async (_motion: PetActivityMotion | null, _current: () => boolean, started: () => void) => { started() })
  const director = new ActivityMotionDirector(play)
  director.setActivity(work)
  director.transient('Greet', null)
  director.finished()
  director.transient('Agree', null)
  await flush()
  expect(play).toHaveBeenCalledTimes(3)
  director.finished()
  await flush()
  expect(play.mock.calls.at(-1)?.[0]).toEqual(work)
})

it('failed loading releases a response without an unhandled rejection', async () => {
  const onError = vi.fn()
  const play = vi.fn(async (motion: PetActivityMotion | null) => { if (motion?.motion === 'Missing') throw new Error('missing') })
  const director = new ActivityMotionDirector(play, onError)
  director.setActivity(work)
  director.transient('Missing', null)
  await flush()
  expect(onError).toHaveBeenCalledTimes(1)
  expect(play.mock.calls.at(-1)?.[0]).toEqual(work)
})

it('an old native motion ending while a new response loads cannot swallow that response', async () => {
  let startNew!: () => void
  let currentNew!: () => boolean
  const play = vi.fn(async (motion: PetActivityMotion | null, current: () => boolean, started: () => void) => {
    if (motion?.motion === 'NewResponse') { startNew = started; currentNew = current }
    else started()
  })
  const director = new ActivityMotionDirector(play)
  director.setActivity(work)
  director.transient('Greet', null)
  director.transient('NewResponse', null)
  expect(director.waitingForStart).toBe(true)
  director.finished()
  await flush()
  expect(currentNew()).toBe(true)
  expect(play).toHaveBeenCalledTimes(3)
  startNew()
  expect(director.waitingForStart).toBe(false)
  director.finished()
  await flush()
  expect(play.mock.calls.at(-1)?.[0]).toEqual(work)
})
