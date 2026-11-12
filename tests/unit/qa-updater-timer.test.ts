import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  packaged: true,
  updateUrl: 'https://update.example.invalid/latest.yml',
  check: vi.fn(async (): Promise<{ updateInfo: { version: string } } | null> => null),
  setFeedURL: vi.fn(),
  on: vi.fn()
}))

vi.mock('electron', () => ({ app: { isPackaged: h.packaged, getVersion: () => '0.9.0' } }))
vi.mock('electron-updater', () => ({
  autoUpdater: {
    setFeedURL: (...args: unknown[]) => h.setFeedURL(...args),
    on: (...args: unknown[]) => h.on(...args),
    checkForUpdates: () => h.check(),
    autoDownload: false,
    autoInstallOnAppQuit: false,
    logger: null
  }
}))
vi.mock('../../src/main/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

beforeEach(() => {
  vi.resetModules()
  h.packaged = true
  h.check.mockReset().mockImplementation(async () => null)
  h.setFeedURL.mockReset()
  h.on.mockReset()
  process.env.MURASAME_UPDATE_URL = h.updateUrl
})

afterEach(() => {
  vi.useRealTimers()
  delete process.env.MURASAME_UPDATE_URL
})

describe('[QA-UPD-00] 自动更新定时器的生命周期', () => {
  it('[QA-UPD-01] 停止更新器后，启动时的延迟检查不应继续执行', async () => {
    vi.useFakeTimers()
    const updater = await import('../../src/main/updater')
    updater.initializeUpdater()
    updater.stopUpdater()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(h.check).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000)
    expect(h.check).not.toHaveBeenCalled()
  })

  it('[QA-UPD-02] 正常运行时延迟 10 秒检查一次更新，并按 6 小时间隔轮询', async () => {
    vi.useFakeTimers()
    const updater = await import('../../src/main/updater')
    updater.initializeUpdater()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(h.check).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000)
    expect(h.check).toHaveBeenCalledTimes(2)
    updater.stopUpdater()
  })

  it('[QA-UPD-03] 检查更新抛错时返回中文错误结果，不把异常抛给 IPC 调用方', async () => {
    h.check.mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND update.example.invalid'))
    const updater = await import('../../src/main/updater')
    const result = await updater.checkForUpdates()
    expect(result.status).toBe('error')
    expect(result.message).toContain('失败')
  })

  it('[QA-UPD-04] 未配置更新源时明确说明开关关闭，不发网络请求', async () => {
    delete process.env.MURASAME_UPDATE_URL
    const updater = await import('../../src/main/updater')
    const result = await updater.checkForUpdates()
    expect(result.status).toBe('disabled')
    expect(h.check).not.toHaveBeenCalled()
  })
})
