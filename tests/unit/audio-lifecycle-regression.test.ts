// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { playSamples, startRecording } from '../../src/renderer/src/lib/audio'

const track = { stop: vi.fn() }
const source = { connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null as (() => void) | null, buffer: null }
const processor = { connect: vi.fn(), disconnect: vi.fn(), onaudioprocess: null }
const close = vi.fn().mockResolvedValue(undefined)
const audioContext = vi.fn(function () { return {
  sampleRate: 16000, currentTime: 0, destination: {}, close,
  createMediaStreamSource: () => source, createScriptProcessor: () => processor,
  createBuffer: () => ({ copyToChannel: vi.fn() }), createBufferSource: () => source
} })
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('AudioContext', audioContext)
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
})
afterEach(() => vi.unstubAllGlobals())

it('revoking permission while the browser permission dialog is pending stops the returned microphone', async () => {
  let release!: (value: unknown) => void
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(() => new Promise(resolve => { release = resolve })) } })
  const controller = new AbortController()
  const pending = startRecording(controller.signal)
  const rejected = expect(pending).rejects.toThrow()
  controller.abort()
  release({ getTracks: () => [track] })
  await rejected
  expect(track.stop).toHaveBeenCalledOnce()
  expect(audioContext).not.toHaveBeenCalled()
})

it('revoking permission stops an active recording and repeated cleanup is harmless', async () => {
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [track] }) } })
  const controller = new AbortController()
  const recording = await startRecording(controller.signal)
  controller.abort()
  await recording.stop()
  expect(track.stop).toHaveBeenCalledOnce()
  expect(processor.disconnect).toHaveBeenCalledOnce()
  expect(close).toHaveBeenCalledOnce()
})

it('switching conversation during playback stops the audio and mouth animation clock', async () => {
  const controller = new AbortController()
  const played = playSamples([0, 0.1], 16000, () => undefined, controller.signal)
  expect(source.start).toHaveBeenCalledOnce()
  controller.abort()
  await played
  expect(source.stop).toHaveBeenCalledOnce()
  expect(cancelAnimationFrame).toHaveBeenCalledWith(1)
  expect(close).toHaveBeenCalledOnce()
})

it('a cancelled synthesis result never opens an audio output', async () => {
  const controller = new AbortController(); controller.abort()
  await playSamples([0.2], 16000, undefined, controller.signal)
  expect(audioContext).not.toHaveBeenCalled()
})
