// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { initialBootstrap } from '../../src/shared/mock-data'
import type { ActivityStatus, MurasameApi, Task } from '../../src/shared/types'

const harness = vi.hoisted(() => ({ element: null as unknown }))
vi.mock('react-dom/client', async original => {
  const actual = await original<typeof import('react-dom/client')>()
  return { ...actual, createRoot: () => ({ render: (element: unknown) => { harness.element = element } }) }
})
vi.mock('../../src/renderer/src/components/Live2DPet', () => ({ Live2DPet: (props: { activityMotion?: { motion: string } }) => createElement('div', { 'data-testid': 'live2d-activity', 'data-motion': props.activityMotion?.motion ?? 'none' }) }))

const listeners = new Map<string, Set<(state: unknown) => void>>()
const listen = (name: string) => (fn: (state: unknown) => void) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name)!.add(fn); return () => listeners.get(name)?.delete(fn) }
const emit = (name: string, state: unknown) => listeners.get(name)?.forEach(fn => fn(state))
function deferred<T>() { let resolve!: (value: T) => void; return { promise: new Promise<T>(done => { resolve = done }), resolve: (value: T) => resolve(value) } }
const active: ActivityStatus = { activityId: 'offline-run', running: true, phase: 'running', canStop: true, busy: true, kind: 'code', reason: '正在运行真实脚本', viewUrl: '', notes: [], taskStatus: '', creation: { phase: 'executing', message: '实际运行脚本' } }
let api: MurasameApi
let data: ReturnType<typeof initialBootstrap>
const pet = { visible: true, scale: 0.9, x: 0, y: 0, preset: 'naiwa', importedModelUrl: '' }

