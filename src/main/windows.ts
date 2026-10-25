import { app, BrowserWindow, dialog, nativeImage, screen, shell } from 'electron'
import { join } from 'node:path'
import { isQuitting, markQuitting, quitApplication } from './app-state'
import { getPetState, getSettings, getWindowBounds, saveWindowBounds, savePetPosition, updateSettings } from './settings'
import { hardenWebContents } from './security/hardening'
import log from './logger'
import { choosePetChatSide, recoverPosition, resetAnchor, type WorkArea } from './desktop/placement'
import type { PetBounds, PetChatLayout, PetState } from '../shared/types'
import { IPC } from '../shared/ipc'

let mainWindow: BrowserWindow | null = null
let petWindow: BrowserWindow | null = null
let saveBoundsTimer: NodeJS.Timeout | null = null
let savePetTimer: NodeJS.Timeout | null = null
let petChatOpen = false
let petChatSide: 'left' | 'right' = 'right'

const PET_WIDTH = 360
const PET_HEIGHT = 500
const PET_CHAT_WIDTH = 300

const rendererUrl = process.env.ELECTRON_RENDERER_URL
const preload = join(__dirname, '../preload/index.js')

function displayAreas(): WorkArea[] {
  return screen.getAllDisplays().map((display) => ({
    id: String(display.id),
    x: display.workArea.x,
    y: display.workArea.y,
    width: display.workArea.width,
    height: display.workArea.height,
    scaleFactor: display.scaleFactor
  }))
}

function clampPetPosition(
  x: number,
  y: number,
  width: number,
  height: number
): { x: number; y: number } {
  const next = recoverPosition({ x, y, width, height }, displayAreas())
  return { x: next.x, y: next.y }
}

function resourcePath(name: string): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'resources', name)
    : join(app.getAppPath(), 'resources', name)
}

function icon() {
  return nativeImage.createFromPath(resourcePath('icon.png'))
}

function loadRenderer(window: BrowserWindow, page: 'index' | 'pet'): void {
  if (rendererUrl) {
    void window.loadURL(`${rendererUrl}/${page}.html`)
  } else {
    // A custom scheme keeps fetch()/CORS working for Live2D model assets in
    // production, whereas file:// would block runtime JSON and texture loads.
    void window.loadURL(`murasame://app/${page}.html`)
  }
}

function secureWebContents(window: BrowserWindow): void {
  if (!app.isPackaged) {
    window.webContents.on('console-message', (details) => {
      log.info(
        `[renderer:${details.level}] ${details.message} (${details.sourceId}:${details.lineNumber})`
      )
    })
    window.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
      if (isMainFrame) log.warn(`Renderer failed to load ${url}: ${code} ${description}`)
    })
  }
  hardenWebContents(window.webContents, shell.openExternal.bind(shell))
  window.webContents.on('render-process-gone', (_event, details) => {
    log.error('Renderer process gone', details.reason)
  })
}

function broadcastPetState(state: PetState): PetState {
  const windows = [mainWindow, petWindow].filter(
    (window): window is BrowserWindow => Boolean(window && !window.isDestroyed())
  )
  windows.forEach((window) => window.webContents.send(IPC.pet.stateChanged, state))
  return state
}

