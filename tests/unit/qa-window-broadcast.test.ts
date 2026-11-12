import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ throwOnSend: false, created: 0, petVisible: true }))

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  class BrowserWindow extends EventEmitter {
    destroyed = false
    visible = false
    webContents = Object.assign(new EventEmitter(), {
      send: vi.fn(() => { if (state.throwOnSend) throw new Error('Render frame was disposed before WebFrameMain could be accessed') }),
      setWindowOpenHandler() {},
      getURL: () => 'murasame://app'
    })
    constructor() { super(); state.created += 1 }
    isDestroyed() { return this.destroyed }
    isVisible() { return this.visible }
    isMinimized() { return false }
    show() { this.visible = true }
    showInactive() { this.visible = true }
    hide() { this.visible = false; this.emit('hide') }
    focus() {}
    restore() {}
    minimize() {}
    getPosition() { return [0, 0] }
    getBounds() { return { x: 0, y: 0, width: 360, height: 500 } }
    setBounds() {}
    loadURL() {}
    setMenuBarVisibility() {}
    setAlwaysOnTop() {}
    setVisibleOnAllWorkspaces() {}
    setIgnoreMouseEvents() {}
  }
  return {
    BrowserWindow,
    app: { isPackaged: true, getAppPath: () => 'C:\\test\\app' },
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
  getSettings: () => ({ petScale: 1, petVisible: state.petVisible, petPreset: 'naiwa', closeBehavior: 'hide', minimizeToTray: false, onboardingDone: true, importedModelUrl: '' }),
  getWindowBounds: () => undefined,
  getSavedPetPosition: () => undefined,
  saveWindowBounds: vi.fn(),
  savePetPosition: vi.fn(),
  updateSettings: vi.fn((patch: Record<string, unknown>) => { if (typeof patch.petVisible === 'boolean') state.petVisible = patch.petVisible; return patch })
}))
vi.mock('../../src/main/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('../../src/main/app-state', () => ({ isQuitting: () => false, markQuitting: vi.fn(), quitApplication: vi.fn() }))

beforeEach(() => {
  vi.resetModules()
  state.throwOnSend = false
  state.created = 0
  state.petVisible = true
  Object.defineProperty(process, 'resourcesPath', { configurable: true, value: process.cwd() })
})

type WindowsModule = typeof import('../../src/main/windows')

async function petWindowOf(module: WindowsModule) {
  const pet = module.createPetWindow()
  return pet
}

describe('[QA-WIN-00] 窗口生命周期与广播的失败隔离', () => {
  it('[QA-WIN-01] 渲染进程 webContents 不可用时广播桌宠状态不抛异常', async () => {
    const windows = await import('../../src/main/windows')
    await petWindowOf(windows)
    state.throwOnSend = true
    expect(() => windows.refreshPetState()).not.toThrow()
    const safe = windows.getPetStateSafe()
    expect(safe.visible).toBe(true)
  })

  it('[QA-WIN-02] 表现事件发送失败不应让任务/对话回调崩溃', async () => {
    const windows = await import('../../src/main/windows')
    await petWindowOf(windows)
    state.throwOnSend = true
    expect(() => windows.broadcastPetPerformance({ intent: '开心', motion: null, expression: null, degraded: false, pad: {}, text: '任务已完成' })).not.toThrow()
    expect(() => windows.focusPetChat()).not.toThrow()
  })

  it('[QA-WIN-03] 重复显示主窗口只创建一次，不会派生多个窗口', async () => {
    const windows = await import('../../src/main/windows')
    windows.showMain()
    windows.showMain()
    windows.hideMain()
    windows.showMain()
    expect(state.created).toBe(1)
  })

  it('[QA-WIN-04] 窗口导航只允许白名单页面，其它路径不触发跳转', async () => {
    const windows = await import('../../src/main/windows')
    const main = windows.createMainWindow()
    windows.openMainPath('/settings?focus=task-1')
    expect(main.webContents.send).toHaveBeenCalledWith('window:navigated', '/settings?focus=task-1')
    vi.mocked(main.webContents.send).mockClear()
    windows.openMainPath('C:\\Windows\\System32\\cmd.exe')
    windows.openMainPath('/../../etc/passwd')
    windows.openMainPath('murasame://app/settings')
    expect(main.webContents.send).not.toHaveBeenCalled()
  })

  it('[QA-WIN-05] 桌宠窗口关闭后查询状态返回不可见而不是崩溃', async () => {
    const windows = await import('../../src/main/windows')
    const pet = await petWindowOf(windows)
    ;(pet as unknown as { destroyed: boolean }).destroyed = true
    pet.emit('closed')
    expect(windows.getPetWindow()).toBeNull()
    expect(windows.getPetStateSafe().visible).toBe(false)
    expect(() => windows.hidePet()).not.toThrow()
  })
})