beforeAll(async () => {
  const root = document.createElement('div'); root.id = 'root'; document.body.append(root)
  await import('../../src/renderer/src/pet')
})
beforeEach(() => {
  listeners.clear()
  localStorage.clear()
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.scrollTo = vi.fn()
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  data = initialBootstrap(); data.tasks = []; data.settings.speakReplies = false
  data.conversations = [{ id: 'chat', title: '独立对话', time: '现在', preview: '', count: 0, pinned: false, messages: [] }]
  data.activeConversationId = 'chat'
  api = {
    core: { getBootstrap: vi.fn(async () => ({ ok: true, data })) },
    window: { onHidden: listen('hidden'), openPath: vi.fn(async () => {}) },
    settings: { onChanged: listen('settings') },
    pet: { getState: async () => pet, onStateChanged: listen('pet'), onFocusChat: listen('focus'), onPerformance: listen('performance'), onTheater: listen('theater'), getAffect: async () => ({ p: 0, a: 0, d: 0 }), setIgnoreMouseEvents: async () => {}, setChatOpen: async (open: boolean) => ({ open, side: 'left' }) },
    autonomy: { status: vi.fn(async () => active), onStatusChanged: listen('autonomy'), stop: vi.fn(async () => ({ ok: false, error: '清理失败，可以重试' })) },
    events: { onConversationDeleted: listen('deleted'), onConversationUpdated: listen('updated'), onActiveConversation: listen('active'), onMessageDelta: listen('delta'), onMessageStarted: listen('started'), onMessageFailed: listen('failed'), onTaskUpdated: listen('task') }
  } as unknown as MurasameApi
  Object.defineProperty(window, 'murasame', { configurable: true, value: api })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const mount = async () => { await act(async () => { render(harness.element as ReactNode) }) }

it('clears deleted conversation text immediately and rejects late events while switching', async () => {
  data.conversations[0].messages = [{ id: 'old-reply', role: 'assistant', text: '应该被删除的旧回复', time: '现在' }]
  await mount()
  expect(document.body.textContent).toContain('应该被删除的旧回复')
  const pending = deferred<Awaited<ReturnType<MurasameApi['core']['getBootstrap']>>>()
  vi.mocked(api.core.getBootstrap).mockReturnValue(pending.promise)
  await act(async () => emit('deleted', { id: 'chat', activeConversationId: null }))
  expect(document.body.textContent).not.toContain('应该被删除的旧回复')
  await act(async () => {
    emit('updated', data.conversations[0])
    emit('delta', { conversationId: 'chat', delta: '不应复活的迟到回复' })
    emit('started', { conversationId: 'chat', userText: '不应复活的请求' })
  })
  expect(document.body.textContent).not.toContain('应该被删除的旧回复')
  expect(document.body.textContent).not.toContain('不应复活')
  await act(async () => pending.resolve({ ok: true, data }))
  expect(document.body.textContent).not.toContain('应该被删除的旧回复')
})

it('keeps the visible conversation when a different history is deleted', async () => {
  data.conversations[0].messages = [{ id: 'keep-reply', role: 'assistant', text: '仍然保留的当前回复', time: '现在' }]
  await mount()
  await act(async () => emit('deleted', { id: 'other', activeConversationId: 'chat' }))
  expect(document.body.textContent).toContain('仍然保留的当前回复')
})

it.each(['chat', 'unrelated'])('completes a pending switch when deleting %s', async id => {
  data.conversations[0].messages = [{ id: 'old', role: 'assistant', text: '切换前的旧内容', time: '现在' }]
  await mount()
  const pending = deferred<Awaited<ReturnType<MurasameApi['core']['getBootstrap']>>>()
  vi.mocked(api.core.getBootstrap).mockReturnValue(pending.promise)
  await act(async () => emit('active', { id: 'next' }))
  await act(async () => emit('deleted', { id, activeConversationId: 'next' }))
  if (id === 'chat') expect(document.body.textContent).not.toContain('切换前的旧内容')
  const next = { ...data.conversations[0], id: 'next', messages: [{ id: 'new', role: 'assistant' as const, text: '目标会话的新内容', time: '现在' }] }
  await act(async () => pending.resolve({ ok: true, data: { ...data, activeConversationId: 'next', conversations: [next] } }))
  expect(document.body.textContent).toContain('目标会话的新内容')
  expect(document.body.textContent).not.toContain('切换前的旧内容')
})

it.each([false, true])('keeps a new draft after deleting a pending send, successful result: %s', async success => {
  const pending = deferred<Awaited<ReturnType<MurasameApi['core']['sendMessage']>>>()
  api.core.sendMessage = () => pending.promise
  await mount()
  await act(async () => emit('focus', undefined))
  const input = screen.getByRole('textbox', { name: '对桌宠说' }) as HTMLTextAreaElement
  fireEvent.change(input, { target: { value: '被删会话中的旧请求' } })
  await act(async () => { fireEvent.submit(input.closest('form')!) })
  await act(async () => emit('deleted', { id: 'chat', activeConversationId: null }))
  fireEvent.change(input, { target: { value: '删除后的新草稿' } })
  const old = { ...data.conversations[0], messages: [{ id: 'late', role: 'assistant' as const, text: '被删会话中的旧回复', time: '现在' }] }
  await act(async () => pending.resolve(success ? { ok: true, data: old } : { ok: false, error: '旧请求失败' }))
  expect(input.value).toBe('删除后的新草稿')
  expect(document.body.textContent).not.toContain('被删会话中的旧回复')
  expect(document.body.textContent).not.toContain('旧请求失败')
})

it.each([false, true])('initializes saved settings despite a deleted pending bootstrap; newer settings: %s', async newer => {
  const pending = deferred<Awaited<ReturnType<MurasameApi['core']['getBootstrap']>>>()
  vi.mocked(api.core.getBootstrap).mockReturnValue(pending.promise)
  data.settings.fileApproval = 'allow'
  await mount()
  await act(async () => emit('deleted', { id: 'chat', activeConversationId: null }))
  if (newer) await act(async () => emit('settings', { ...data.settings, fileApproval: 'ask' }))
  await act(async () => pending.resolve({ ok: true, data }))
  await act(async () => emit('focus', undefined))
  expect(screen.getByRole('button', { name: newer ? '询问' : '写图免问' }).getAttribute('aria-pressed')).toBe('true')
})

it.each([false, true])('ignores a pending create after deletion; successful result: %s', async success => {
  const pending = deferred<Awaited<ReturnType<MurasameApi['core']['createConversation']>>>()
  const old = data.conversations[0]
  data.conversations = []; data.activeConversationId = null
  api.core.createConversation = () => pending.promise
  api.core.sendMessage = vi.fn()
  await mount()
  await act(async () => emit('focus', undefined))
  const input = screen.getByRole('textbox', { name: '对桌宠说' }) as HTMLTextAreaElement
  fireEvent.change(input, { target: { value: '创建中的请求' } })
  await act(async () => { fireEvent.submit(input.closest('form')!) })
  await act(async () => emit('deleted', { id: old.id, activeConversationId: null }))
  fireEvent.change(input, { target: { value: '新草稿' } })
  await act(async () => pending.resolve(success ? { ok: true, data: old } : { ok: false, error: '过时的创建失败' }))
  expect(input.value).toBe('新草稿')
  expect(document.body.textContent).not.toContain('过时的创建失败')
  expect(api.core.sendMessage).not.toHaveBeenCalled()
})

it('sends a first message when its own create broadcasts arrive before the result', async () => {
  const created = data.conversations[0]
  data.conversations = []; data.activeConversationId = null
  api.core.createConversation = async () => {
    emit('updated', created); emit('active', { id: created.id })
    return { ok: true, data: created }
  }
  api.core.sendMessage = vi.fn(async () => ({ ok: true as const, data: created }))
  await mount()
  await act(async () => emit('focus', undefined))
  const input = screen.getByRole('textbox', { name: '对桌宠说' })
  fireEvent.change(input, { target: { value: '新的首条请求' } })
  await act(async () => { fireEvent.submit(input.closest('form')!) })
  expect(api.core.sendMessage).toHaveBeenCalledWith(created.id, '新的首条请求')
})

it('shows offline creation progress without a VNC URL, allows cleanup retry, and removes stopped residue', async () => {
  await mount()
  expect(screen.getByTestId('pet-isolation-progress').textContent).toContain('正在运行代码')
  expect(screen.getByTestId('live2d-activity').getAttribute('data-motion')).toBe('WorkingLoop')
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '结束活动' })) })
  expect(screen.getByRole('button', { name: '结束活动' }).matches(':disabled')).toBe(false)
  expect(document.body.textContent).toContain('清理失败，可以重试')
  await act(async () => emit('autonomy', { ...active, phase: 'stopped', running: false, canStop: false, busy: false, creation: { phase: 'ready', message: '残留结果' } }))
  expect(screen.queryByTestId('pet-isolation-progress')).toBeNull()
  expect(screen.getByTestId('live2d-activity').getAttribute('data-motion')).toBe('none')
})

