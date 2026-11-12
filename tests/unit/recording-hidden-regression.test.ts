// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import * as reactDom from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ChatPage } from '../../src/renderer/src/pages/ChatPage'
import { initialBootstrap } from '../../src/shared/mock-data'
import type { MurasameApi, PetState } from '../../src/shared/types'
import { resetStoreForTests, useAppStore } from '../../src/renderer/src/store'

// WebGL is unrelated to the recording lifecycle. The page and recording/audio
// implementation stay real; only the browser device and IPC boundaries vary.
vi.mock('../../src/renderer/src/components/Live2DPet', () => ({ Live2DPet: () => null }))
vi.mock('react-dom/client', async (original) => {
  const actual = await original<typeof import('react-dom/client')>()
  return { ...actual, createRoot: vi.fn(actual.createRoot) }
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
const listeners = new Map<string, Set<(value: unknown) => void>>()
const listen = (name: string) => (callback: (value: unknown) => void) => {
  if (!listeners.has(name)) listeners.set(name, new Set())
  listeners.get(name)!.add(callback)
  return () => { listeners.get(name)?.delete(callback) }
}
const emit = (name: string, value?: unknown): void => { listeners.get(name)?.forEach((callback) => callback(value)) }
let api: MurasameApi
let petRoot: Root | undefined
let track: { readyState: string; stop: () => void }
let getUserMedia: ReturnType<typeof vi.fn>
let pet: PetState

beforeEach(async () => {
  listeners.clear(); resetStoreForTests()
  Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.scrollTo = vi.fn()
  Element.prototype.setPointerCapture = vi.fn()
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  track = { readyState: 'live', stop() { this.readyState = 'ended' } }
  getUserMedia = vi.fn(async () => ({ getTracks: () => [track] }))
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
  vi.stubGlobal('AudioContext', class {
    sampleRate = 16000
    destination = {}
    createMediaStreamSource() { return { connect() {}, disconnect() {} } }
    createScriptProcessor() { return { connect() {}, disconnect() {}, onaudioprocess: null } }
    async close() {}
  })
  const data = initialBootstrap()
  data.settings.permissions.microphone = true
  data.settings.speakReplies = false
  data.conversations = [{ id: 'hidden-chat', title: '录音会话', time: '今天', preview: '', count: 0, pinned: false, messages: [] }]
  data.activeConversationId = 'hidden-chat'
  data.tasks = []
  pet = { visible: true, scale: 0.9, x: 0, y: 0, preset: 'naiwa', importedModelUrl: '' }
  api = {
    app: { getInfo: async () => ({ version: 'test', platform: 'win32' }) },
    window: { onHidden: listen('hidden') },
    settings: { get: async () => data.settings, onChanged: listen('settings') },
    core: { getBootstrap: async () => ({ ok: true, data }), setActiveConversation: async () => ({ ok: true, data: 'hidden-chat' }), sendMessage: vi.fn() },
    voice: { readiness: vi.fn(async () => ({ stt: true, tts: false, detail: '' })), transcribe: vi.fn(async () => ({ text: '不应提交的录音', accepted: true, message: '' })), speak: vi.fn() },
    pet: { getState: async () => pet, onStateChanged: listen('pet'), onFocusChat: listen('focus'), onPerformance: listen('performance'), onTheater: listen('theater'), getAffect: async () => ({ p: 0, a: 0, d: 0 }), setChatOpen: async () => ({ open: true, side: 'right' }), setIgnoreMouseEvents: async () => {} },
    autonomy: { status: async () => ({ running: false, viewUrl: '', phase: 'idle', notes: [] }) },
    events: { onConversationUpdated: listen('updated'), onMessageStarted: listen('started'), onMessageFailed: listen('failed'), onMessageDelta: listen('delta'), onActiveConversation: listen('active'), onTaskUpdated: listen('task'), onMemoriesUpdated: listen('memory'), onMemoryExtractionStatus: listen('extraction') }
  } as unknown as MurasameApi
  Object.defineProperty(window, 'murasame', { configurable: true, value: api })
  await useAppStore.getState().init()
})
afterEach(async () => {
  if (petRoot) { await act(async () => petRoot?.unmount()); petRoot = undefined }
  cleanup(); document.body.innerHTML = ''; vi.restoreAllMocks(); vi.unstubAllGlobals()
})

function mountChat(): HTMLTextAreaElement {
  render(createElement(MemoryRouter, null, createElement(ChatPage)))
  const input = screen.getByTestId('chat-input') as HTMLTextAreaElement
  fireEvent.change(input, { target: { value: '保留原草稿' } })
  return input
}
const clickVoice = async (): Promise<void> => { await act(async () => { fireEvent.click(screen.getByRole('button', { name: '语音' })) }) }

it('[FR-27] hiding the console closes the real recording track without submitting it', async () => {
  const input = mountChat(); await clickVoice()
  expect(track.readyState).toBe('live')
  expect(screen.getByRole('button', { name: '结束并识别' })).toBeTruthy()
  await act(async () => emit('hidden'))
  expect(track.readyState).toBe('ended')
  expect(screen.getByRole('button', { name: '语音' })).toBeTruthy()
  expect(input.value).toBe('保留原草稿')
  expect(api.voice.transcribe).not.toHaveBeenCalled()
  // Showing the window is not permission to start recording again.
  expect(getUserMedia).toHaveBeenCalledTimes(1)
})

it('[FR-27] hiding during readiness prevents a late microphone request', async () => {
  const pending = deferred<Awaited<ReturnType<MurasameApi['voice']['readiness']>>>()
  vi.mocked(api.voice.readiness).mockImplementation(() => pending.promise)
  mountChat(); await clickVoice()
  act(() => emit('hidden'))
  await act(async () => pending.resolve({ stt: true, tts: false, detail: '' }))
  expect(getUserMedia).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: '语音' })).toBeTruthy()
})

