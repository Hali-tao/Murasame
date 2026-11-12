// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MurasameApi, Result } from '../../src/shared/types'
import { initialBootstrap } from '../../src/shared/mock-data'
import { resetStoreForTests, useAppStore } from '../../src/renderer/src/store'

function createApi(): MurasameApi {
  const bootstrap = initialBootstrap()
  return {
    app: {
      getInfo: vi.fn(async () => ({
        version: '0.9.0-test',
        platform: 'win32',
        isPackaged: false,
        logsPath: 'C:\\logs',
        userDataPath: 'C:\\user-data'
      })),
      quit: vi.fn(async () => undefined),
      hideToTray: vi.fn(async () => undefined),
      openLogs: vi.fn(async () => undefined),
      openUserData: vi.fn(async () => undefined),
      clearLogs: vi.fn(async () => undefined)
    },
    window: {
      showMain: vi.fn(async () => undefined),
      hideMain: vi.fn(async () => undefined),
      minimize: vi.fn(async () => undefined),
      openPath: vi.fn(async () => undefined),
      onNavigated: vi.fn(() => () => undefined)
    },
    pet: {
      show: vi.fn(async () => ({ visible: true, scale: 0.9, x: 0, y: 0, preset: 'tororo' as const })),
      hide: vi.fn(async () => ({ visible: false, scale: 0.9, x: 0, y: 0, preset: 'tororo' as const })),
      toggle: vi.fn(async () => ({ visible: true, scale: 0.9, x: 0, y: 0, preset: 'tororo' as const })),
      getState: vi.fn(async () => ({ visible: true, scale: 0.9, x: 0, y: 0, preset: 'tororo' as const })),
      setScale: vi.fn(async (scale: number) => ({ visible: true, scale, x: 0, y: 0, preset: 'tororo' as const })),
      setPosition: vi.fn(async (x: number, y: number) => ({ visible: true, scale: 0.9, x, y, preset: 'tororo' as const })),
      setIgnoreMouseEvents: vi.fn(async () => undefined),
      getBounds: vi.fn(async () => ({ x: 0, y: 0, width: 360, height: 500 })),
      resetPosition: vi.fn(async () => ({ visible: true, scale: 0.9, x: 0, y: 0, preset: 'tororo' as const })),
      onStateChanged: vi.fn(() => () => undefined),
      onPerformance: vi.fn(() => () => undefined),
      setChatOpen: vi.fn(async () => ({ open: true, side: 'right' as const })),
      beginDrag: vi.fn(async () => undefined),
      dragMove: vi.fn(async () => undefined),
      endDrag: vi.fn(async () => undefined),
      onFocusChat: vi.fn(() => () => undefined)
    },
    settings: {
      get: vi.fn(async () => bootstrap.settings),
      update: vi.fn(async (patch) => ({ ...bootstrap.settings, ...patch })),
      onChanged: vi.fn(() => () => undefined)
    },
    updates: {
      check: vi.fn(async () => ({ status: 'disabled' as const, message: '未配置更新源' }))
    },
    events: {
      onMessageDelta: vi.fn(() => () => undefined),
      onMessageStarted: vi.fn(() => () => undefined),
      onMessageFailed: vi.fn(() => () => undefined),
      onConversationUpdated: vi.fn(() => () => undefined),
      onActiveConversation: vi.fn(() => () => undefined),
      onTaskUpdated: vi.fn(() => () => undefined)
    },
    core: {
      getBootstrap: vi.fn(async (): Promise<Result<typeof bootstrap>> => ({ ok: true, data: initialBootstrap() })),
      createConversation: vi.fn(),
      sendMessage: vi.fn(async (conversationId: string, text: string) => {
        const conversation = initialBootstrap().conversations.find((item) => item.id === conversationId)!
        conversation.messages.push({ id: 'msg-user', role: 'user', text, time: '刚刚' })
        conversation.messages.push({ id: 'msg-assistant', role: 'assistant', text: '收到。', time: '刚刚' })
        return { ok: true as const, data: conversation }
      }),
      deleteConversation: vi.fn(),
      addMemory: vi.fn(async (category: string, text: string) => ({
        ok: true as const,
        data: { id: 'memory-test', category, text, source: '手动添加', updated: '刚刚' }
      })),
      updateMemory: vi.fn(),
      deleteMemory: vi.fn(),
      clearMemories: vi.fn(),
      createTask: vi.fn(),
      approveTask: vi.fn(),
      cancelTask: vi.fn(),
      setToolEnabled: vi.fn(),
      verifyModel: vi.fn(),
      createModel: vi.fn(),
      saveModel: vi.fn(),
      setDefaultModel: vi.fn(),
      saveCharacter: vi.fn(),
      analyzeScreen: vi.fn()
    }
  } as unknown as MurasameApi
}

