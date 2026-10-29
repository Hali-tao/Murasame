// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, act } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { MemoryPage } from '../../src/renderer/src/pages/MemoryPage'
import { ChatPage } from '../../src/renderer/src/pages/ChatPage'
import * as audio from '../../src/renderer/src/lib/audio'
import { initialBootstrap } from '../../src/shared/mock-data'
import type { Conversation, MemoryEntry, MurasameApi, Result } from '../../src/shared/types'
import { resetStoreForTests, useAppStore } from '../../src/renderer/src/store'

const listeners: Record<string, Array<(payload: unknown) => void>> = {}
const listen = (name: string) => (callback: (payload: unknown) => void) => {
  ;(listeners[name] ??= []).push(callback)
  return () => { listeners[name] = listeners[name].filter((item) => item !== callback) }
}
function emit(name: string, payload: unknown): void { for (const callback of listeners[name] ?? []) callback(payload) }
function deferred<T>() { let release!: (value: T) => void; const promise = new Promise<T>((done) => { release = done }); return { promise, release } }
const chats: Conversation[] = ['a', 'b'].map((id) => ({ id, title: `会话${id}`, time: '今天', preview: '历史', count: 0, pinned: false, messages: [] }))
let api: MurasameApi
beforeEach(async () => {
  resetStoreForTests()
  for (const key of Object.keys(listeners)) delete listeners[key]
  const data = initialBootstrap()
  data.conversations = structuredClone(chats)
  data.activeConversationId = 'a'
  data.memories = [
    { id: 'unused', text: '没有注入的记忆', category: '偏好', source: '手动', updated: '有效' },
    { id: 'used', text: '实际注入的白茶偏好', category: '偏好', source: '手动', updated: '有效' }
  ]
  api = {
    app: { getInfo: async () => ({ version: 'test', platform: 'win32' }) },
    settings: { get: async () => data.settings, onChanged: listen('settings') },
    core: { getBootstrap: async () => ({ ok: true, data }), setActiveConversation: async () => ({ ok: true, data: 'a' }), sendMessage: vi.fn() },
    events: {
      onConversationDeleted: listen('deleted'), onConversationUpdated: listen('updated'), onMessageStarted: listen('started'), onMessageFailed: listen('failed'),
      onMessageDelta: listen('delta'), onActiveConversation: listen('active'), onTaskUpdated: listen('task'), onMemoriesUpdated: listen('memories'), onMemoryExtractionStatus: listen('extraction'), onMemoryIndexStatus: listen('index')
    }
  } as unknown as MurasameApi
  Object.defineProperty(window, 'murasame', { configurable: true, value: api })
  Element.prototype.scrollIntoView = vi.fn()
  await useAppStore.getState().init()
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('conversation UI isolation', () => {
  it('removes externally deleted history and rejects a late conversation update', () => {
    emit('deleted', { id: 'a', activeConversationId: 'b' })
    emit('updated', { ...chats[0], messages: [{ id: 'late', role: 'assistant', text: '迟到旧回复', time: '现在' }] })
    expect(useAppStore.getState().data?.conversations.map(item => item.id)).toEqual(['b'])
    expect(useAppStore.getState().selectedConversationId).toBe('b')
  })

  it('cannot restore deleted history from a delayed initial snapshot', async () => {
    const initial = await api.core.getBootstrap()
    resetStoreForTests()
    const pending = deferred<typeof initial>()
    api.core.getBootstrap = () => pending.promise
    const loading = useAppStore.getState().init()
    emit('deleted', { id: 'a', activeConversationId: 'b' })
    pending.release(initial)
    await loading
    expect(useAppStore.getState().data?.conversations.map(item => item.id)).toEqual(['b'])
    expect(useAppStore.getState().selectedConversationId).toBe('b')
  })

  it('[D-17] 展示后台记忆整理的实际进度与失败，保持已有记忆可查看', () => {
    render(createElement(MemoryRouter, null, createElement(MemoryPage)))
    const previous = useAppStore.getState().data!.memories
    act(() => emit('index', { state: 'rebuilding', completed: 3, total: 10, message: '正在后台整理记忆，对话可以继续。' }))
    const progress = screen.getByRole('progressbar', { name: '记忆整理进度' })
    expect(progress.getAttribute('aria-valuenow')).toBe('3')
    expect(progress.getAttribute('aria-valuemax')).toBe('10')
    expect(screen.getByText('正在后台整理记忆，对话可以继续。')).toBeTruthy()
    act(() => emit('index', { state: 'failed', completed: 3, total: 10, message: '整理暂时中断，已有内容仍保留。' }))
    expect(screen.getByText('整理暂时中断')).toBeTruthy()
    expect(screen.getByText('整理暂时中断，已有内容仍保留。')).toBeTruthy()
    expect(useAppStore.getState().data!.memories).toEqual(previous)
  })

  it('keeps current selection on background events and background send completion', async () => {
    const pending = deferred<Result<Conversation>>()
    vi.mocked(api.core.sendMessage).mockImplementation(() => pending.promise)
    const send = useAppStore.getState().sendMessage('a', '后台输入')
    useAppStore.getState().selectConversation('b')
    const saved: Conversation = { ...chats[0], messages: [{ id: 'a-reply', role: 'assistant', text: '后台完成', time: '现在' }] }
    emit('updated', saved)
    expect(useAppStore.getState().selectedConversationId).toBe('b')
    pending.release({ ok: true, data: saved }); await send
    expect(useAppStore.getState().selectedConversationId).toBe('b')
    expect(useAppStore.getState().data?.conversations[0].messages[0].text).toBe('后台完成')
  })

  it('refreshes extracted memories immediately and avoids duplicate entries after a broadcasted manual save', async () => {
    const memory: MemoryEntry = { id: 'new', text: '新提取项目', category: '项目', source: 'a', updated: '有效' }
    emit('memories', [memory])
    expect(useAppStore.getState().data?.memories).toEqual([memory])
    api.core.addMemory = async () => { emit('memories', [memory]); return { ok: true, data: memory } }
    await useAppStore.getState().addMemory('项目', memory.text)
    expect(useAppStore.getState().data?.memories).toEqual([memory])
  })

  it('keeps drafts and externally started optimistic input in their own conversation', async () => {
    render(createElement(MemoryRouter, null, createElement(ChatPage)))
    const input = screen.getByTestId('chat-input') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: '甲的草稿' } })
    fireEvent.click(screen.getByText('会话b'))
    expect(input.value).toBe('')
    fireEvent.change(input, { target: { value: '乙的草稿' } })
    act(() => emit('started', { conversationId: 'a', userText: '外部甲输入' }))
    expect(screen.queryByText('外部甲输入')).toBeNull()
    expect(screen.queryByText(/正在连接/)).toBeNull()
    fireEvent.click(screen.getByText('会话a'))
    expect(input.value).toBe('甲的草稿')
    expect(screen.getByText('外部甲输入')).toBeTruthy()
    fireEvent.click(screen.getByText('会话b'))
    act(() => emit('failed', { conversationId: 'a', error: '甲失败' }))
    expect(input.value).toBe('乙的草稿')
  })

  it('shows only actual recalled IDs and an honest empty state; the context panel can collapse', () => {
    useAppStore.setState((state) => ({ data: state.data ? { ...state.data, conversations: state.data.conversations.map((chat) => chat.id === 'a' ? { ...chat, recalledMemoryIds: ['used'], recalledAtMessageId: 'reply-a' } : chat) } : null }))
    render(createElement(MemoryRouter, null, createElement(ChatPage)))
    expect(screen.getByText('实际注入的白茶偏好')).toBeTruthy()
    expect(screen.queryByText('没有注入的记忆')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '收起上下文' }))
    expect(screen.getByRole('button', { name: '展开上下文' }).getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: '展开上下文' }))
    fireEvent.click(screen.getByText('会话b'))
    expect(screen.getByText('本轮未注入长期记忆')).toBeTruthy()
  })
})