it('[FR-27] hiding during device permission closes a late returned track', async () => {
  const pending = deferred<{ getTracks(): typeof track[] }>()
  getUserMedia.mockImplementation(() => pending.promise)
  mountChat(); await clickVoice()
  act(() => emit('hidden'))
  await act(async () => pending.resolve({ getTracks: () => [track] }))
  expect(track.readyState).toBe('ended')
  expect(screen.getByRole('button', { name: '语音' })).toBeTruthy()
  expect(api.voice.transcribe).not.toHaveBeenCalled()
})

it('[FR-27] hiding during transcription discards late text and preserves the draft', async () => {
  const pending = deferred<Awaited<ReturnType<MurasameApi['voice']['transcribe']>>>()
  vi.mocked(api.voice.transcribe).mockImplementation(() => pending.promise)
  const input = mountChat(); await clickVoice()
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '结束并识别' })))
  expect(api.voice.transcribe).toHaveBeenCalledOnce()
  act(() => emit('hidden'))
  await act(async () => pending.resolve({ accepted: true, text: '迟到转写', message: '' }))
  expect(input.value).toBe('保留原草稿')
  expect(api.core.sendMessage).not.toHaveBeenCalled()
})

it('[FR-27] browser visibility changes also stop active recording', async () => {
  mountChat(); await clickVoice()
  Object.defineProperty(document, 'hidden', { configurable: true, value: true })
  await act(async () => document.dispatchEvent(new Event('visibilitychange')))
  expect(track.readyState).toBe('ended')
  expect(api.voice.transcribe).not.toHaveBeenCalled()
})

it('[FR-27] the mounted pet cancels held recording and all late voice stages on hide', async () => {
  const original = (await vi.importActual<typeof import('react-dom/client')>('react-dom/client')).createRoot
  vi.mocked(reactDom.createRoot).mockImplementation((container, options) => { petRoot = original(container, options); return petRoot })
  document.body.innerHTML = '<div id="root"></div>'
  await act(async () => { await import('../../src/renderer/src/pet') })
  await act(async () => emit('focus'))
  let mic = screen.getByRole('button', { name: '按住说话' })
  await act(async () => fireEvent.pointerDown(mic, { pointerId: 1 }))
  expect(mic.classList.contains('is-recording')).toBe(true)
  await act(async () => emit('pet', { ...pet, visible: false }))
  expect(track.readyState).toBe('ended')
  await act(async () => emit('pet', pet))
  mic = screen.getByRole('button', { name: '按住说话' })
  expect(mic.classList.contains('is-recording')).toBe(false)
  expect(api.voice.transcribe).not.toHaveBeenCalled()

  const readiness = deferred<Awaited<ReturnType<MurasameApi['voice']['readiness']>>>()
  vi.mocked(api.voice.readiness).mockImplementationOnce(() => readiness.promise)
  await act(async () => fireEvent.pointerDown(mic, { pointerId: 2 }))
  act(() => emit('hidden'))
  await act(async () => readiness.resolve({ stt: true, tts: false, detail: '' }))
  expect(getUserMedia).toHaveBeenCalledTimes(1)

  track.readyState = 'live'
  const device = deferred<{ getTracks(): typeof track[] }>()
  getUserMedia.mockImplementationOnce(() => device.promise)
  await act(async () => fireEvent.pointerDown(mic, { pointerId: 3 }))
  act(() => emit('hidden'))
  await act(async () => device.resolve({ getTracks: () => [track] }))
  expect(track.readyState).toBe('ended')
  expect(mic.classList.contains('is-recording')).toBe(false)

  track.readyState = 'live'
  const transcription = deferred<Awaited<ReturnType<MurasameApi['voice']['transcribe']>>>()
  vi.mocked(api.voice.transcribe).mockImplementationOnce(() => transcription.promise)
  await act(async () => fireEvent.pointerDown(mic, { pointerId: 4 }))
  await act(async () => fireEvent.pointerUp(mic, { pointerId: 4 }))
  expect(api.voice.transcribe).toHaveBeenCalledOnce()
  act(() => emit('hidden'))
  await act(async () => transcription.resolve({ accepted: true, text: '隐藏后不能发送', message: '' }))
  expect(api.core.sendMessage).not.toHaveBeenCalled()
})