describe('Zustand app store', () => {
  let api: MurasameApi

  beforeEach(() => {
    vi.useFakeTimers()
    resetStoreForTests()
    api = createApi()
    Object.defineProperty(window, 'murasame', { configurable: true, value: api })
  })

  it('initializes bootstrap data and the first selections', async () => {
    await useAppStore.getState().init()
    const state = useAppStore.getState()
    expect(state.loading).toBe(false)
    expect(state.startupError).toBeNull()
    expect(state.data?.conversations.length).toBeGreaterThan(0)
    expect(state.selectedConversationId).toBe(state.data?.conversations[0].id)
    expect(state.selectedTaskId).toBe(state.data?.tasks[0].id)
    expect(state.info?.version).toBe('0.9.0-test')
  })

  it('updates a conversation after sending a message', async () => {
    await useAppStore.getState().init()
    const conversation = useAppStore.getState().data!.conversations[0]
    const updated = await useAppStore.getState().sendMessage(conversation.id, '新的问题')
    const current = useAppStore.getState().data!.conversations.find((item) => item.id === conversation.id)
    expect(updated?.messages.at(-1)?.text).toBe('收到。')
    expect(current?.messages.at(-1)?.text).toBe('收到。')
    expect(useAppStore.getState().busy['chat:send']).toBe(false)
  })

  it('adds memory entries and visibly updates settings', async () => {
    await useAppStore.getState().init()
    const memory = await useAppStore.getState().addMemory('偏好', '回答简洁')
    expect(memory?.id).toBe('memory-test')
    expect(useAppStore.getState().data?.memories[0].text).toBe('回答简洁')

    const saved = await useAppStore.getState().updateSettings({ doNotDisturb: false })
    expect(saved).toBe(true)
    expect(useAppStore.getState().data?.settings.doNotDisturb).toBe(false)
  })

  it('[QA-IPC-11] 导入数据包后 reloadData 让恢复的记忆立即出现（不需要重启）', async () => {
    await useAppStore.getState().init()
    expect(useAppStore.getState().data?.memories.some((item) => item.text === '恢复的记忆')).toBe(false)

    const restored = initialBootstrap()
    restored.memories = [
      ...restored.memories,
      { id: 'imported-memory', category: '偏好', text: '恢复的记忆', source: '导入', updated: '有效' }
    ]
    vi.mocked(api.core.getBootstrap).mockResolvedValueOnce({ ok: true, data: restored })

    await useAppStore.getState().reloadData()
    expect(useAppStore.getState().data?.memories.some((item) => item.text === '恢复的记忆')).toBe(true)
    // 设置以当前内存状态为准，不被 reload 覆盖。
    expect(useAppStore.getState().data?.settings).toEqual(restored.settings)
  })

  it('[QA-IPC-12] reloadData 失败时如实提示，不把旧数据假装成最新', async () => {
    await useAppStore.getState().init()
    const before = useAppStore.getState().data?.memories.length
    vi.mocked(api.core.getBootstrap).mockResolvedValueOnce({ ok: false, error: '数据库暂时不可用' })

    await useAppStore.getState().reloadData()
    expect(useAppStore.getState().data?.memories.length).toBe(before)
    expect(useAppStore.getState().toasts.some((toast) => toast.message === '数据库暂时不可用')).toBe(true)
  })
})
