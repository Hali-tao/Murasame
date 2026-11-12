import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  reloads: 0,
  quitting: false,
  destroyWindow: false
}))

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  class BrowserWindow extends EventEmitter {
    destroyed = false
    visible = false
    webContents = Object.assign(new EventEmitter(), {
      id: 7,
      reload: vi.fn(() => {
        h.reloads += 1
      }),
      isCrashed: () => false,
      isDestroyed: () => false,
      getURL: () => 'murasame://app/index.html',
      send: vi.fn(),
      setWindowOpenHandler() {},
      openDevTools() {}
    })
    constructor() {
      super()
    }
    isDestroyed() {
      return this.destroyed || h.destroyWindow
    }
    isVisible() {
      return this.visible
    }
    isMinimized() {
      return false
    }
    show() {
      this.visible = true
    }
    showInactive() {
      this.visible = true
    }
    hide() {
      this.visible = false
      this.emit('hide')
    }
    focus() {}
    restore() {}
    minimize() {}
    getPosition() {
      return [0, 0]
    }
    getBounds() {
      return { x: 0, y: 0, width: 1400, height: 880 }
    }
    setBounds() {}
    loadURL() {}
    setMenuBarVisibility() {}
    setAlwaysOnTop() {}
    setVisibleOnAllWorkspaces() {}
    setIgnoreMouseEvents() {}
  }
  return {
    BrowserWindow,
    app: { isPackaged: true, getAppPath: () => 'C:\\test\\app', getVersion: () => '0.0.0' },
    nativeImage: { createFromPath: () => ({ resize: () => ({}) }) },
    shell: { openExternal: vi.fn() },
    dialog: { showMessageBox: vi.fn(async () => ({ response: 1 })) },
    screen: {
      getCursorScreenPoint: () => ({ x: 10, y: 10 }),
      getAllDisplays: () => [{ id: 1, scaleFactor: 1, workArea: { x: 0, y: 0, width: 1920, height: 1080 } }]
    }
  }
})
vi.mock('../../src/main/settings', () => ({
  getSettings: () => ({ petScale: 1, petVisible: false, petPreset: 'naiwa', closeBehavior: 'hide', minimizeToTray: false, onboardingDone: true, importedModelUrl: '' }),
  getWindowBounds: () => undefined,
  getSavedPetPosition: () => undefined,
  saveWindowBounds: vi.fn(),
  savePetPosition: vi.fn(),
  updateSettings: vi.fn()
}))
vi.mock('../../src/main/app-state', () => ({
  isQuitting: () => h.quitting,
  markQuitting: vi.fn(),
  quitApplication: vi.fn()
}))
vi.mock('../../src/main/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('../../src/main/security/hardening', () => ({ hardenWebContents: vi.fn() }))

type WindowsModule = typeof import('../../src/main/windows')

async function loadWindows(): Promise<WindowsModule> {
  vi.resetModules()
  return import('../../src/main/windows')
}

function crash(window: { webContents: { emit: (event: string, ...args: unknown[]) => boolean } }, reason = 'crashed'): void {
  window.webContents.emit('render-process-gone', {}, { reason })
}

describe('[QA-CRASH-00] 渲染进程崩溃后的自动恢复', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    h.reloads = 0
    h.quitting = false
    h.destroyWindow = false
    Object.defineProperty(process, 'resourcesPath', { configurable: true, value: process.cwd() })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('[QA-CRASH-01] 渲染进程崩溃后自动重新加载窗口', async () => {
    const windows = await loadWindows()
    const main = windows.createMainWindow()
    crash(main)
    expect(h.reloads).toBe(0)
    await vi.advanceTimersByTimeAsync(300)
    expect(h.reloads).toBe(1)
  })

  it('[QA-CRASH-02] 正常退出（clean-exit）不触发重新加载', async () => {
    const windows = await loadWindows()
    const main = windows.createMainWindow()
    crash(main, 'clean-exit')
    await vi.advanceTimersByTimeAsync(500)
    expect(h.reloads).toBe(0)
  })

  it('[QA-CRASH-03] 崩溃循环有上限：60 秒内第 4 次崩溃不再自动重载', async () => {
    const windows = await loadWindows()
    const main = windows.createMainWindow()
    for (let attempt = 0; attempt < 4; attempt += 1) {
      crash(main)
      await vi.advanceTimersByTimeAsync(300)
    }
    expect(h.reloads).toBe(3)
  })

  it('[QA-CRASH-04] 超过 60 秒窗口后再次崩溃可以恢复（计数会过期）', async () => {
    const windows = await loadWindows()
    const main = windows.createMainWindow()
    for (let attempt = 0; attempt < 3; attempt += 1) {
      crash(main)
      await vi.advanceTimersByTimeAsync(300)
    }
    expect(h.reloads).toBe(3)
    await vi.advanceTimersByTimeAsync(61_000)
    crash(main)
    await vi.advanceTimersByTimeAsync(300)
    expect(h.reloads).toBe(4)
  })

  it('[QA-CRASH-05] 正在退出时不自动重载', async () => {
    h.quitting = true
    const windows = await loadWindows()
    const main = windows.createMainWindow()
    crash(main)
    await vi.advanceTimersByTimeAsync(500)
    expect(h.reloads).toBe(0)
  })

  it('[QA-CRASH-06] 窗口已销毁时不自动重载', async () => {
    const windows = await loadWindows()
    const main = windows.createMainWindow()
    h.destroyWindow = true
    crash(main)
    await vi.advanceTimersByTimeAsync(500)
    expect(h.reloads).toBe(0)
  })

  it('[QA-CRASH-07] 桌宠窗口崩溃同样恢复', async () => {
    const windows = await loadWindows()
    const pet = windows.createPetWindow()
    crash(pet)
    await vi.advanceTimersByTimeAsync(300)
    expect(h.reloads).toBe(1)
  })
})
