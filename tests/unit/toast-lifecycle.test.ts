// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MurasameApi, ModelProfile } from '../../src/shared/types'
import { initialBootstrap } from '../../src/shared/mock-data'
import { resetStoreForTests, useAppStore } from '../../src/renderer/src/store'

describe('notification lifecycle', () => {
  let model: ModelProfile

  beforeEach(() => {
    vi.useFakeTimers()
    resetStoreForTests()
    const data = initialBootstrap()
    model = { ...data.models[0], id: 'notification-model', name: '独立通知测试服务', status: '在线', latency: '40 ms', default: true, probeNote: '' }
    data.models = [model]
    useAppStore.setState({ data, loading: false })
    Object.defineProperty(window, 'murasame', {
      configurable: true,
      value: {
        core: {
          createModel: vi.fn(async () => ({ ok: true, data: model })),
          verifyModel: vi.fn(async () => ({ ok: true, data: model })),
          setDefaultModel: vi.fn(async () => ({ ok: true, data: [model] }))
        }
      } as unknown as MurasameApi
    })
  })

  afterEach(() => {
    resetStoreForTests()
    vi.useRealTimers()
  })

  it('combines the create, verify and activate flow into one complete model result', async () => {
    await useAppStore.getState().createModel()
    await useAppStore.getState().verifyModel(model.id)
    await useAppStore.getState().setDefaultModel(model.id)
    const toasts = useAppStore.getState().toasts
    expect(toasts).toHaveLength(1)
    expect(toasts[0].message).toContain('独立通知测试服务')
    expect(toasts[0].message).toContain('已验证')
    expect(toasts[0].message).toContain('当前服务')
    expect(toasts[0].message).toContain('40 ms')
  })

  it('keeps an activation failure visible after transient successes expire', async () => {
    vi.mocked(window.murasame.core.setDefaultModel).mockResolvedValue({ ok: false, error: '独立测试：保存当前服务失败' })
    await useAppStore.getState().verifyModel(model.id)
    expect(await useAppStore.getState().setDefaultModel(model.id)).toBe(false)
    vi.advanceTimersByTime(60_000)
    expect(useAppStore.getState().toasts).toMatchObject([{ tone: 'red', message: '独立测试：保存当前服务失败' }])
  })

  it('limits routine results while retaining every distinct error and warning until closed', () => {
    const { notify } = useAppStore.getState()
    notify('目录需要确认', 'amber')
    for (let index = 0; index < 5; index += 1) notify(`保存失败 ${index}`, 'red')
    for (let index = 0; index < 10; index += 1) notify(`已保存 ${index}`)
    expect(useAppStore.getState().toasts.filter(toast => toast.tone === 'green').length).toBeLessThanOrEqual(2)
    vi.advanceTimersByTime(60_000)
    expect(useAppStore.getState().toasts.map(toast => toast.message)).toEqual(['目录需要确认', '保存失败 0', '保存失败 1', '保存失败 2', '保存失败 3', '保存失败 4'])
    const warning = useAppStore.getState().toasts[0]
    useAppStore.getState().dismissToast(warning.id)
    expect(useAppStore.getState().toasts.some(toast => toast.id === warning.id)).toBe(false)
  })

  it('merges repeated identical notices and gives the latest occurrence a full reading interval', () => {
    useAppStore.getState().notify('记忆已添加')
    vi.advanceTimersByTime(3000)
    useAppStore.getState().notify('记忆已添加')
    expect(useAppStore.getState().toasts).toHaveLength(1)
    vi.advanceTimersByTime(2500)
    expect(useAppStore.getState().toasts).toHaveLength(1)
    vi.advanceTimersByTime(6000)
    expect(useAppStore.getState().toasts).toHaveLength(0)
  })

  it('does not let a replacement model result inherit an earlier expiry', async () => {
    await useAppStore.getState().createModel()
    vi.advanceTimersByTime(3000)
    await useAppStore.getState().verifyModel(model.id)
    vi.advanceTimersByTime(3000)
    await useAppStore.getState().setDefaultModel(model.id)
    vi.advanceTimersByTime(2500)
    expect(useAppStore.getState().toasts).toHaveLength(1)
    expect(useAppStore.getState().toasts[0].message).toContain('当前服务')
  })

  it('uses the selected model note rather than a different saved model note', async () => {
    const other = { ...model, id: 'other', default: false, probeNote: '其他服务的旧探测提示' }
    model.probeNote = '当前服务的探测提示'
    vi.mocked(window.murasame.core.setDefaultModel).mockResolvedValue({ ok: true, data: [other, model] })
    await useAppStore.getState().setDefaultModel(model.id)
    expect(useAppStore.getState().toasts[0].message).toContain('当前服务的探测提示')
    expect(useAppStore.getState().toasts[0].message).not.toContain('其他服务的旧探测提示')
  })
})