export function createMainWindow(): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow
  const stored = getWindowBounds()
  mainWindow = new BrowserWindow({
    width: stored?.width ?? 1400,
    height: stored?.height ?? 880,
    x: stored?.x,
    y: stored?.y,
    minWidth: 1180,
    minHeight: 740,
    show: false,
    backgroundColor: '#F4F1EB',
    title: 'Murasame · AI 桌面伙伴',
    icon: icon(),
    autoHideMenuBar: true,
    webPreferences: {
      preload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      devTools: !app.isPackaged,
      spellcheck: false
    }
  })

  secureWebContents(mainWindow)
  loadRenderer(mainWindow, 'index')
  mainWindow.setMenuBarVisibility(false)

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  const rememberBounds = (): void => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized()) return
    if (saveBoundsTimer) clearTimeout(saveBoundsTimer)
    saveBoundsTimer = setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      const bounds = mainWindow.getBounds()
      saveWindowBounds(bounds)
    }, 250)
  }
  mainWindow.on('resize', rememberBounds)
  mainWindow.on('move', rememberBounds)

  mainWindow.on('minimize', () => {
    const settings = getSettings()
    if (settings.minimizeToTray && !isQuitting()) {
      mainWindow?.hide()
    }
  })

  mainWindow.on('close', (event) => {
    if (isQuitting()) return
    const settings = getSettings()
    event.preventDefault()
    if (settings.closeBehavior === 'quit') {
      void dialog
        .showMessageBox(mainWindow!, {
          type: 'question',
          title: '退出 Murasame？',
          message: '退出应用会结束本地控制台。',
          detail: '未完成任务不会被报告为成功。隐藏到托盘则不会取消任务。',
          buttons: ['退出应用', '隐藏到托盘', '取消'],
          defaultId: 1,
          cancelId: 2
        })
        .then(({ response }) => {
          if (response === 0) {
            markQuitting()
            quitApplication()
          } else if (response === 1) {
            mainWindow?.hide()
          }
        })
      return
    }
    if (settings.closeBehavior === 'ask') {
      void dialog
        .showMessageBox(mainWindow!, {
          type: 'question',
          title: '关闭窗口',
          message: '要隐藏到托盘，还是退出应用？',
          buttons: ['隐藏到托盘', '退出应用', '取消'],
          defaultId: 0,
          cancelId: 2
        })
        .then(({ response }) => {
          if (response === 0) {
            mainWindow?.hide()
          } else if (response === 1) {
            markQuitting()
            quitApplication()
          }
        })
      return
    }
    mainWindow?.hide()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  return mainWindow
}

export function createPetWindow(): BrowserWindow {
  if (petWindow && !petWindow.isDestroyed()) return petWindow
  const state = getPetState()
  const width = 360
  const height = 500
  const cursor = screen.getCursorScreenPoint()
  const anchor = resetAnchor({ x: state.x || cursor.x, y: state.y || cursor.y, width, height }, displayAreas())
  const preferredX = state.x || anchor.x
  const preferredY = state.y || anchor.y
  const { x, y } = clampPetPosition(preferredX, preferredY, width, height)
  savePetPosition(x, y)

  petWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    title: 'Murasame Pet',
    webPreferences: {
      preload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      devTools: !app.isPackaged,
      spellcheck: false,
      backgroundThrottling: false
    }
  })

  petWindow.setAlwaysOnTop(true, 'floating')
  petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  petWindow.setIgnoreMouseEvents(true, { forward: true })
  secureWebContents(petWindow)
  loadRenderer(petWindow, 'pet')

  petWindow.once('ready-to-show', () => {
    if (getSettings().petVisible) {
      petWindow?.showInactive()
      // The renderer asks for its state while the window is still hidden.
      // Broadcast after the first show so the pet does not stay on the
      // hidden-root branch until the user manually toggles it.
      broadcastPetState(getPetStateSafe())
    }
  })

  petWindow.on('close', (event) => {
    if (isQuitting()) return
    event.preventDefault()
    petWindow?.hide()
    updateSettings({ petVisible: false })
  })

  petWindow.on('moved', () => {
    if (!petWindow || petWindow.isDestroyed()) return
    const [x, y] = petWindow.getPosition()
    if (savePetTimer) clearTimeout(savePetTimer)
    savePetTimer = setTimeout(() => {
      savePetPosition(characterOriginX(x), y)
      broadcastPetState(getPetStateSafe())
    }, 120)
  })

  petWindow.on('closed', () => {
    petWindow = null
  })

  return petWindow
}

export function broadcastPetPerformance(cue: unknown): void {
  const window = getPetWindow()
  if (window && !window.isDestroyed()) window.webContents.send(IPC.pet.performance, cue)
}

export function isPetHidden(): boolean {
  const window = getPetWindow()
  return !window || !window.isVisible()
}