describe('visible memory extraction lifecycle', () => {
  it('withdraws cleared notices while retaining other conversations and permits a new extraction', () => {
    render(createElement(MemoryRouter, null, createElement(MemoryPage)))
    const publish = (conversationId: string, status: string) => act(() => emit('extraction', { conversationId, status, updatedAt: '2026-10-29T10:00:00Z' }))
    publish('a', 'saved'); publish('b', 'failed')
    publish('a', 'cleared')
    expect(screen.queryByText('已保存新记忆')).toBeNull()
    expect(useAppStore.getState().memoryExtractions.a).toBeUndefined()
    expect(screen.getByText('提取失败')).toBeTruthy()
    publish('a', 'processing')
    expect(screen.getByText('正在提取')).toBeTruthy()
  })

  it('shows a readable source title, searches it and opens the correct history', () => {
    act(() => emit('memories', [{ id: 'source-memory', text: '喜欢白茶', category: '偏好', source: 'b', updated: '有效' }]))
    render(createElement(MemoryRouter, null, createElement(Routes, null,
      createElement(Route, { path: '/', element: createElement(MemoryPage) }),
      createElement(Route, { path: '/history', element: createElement('h1', null, '历史位置') })
    )))
    fireEvent.change(screen.getByRole('textbox', { name: '搜索记忆' }), { target: { value: '会话b' } })
    expect(screen.getByText('喜欢白茶')).toBeTruthy()
    fireEvent.click(screen.getByRole('link', { name: '查看来源：会话b' }))
    expect(screen.getByText('历史位置')).toBeTruthy()
    expect(useAppStore.getState().selectedConversationId).toBe('b')
  })

  it('preserves memory with deleted history and hides its internal source id', () => {
    act(() => emit('memories', [{ id: 'orphan', text: '历史删除后仍保留的白茶', category: '偏好', source: 'chat-removed-fixture', updated: '有效' }]))
    render(createElement(MemoryRouter, null, createElement(MemoryPage)))
    expect(screen.getByText('历史删除后仍保留的白茶')).toBeTruthy()
    expect(screen.getByText('来源会话已删除')).toBeTruthy()
    expect(screen.queryByText('chat-removed-fixture')).toBeNull()
    expect(screen.queryByRole('link', { name: /查看来源/ })).toBeNull()
  })

  it('shows processing, saved, empty, skipped and failed outcomes without discarding existing memory', () => {
    render(createElement(MemoryRouter, null, createElement(MemoryPage)))
    const publish = (status: string, reason?: string) => act(() => emit('extraction', { conversationId: 'a', status, reason, updatedAt: '2026-10-28T10:00:00Z' }))
    publish('processing'); expect(screen.getByText('正在提取')).toBeTruthy()
    publish('saved'); expect(screen.getByText('已保存新记忆')).toBeTruthy()
    publish('unchanged'); expect(screen.getByText('没有新的长期信息')).toBeTruthy()
    publish('skipped', '自动提取已暂停'); expect(screen.getByText('提取已暂停')).toBeTruthy()
    publish('failed', '受控模型错误'); expect(screen.getByText('提取失败')).toBeTruthy()
    expect(screen.getByText(/可重试该轮消息或手动添加/)).toBeTruthy()
    expect(screen.getByText('没有注入的记忆')).toBeTruthy()
    expect(useAppStore.getState().data?.memories).toHaveLength(2)
  })
})


