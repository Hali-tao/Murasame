import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initialSettings } from '../../src/shared/default-settings'

const storage = vi.hoisted(() => ({ settings: undefined as unknown, writes: [] as unknown[] }))
vi.mock('electron-store', () => ({
  default: class {
    constructor(options: { defaults: { settings?: unknown } }) { storage.settings = structuredClone(options.defaults?.settings) }
    get(key: string) { return key === 'settings' ? structuredClone(storage.settings) : undefined }
    set(key: string, value: unknown) { if (key === 'settings') { storage.settings = structuredClone(value); storage.writes.push(value) } }
  }
}))

const { getSettings, onSettingsChanged, updateSettings } = await import('../../src/main/settings')

beforeEach(() => {
  storage.settings = structuredClone(initialSettings)
  storage.writes = []
})

describe('[QA-SET-00] 设置变更观察者的失败隔离', () => {
  it('[QA-SET-01] 一个设置监听器抛错不应阻止其他监听器收到最新设置', () => {
    const received: string[] = []
    const unsubscribeBroken = onSettingsChanged(() => { throw new Error('广播失败：渲染窗口已销毁') })
    const unsubscribeHealthy = onSettingsChanged((settings) => { received.push(settings.userName) })
    try {
      updateSettings({ userName: '测试用户' })
    } finally {
      unsubscribeBroken()
      unsubscribeHealthy()
    }
    expect(received).toEqual(['测试用户'])
  })

  it('[QA-SET-02] 设置监听器抛错时 updateSettings 仍完成持久化并返回新设置', () => {
    const unsubscribeBroken = onSettingsChanged(() => { throw new Error('广播失败：渲染窗口已销毁') })
    try {
      expect(() => updateSettings({ userName: '仍要保存' })).not.toThrow()
    } finally {
      unsubscribeBroken()
    }
    expect(getSettings().userName).toBe('仍要保存')
    expect((storage.writes.at(-1) as { userName: string }).userName).toBe('仍要保存')
  })

  it('[QA-SET-03] 更新嵌套权限时按字段合并，不清掉未提交的字段', () => {
    updateSettings({ permissions: { screen: true, microphone: true, accessibility: true } })
    updateSettings({ permissions: { screen: false, microphone: true, accessibility: false } })
    expect(getSettings().permissions).toEqual({ screen: false, microphone: true, accessibility: false })
  })

  it('[QA-SET-04] 更新设置只持久化一次并通知一次', () => {
    let notified = 0
    const unsubscribe = onSettingsChanged(() => { notified += 1 })
    try { updateSettings({ petScale: 1.2 }) } finally { unsubscribe() }
    expect(notified).toBe(1)
    expect(storage.writes).toHaveLength(1)
    expect(getSettings().petScale).toBe(1.2)
  })
  it('[QA-SET-05] 小剧场默认开启，关闭后写入设置并可恢复', () => {
    expect(getSettings().theaterEnabled).toBe(true)
    updateSettings({ theaterEnabled: false })
    expect(getSettings().theaterEnabled).toBe(false)
    expect((storage.writes.at(-1) as { theaterEnabled: boolean }).theaterEnabled).toBe(false)
    updateSettings({ theaterEnabled: true })
    expect(getSettings().theaterEnabled).toBe(true)
  })
})