export function initializeWindows(): void {
  const main = createMainWindow()
  const pet = createPetWindow()
  if (!getSettings().petVisible) pet.hide()
  screen.on('display-removed', () => {
    const window = getPetWindow()
    if (!window) return
    const bounds = window.getBounds()
    const next = recoverPosition(bounds, displayAreas())
    window.setBounds(next)
    savePetPosition(next.x, next.y)
  })
  main.show()
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

export function getPetWindow(): BrowserWindow | null {
  return petWindow && !petWindow.isDestroyed() ? petWindow : null
}

const MAIN_PATHS = new Set(['/tasks', '/chat', '/settings'])

/** 把控制台唤到前面，并让它打开指定页面。桌宠上的「去看看」走这里。 */
export function openMainPath(path: string): void {
  if (!MAIN_PATHS.has(path)) return
  showMain()
  getMainWindow()?.webContents.send(IPC.window.navigated, path)
}

export function showMain(): void {
  const window = getMainWindow() ?? createMainWindow()
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

export function hideMain(): void {
  getMainWindow()?.hide()
}

export function showPet(): PetState {
  const window = getPetWindow() ?? createPetWindow()
  updateSettings({ petVisible: true })
  window.showInactive()
  return broadcastPetState(getPetStateSafe())
}

export function hidePet(): PetState {
  getPetWindow()?.hide()
  updateSettings({ petVisible: false })
  return broadcastPetState(getPetStateSafe())
}

export function togglePet(): PetState {
  return getPetWindow()?.isVisible() ? hidePet() : showPet()
}

export function getPetStateSafe(): PetState {
  const settings = getSettings()
  const window = getPetWindow()
  const [x, y] = window?.getPosition() ?? [0, 0]
  return {
    visible: Boolean(window?.isVisible()),
    scale: settings.petScale,
    x,
    y,
    preset: settings.petPreset,
    importedModelUrl: settings.importedModelUrl
  }
}

export function refreshPetState(): PetState {
  return broadcastPetState(getPetStateSafe())
}

export function setPetScale(scale: number): PetState {
  updateSettings({ petScale: scale })
  const window = getPetWindow()
  const [x, y] = window?.getPosition() ?? [0, 0]
  return broadcastPetState({
    visible: Boolean(window?.isVisible()),
    scale,
    x,
    y,
    preset: getSettings().petPreset,
    importedModelUrl: getSettings().importedModelUrl
  })
}

export function setPetPosition(x: number, y: number): PetState {
  const window = getPetWindow()
  const bounds = window?.getBounds()
  const position = clampPetPosition(x, y, bounds?.width ?? PET_WIDTH, bounds?.height ?? PET_HEIGHT)
  window?.setPosition(position.x, position.y, false)
  savePetPosition(characterOriginX(position.x), position.y)
  return broadcastPetState({
    visible: Boolean(window?.isVisible()),
    scale: getSettings().petScale,
    x: position.x,
    y: position.y,
    preset: getSettings().petPreset,
    importedModelUrl: getSettings().importedModelUrl
  })
}

export function resetPetPosition(): PetState {
  const window = getPetWindow()
  const bounds = window?.getBounds() ?? { x: 0, y: 0, width: 360, height: 500 }
  const next = resetAnchor(bounds, displayAreas())
  return setPetPosition(next.x, next.y)
}

export function getPetBounds(): PetBounds {
  const window = getPetWindow()
  if (!window) return { x: 0, y: 0, width: 360, height: 500 }
  return window.getBounds()
}

export async function confirmQuit(): Promise<void> {
  const result = await dialog.showMessageBox({
    type: 'question',
    title: '退出 Murasame？',
    message: '退出会关闭控制台和桌宠。',
    detail: '未完成的任务不会被记成成功。已经产生的文件会保留。',
    buttons: ['退出应用', '取消'],
    defaultId: 1,
    cancelId: 1
  })
  if (result.response !== 0) return
  markQuitting()
  quitApplication()
}

export function setPetMousePassthrough(ignore: boolean): void {
  getPetWindow()?.setIgnoreMouseEvents(ignore, { forward: true })
}

function characterOriginX(windowX: number): number {
  return petChatOpen && petChatSide === 'left' ? windowX + PET_CHAT_WIDTH : windowX
}

export function setPetChatOpen(open: boolean): PetChatLayout {
  const window = getPetWindow()
  if (!window) {
    petChatOpen = open
    return { open, side: petChatSide }
  }
  const bounds = window.getBounds()
  const originX = characterOriginX(bounds.x)
  if (!open) {
    petChatOpen = false
    const position = clampPetPosition(originX, bounds.y, PET_WIDTH, PET_HEIGHT)
    window.setBounds({ x: position.x, y: position.y, width: PET_WIDTH, height: PET_HEIGHT })
    savePetPosition(position.x, position.y)
    return { open: false, side: petChatSide }
  }
  const display = screen.getDisplayMatching({
    x: originX,
    y: bounds.y,
    width: PET_WIDTH,
    height: PET_HEIGHT
  })
  const area = display.workArea
  petChatSide = choosePetChatSide({
    characterX: originX,
    characterWidth: PET_WIDTH,
    chatWidth: PET_CHAT_WIDTH,
    areaX: area.x,
    areaWidth: area.width
  })
  petChatOpen = true
  const rawX = petChatSide === 'left' ? originX - PET_CHAT_WIDTH : originX
  const position = clampPetPosition(rawX, bounds.y, PET_WIDTH + PET_CHAT_WIDTH, PET_HEIGHT)
  window.setBounds({
    x: position.x,
    y: position.y,
    width: PET_WIDTH + PET_CHAT_WIDTH,
    height: PET_HEIGHT
  })
  savePetPosition(characterOriginX(position.x), position.y)
  return { open: true, side: petChatSide }
}

export function focusPetChat(): void {
  const window = getPetWindow() ?? createPetWindow()
  showPet()
  window.show()
  window.focus()
  window.webContents.send(IPC.pet.focusChat)
}
