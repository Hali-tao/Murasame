import { beforeEach, expect, it, vi } from 'vitest'

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  class BrowserWindow extends EventEmitter {
    visible = true
    webContents = Object.assign(new EventEmitter(), { send: vi.fn(), setWindowOpenHandler() {}, getURL: () => 'murasame://app' })
    isDestroyed() { return false }
    isVisible() { return this.visible }
    isMinimized() { return false }
    hide() { this.visible = false; this.emit('hide') }
    getPosition() { return [0, 0] }
    loadURL() {}
    setMenuBarVisibility() {}
    setAlwaysOnTop() {}
    setVisibleOnAllWorkspaces() {}
    setIgnoreMouseEvents() {}
  }
  return {
    BrowserWindow,
    app: { isPackaged: true },
    nativeImage: { createFromPath: () => ({}) },
    shell: { openExternal: vi.fn() },
    dialog: { showMessageBox: vi.fn() },
    screen: { getCursorScreenPoint: () => ({ x: 0, y: 0 }), getAllDisplays: () => [{ id: 1, scaleFactor: 1, workArea: { x: 0, y: 0, width: 1920, height: 1080 } }] }
  }
})
vi.mock('../../src/main/settings', () => ({
  getSettings: () => ({ petScale: 1, petVisible: true, petPreset: 'naiwa', closeBehavior: 'hide', minimizeToTray: false }),
  getWindowBounds: () => undefined, getSavedPetPosition: () => undefined,
  saveWindowBounds: vi.fn(), savePetPosition: vi.fn(), updateSettings: vi.fn()
}))
vi.mock('../../src/main/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('../../src/main/app-state', () => ({ isQuitting: () => false, markQuitting: vi.fn(), quitApplication: vi.fn() }))

beforeEach(() => {
  vi.resetModules()
  Object.defineProperty(process, 'resourcesPath', { configurable: true, value: process.cwd() })
})

it('[FR-27] hiding either native window tells its recording owner to stop', async () => {
  const { createMainWindow, createPetWindow, hideMain, hidePet } = await import('../../src/main/windows')
  const main = createMainWindow(); const pet = createPetWindow()
  hideMain()
  expect(main.webContents.send).toHaveBeenCalledWith('window:hidden')
  expect(pet.webContents.send).not.toHaveBeenCalledWith('window:hidden')
  hidePet()
  expect(pet.webContents.send).toHaveBeenCalledWith('window:hidden')
})

it('[FR-27] closing to tray and native minimization also stop voice input', async () => {
  const { createMainWindow, createPetWindow } = await import('../../src/main/windows')
  const main = createMainWindow(); const pet = createPetWindow()
  main.emit('minimize')
  expect(main.webContents.send).toHaveBeenCalledWith('window:hidden')
  vi.mocked(main.webContents.send).mockClear()
  main.emit('close', { preventDefault() {} })
  pet.emit('close', { preventDefault() {} })
  expect(main.webContents.send).toHaveBeenCalledWith('window:hidden')
  expect(pet.webContents.send).toHaveBeenCalledWith('window:hidden')
})