describe('late voice transcription respects its recording owner', () => {
  function enableSyntheticMicrophone(): void {
    useAppStore.setState((state) => ({ data: state.data ? { ...state.data, settings: { ...state.data.settings, permissions: { ...state.data.settings.permissions, microphone: true } } } : null }))
    api.voice = {
      readiness: async () => ({ stt: true, tts: false, detail: '受控本地语音环境' }),
      transcribe: vi.fn(),
      speak: vi.fn()
    }
    // Only the browser/device boundary is replaced. ChatPage, its abort
    // controllers, settings subscriptions and per-conversation drafts are real.
    vi.spyOn(audio, 'startRecording').mockImplementation(async (signal) => {
      signal?.throwIfAborted()
      return { stop: async () => [0.1, 0.2, 0.3] }
    })
  }

  it('discards an accepted transcription that returns after microphone permission is revoked', async () => {
    enableSyntheticMicrophone()
    const pending = deferred<Awaited<ReturnType<MurasameApi['voice']['transcribe']>>>()
    vi.mocked(api.voice.transcribe).mockImplementation(() => pending.promise)
    render(createElement(MemoryRouter, null, createElement(ChatPage)))
    const input = screen.getByTestId('chat-input') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: '保留这份原草稿' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '语音' })) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '结束并识别' })) })
    await vi.waitFor(() => expect(api.voice.transcribe).toHaveBeenCalledTimes(1))
    const settings = useAppStore.getState().data!.settings
    act(() => emit('settings', { ...settings, permissions: { ...settings.permissions, microphone: false } }))
    await act(async () => { pending.release({ text: '撤权后迟到的私密转写', accepted: true, message: '受控完成' }) })
    expect(input.value).toBe('保留这份原草稿')
    expect(screen.queryByText('撤权后迟到的私密转写')).toBeNull()
  })

  it('does not append conversation A transcription to B when a new B recording has started', async () => {
    enableSyntheticMicrophone()
    const first = deferred<Awaited<ReturnType<MurasameApi['voice']['transcribe']>>>()
    vi.mocked(api.voice.transcribe)
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce({ text: '乙的新录音', accepted: true, message: '受控完成' })
    render(createElement(MemoryRouter, null, createElement(ChatPage)))
    const input = screen.getByTestId('chat-input') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: '甲的原草稿' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '语音' })) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '结束并识别' })) })
    await vi.waitFor(() => expect(api.voice.transcribe).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByText('会话b'))
    fireEvent.change(input, { target: { value: '乙的原草稿' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '语音' })) })
    await act(async () => { first.release({ text: '甲的迟到录音', accepted: true, message: '受控完成' }) })
    expect(input.value).toBe('乙的原草稿')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '结束并识别' })) })
    expect(input.value).toBe('乙的原草稿 乙的新录音')
    fireEvent.click(screen.getByText('会话a'))
    expect(input.value).toBe('甲的原草稿')
  })
})
