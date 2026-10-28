import { afterEach, expect, it, vi } from 'vitest'
import type { ActivityStatus } from '../../src/shared/types'
import { followAutonomyStatus } from '../../src/renderer/src/lib/autonomy-status'

const running: ActivityStatus = { activityId: 'run', running: true, phase: 'running', reason: 'working', viewUrl: '', notes: [], taskStatus: '' }
afterEach(() => vi.useRealTimers())

it('subscribes before restore and discards a poll result older than a phase event', async () => {
  let listener!: (state: ActivityStatus) => void
  let resolve!: (value: ActivityStatus) => void
  const status = vi.fn(() => new Promise<ActivityStatus>(done => { resolve = done }))
  const received = vi.fn()
  const stop = followAutonomyStatus({ status, onStatusChanged: callback => { listener = callback; return () => undefined } }, received)
  listener({ ...running, phase: 'stopped', running: false })
  resolve(running)
  await Promise.resolve()
  expect(received).toHaveBeenCalledTimes(1)
  expect(received.mock.calls[0][0].phase).toBe('stopped')
  stop()
})

it('never overlaps health requests and stops both polling and events on unmount', async () => {
  vi.useFakeTimers()
  let resolve!: (value: ActivityStatus) => void
  let listener!: (state: ActivityStatus) => void
  const unsubscribe = vi.fn()
  const status = vi.fn(() => new Promise<ActivityStatus>(done => { resolve = done }))
  const received = vi.fn()
  const stop = followAutonomyStatus({ status, onStatusChanged: callback => { listener = callback; return unsubscribe } }, received)
  await vi.advanceTimersByTimeAsync(20_000)
  expect(status).toHaveBeenCalledTimes(1)
  stop(); resolve(running); listener(running)
  await vi.advanceTimersByTimeAsync(10_000)
  expect(received).not.toHaveBeenCalled()
  expect(status).toHaveBeenCalledTimes(1)
  expect(unsubscribe).toHaveBeenCalledTimes(1)
})

it('clears stale work on an actual status failure and continues bounded recovery', async () => {
  vi.useFakeTimers()
  const status = vi.fn().mockRejectedValueOnce(new Error('closed')).mockResolvedValue(running)
  const received = vi.fn()
  const stop = followAutonomyStatus({ status, onStatusChanged: () => () => undefined }, received)
  await vi.advanceTimersByTimeAsync(0)
  expect(received).toHaveBeenLastCalledWith(null)
  await vi.advanceTimersByTimeAsync(3000)
  expect(received).toHaveBeenLastCalledWith(running)
  stop()
})