it('gives confirmation priority over sending and sending priority over isolated execution', async () => {
  await mount()
  const pending = { id: 'approval', title: '需要确认', status: '待确认', summary: '确认范围', result: '', approval: null } as Task
  await act(async () => { emit('task', pending); emit('started', { conversationId: 'chat', userText: '新的请求' }) })
  expect(document.querySelector('.pet-stage')?.getAttribute('data-work-source')).toBe('task')
  await act(async () => emit('task', { ...pending, status: '已取消' }))
  expect(document.querySelector('.pet-stage')?.getAttribute('data-work-source')).toBe('chat')
  await act(async () => emit('failed', { conversationId: 'chat', error: '模型未返回' }))
  expect(document.querySelector('.pet-stage')?.getAttribute('data-work-source')).toBe('autonomy')
})

it('does not send built-in work motions to an imported model', async () => {
  await mount()
  await act(async () => emit('pet', { ...pet, importedModelUrl: 'file:///synthetic/model.model3.json' }))
  expect(screen.getByTestId('pet-isolation-progress').textContent).toContain('正在运行代码')
  expect(screen.getByTestId('live2d-activity').getAttribute('data-motion')).toBe('none')
})

it('does not let an older bootstrap remove a newer approval event', async () => {
  const bootstrap = deferred<Awaited<ReturnType<MurasameApi['core']['getBootstrap']>>>()
  vi.mocked(api.core.getBootstrap).mockReturnValue(bootstrap.promise)
  await mount()
  await act(async () => emit('task', { id: 'late-approval', title: '新到确认', status: '待确认', summary: '新的确认范围', result: '', approval: null }))
  expect(document.querySelector('.pet-stage')?.getAttribute('data-work-source')).toBe('task')
  await act(async () => bootstrap.resolve({ ok: true, data }))
  expect(document.querySelector('.pet-stage')?.getAttribute('data-work-source')).toBe('task')
  expect(document.body.textContent).toContain('新的确认范围')
})

it('can stop an isolated activity while an unrelated task approval is pending', async () => {
  const approval = deferred<Awaited<ReturnType<MurasameApi['core']['approveTask']>>>()
  api.core.approveTask = vi.fn(() => approval.promise)
  await mount()
  await act(async () => emit('task', { id: 'slow-task', title: '另一件事', status: '等待批准', summary: '确认另一件事', result: '', approval: { target: '独立测试目录', impact: '只处理合成资料', tool: 'filesystem' } }))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '允许' })) })
  const blocked = screen.getByRole('button', { name: '结束活动' }).matches(':disabled')
  await act(async () => approval.resolve({ ok: false, error: '独立测试审批结束' }))
  expect(blocked).toBe(false)
})
