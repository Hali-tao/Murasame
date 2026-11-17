// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { SettingsPage } from '../../src/renderer/src/pages/SettingsPage'
import { resetStoreForTests, useAppStore } from '../../src/renderer/src/store'
import { initialBootstrap } from '../../src/shared/mock-data'
import type { DeleteScope, MurasameApi } from '../../src/shared/types'

let api: MurasameApi
beforeEach(() => {
  resetStoreForTests()
  const data = initialBootstrap()
  data.conversations = ['a', 'b'].map(id => ({ id, title: `会话${id}`, time: '', preview: '', count: 0, pinned: false, messages: [] }))
  data.memories = [{ id: 'm', text: '保留白茶', category: '偏好', source: 'a', updated: '' }]
  useAppStore.setState({ data, loading: false, selectedConversationId: 'b' })
  api = {
    app: { hotkey: async () => 'Ctrl+Alt+M', screenHotkey: async () => 'Ctrl+Alt+Q 已注册，可触发屏幕辅助', clearLogs: vi.fn(async () => undefined) },
    voice: { readiness: async () => ({ detail: '独立测试' }) },
    core: {
      clearMemories: vi.fn(async () => ({ ok: false, error: '受控记忆写入失败' })),
      deleteConversation: vi.fn(async () => ({ ok: true, data: [] }))
    }
  } as unknown as MurasameApi
  Object.defineProperty(window, 'murasame', { configurable: true, value: api })
})
afterEach(() => { cleanup(); resetStoreForTests(); vi.restoreAllMocks() })

async function clear(scopes: DeleteScope[]) {
  await act(async () => { render(createElement(SettingsPage)) })
  fireEvent.click(screen.getByTestId('clear-data'))
  const dialog = within(screen.getByRole('dialog'))
  const labels = { history: '对话历史', memory: '相关长期记忆', cache: '本地缓存', logs: '运行日志' }
  for (const [scope, label] of Object.entries(labels)) {
    const checkbox = dialog.getByRole('checkbox', { name: new RegExp(label) }) as HTMLInputElement
    if (checkbox.checked !== scopes.includes(scope as DeleteScope)) fireEvent.click(checkbox)
  }
  await act(async () => { fireEvent.click(dialog.getByRole('button', { name: '执行清除' })) })
}

it('[FR-15] retains actual memory and reports failure when settings memory clearing fails', async () => {
  await clear(['memory'])
  expect(useAppStore.getState().data?.memories.map(item => item.text)).toEqual(['保留白茶'])
  expect(useAppStore.getState().toasts.some(toast => toast.tone === 'red' && toast.message.includes('记忆'))).toBe(true)
  expect(useAppStore.getState().toasts.some(toast => toast.message === '已按所选范围清除本地数据')).toBe(false)
  expect(screen.queryByRole('dialog')).not.toBeNull()
})

it('[FR-15] keeps failed histories and the selected survivor after partial clearing', async () => {
  const survivor = useAppStore.getState().data!.conversations[1]
  api.core.deleteConversation = vi.fn<MurasameApi['core']['deleteConversation']>(async id => id === 'a'
    ? { ok: true, data: [survivor] } : { ok: false, error: '受控历史写入失败' })
  await clear(['history'])
  expect(useAppStore.getState().data?.conversations.map(item => item.id)).toEqual(['b'])
  expect(useAppStore.getState().selectedConversationId).toBe('b')
  expect(useAppStore.getState().data?.memories).toHaveLength(1)
  expect(useAppStore.getState().toasts.some(toast => toast.tone === 'red' && toast.message.includes('历史'))).toBe(true)
})

it('[FR-15] actually clears only the selected cache range even when no conversation exists', async () => {
  useAppStore.setState(state => ({ data: { ...state.data!, conversations: [] }, selectedConversationId: null }))
  await clear(['cache'])
  expect(api.core.deleteConversation).toHaveBeenCalledWith('none', ['cache'])
  expect(api.core.clearMemories).not.toHaveBeenCalled()
  expect(api.app.clearLogs).not.toHaveBeenCalled()
  expect(useAppStore.getState().data?.memories).toHaveLength(1)
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('updates successful memory clearing even if a different selected scope throws', async () => {
  api.app.clearLogs = vi.fn(async () => { throw new Error('受控日志锁定') })
  api.core.clearMemories = vi.fn<MurasameApi['core']['clearMemories']>(async () => ({ ok: true, data: [] }))
  await clear(['memory', 'logs'])
  expect(useAppStore.getState().data?.memories).toEqual([])
  expect(useAppStore.getState().data?.conversations).toHaveLength(2)
  expect(useAppStore.getState().selectedConversationId).toBe('b')
  expect(useAppStore.getState().toasts.some(toast => toast.tone === 'red' && toast.message.includes('部分内容已清除') && toast.message.includes('受控日志锁定'))).toBe(true)
  expect(screen.queryByRole('dialog')).not.toBeNull()
})

it('preserves a conversation created during history clearing and only deletes the starting set', async () => {
  const before = useAppStore.getState().data!.conversations
  const created = { ...before[0], id: 'new', title: '清理期间的新会话' }
  api.core.deleteConversation = vi.fn<MurasameApi['core']['deleteConversation']>(async id => ({ ok: true, data: id === 'a' ? [created, before[1]] : [created] }))
  await clear(['history'])
  expect(vi.mocked(api.core.deleteConversation).mock.calls.map(call => call[0])).toEqual(['a', 'b'])
  expect(useAppStore.getState().data?.conversations.map(item => item.id)).toEqual(['new'])
  expect(useAppStore.getState().selectedConversationId).toBe('new')
  expect(screen.queryByRole('dialog')).toBeNull()
})
