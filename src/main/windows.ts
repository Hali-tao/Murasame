import { app, BrowserWindow, dialog, nativeImage, screen, shell } from 'electron'
import { join } from 'node:path'
import { isQuitting, markQuitting, quitApplication } from './app-state'
import { getSavedPetPosition, getSettings, getWindowBounds, saveWindowBounds, savePetPosition, updateSettings } from './settings'
import { petDimensions, resizePetAroundFeet } from '../shared/pet-geometry'
import { hardenWebContents } from './security/hardening'
import log from './logger'
import { choosePetChatSide, recoverPosition, resetAnchor, type WorkArea } from './desktop/placement'
import type { PetBounds, PetChatLayout, PetState } from '../shared/types'
import { IPC } from '../shared/ipc'

let mainWindow: BrowserWindow | null = null
let mainVisibilityRevision = 0
export function getMainVisibilityRevision(): number { return mainVisibilityRevision }
let petWindow: BrowserWindow | null = null
let saveBoundsTimer: NodeJS.Timeout | null = null
let savePetTimer: NodeJS.Timeout | null = null
let petChatOpen = false
let petChatSide: 'left' | 'right' = 'right'
let petDrag: { offsetX: number; offsetY: number; lastX: number; lastY: number } | null = null

const PET_CHAT_WIDTH = 300

function petWindowSize(): { width: number; height: number } {
  return petDimensions(getSettings().petScale, petChatOpen)
}

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

/**
 * 向渲染进程发事件时的统一保护：窗口或 webContents 已销毁、渲染帧已释放时
 * 不抛异常（否则会让已经成功的 IPC 调用返回失败，或中断任务状态回调链）。
 */
function safeSend(window: BrowserWindow | null | undefined, channel: string, payload?: unknown): void {
  if (!window || window.isDestroyed()) return
  const contents = window.webContents
  if (!contents || (typeof contents.isDestroyed === 'function' && contents.isDestroyed())) return
  try {
    if (payload === undefined) contents.send(channel)
    else contents.send(channel, payload)
  } catch (error) {
    log.warn(`Renderer event dropped: ${channel}`, error)
  }
}

function loadRenderer(window: BrowserWindow, page: 'index' | 'pet'): void {
  const target = rendererUrl ? `${rendererUrl}/${page}.html` : `murasame://app/${page}.html`
  // A custom scheme keeps fetch()/CORS working for Live2D model assets in
  // production, whereas file:// would block runtime JSON and texture loads.
  try {
    const loading = window.loadURL(target)
    if (loading && typeof loading.catch === 'function') {
      loading.catch((error: unknown) => log.error(`页面加载失败：${target}`, error))
    }
  } catch (error) {
    log.error(`页面加载失败：${target}`, error)
  }
}

function secureWebContents(window: BrowserWindow): void {
  // A hidden BrowserWindow stays mounted. Its microphone owner must cancel
  // pending acquisition/transcription as well as an already active stream.
  const stopVoiceInput = (): void => { safeSend(window, IPC.window.hidden) }
  window.on('hide', stopVoiceInput)
  window.on('minimize', stopVoiceInput)
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
    if (details.reason === 'clean-exit') return
    recoverCrashedRenderer(window, details.reason)
  })
}

const RENDERER_RECOVERY_LIMIT = 3
const RENDERER_RECOVERY_WINDOW_MS = 60_000
const rendererRecoveryTimes = new Map<number, number[]>()

/**
 * 单窗口渲染进程崩溃不能让桌宠/控制台永久空白：自动重新加载一次。
 * 崩溃循环（60 秒内超过 3 次）时停止自动恢复，避免无限重载拖垮主进程。
 */
function recoverCrashedRenderer(window: BrowserWindow, reason: string): void {
  if (isQuitting() || window.isDestroyed()) return
  const id = window.webContents.id
  const now = Date.now()
  const recent = (rendererRecoveryTimes.get(id) ?? []).filter((time) => now - time < RENDERER_RECOVERY_WINDOW_MS)
  recent.push(now)
  rendererRecoveryTimes.set(id, recent)
  if (recent.length > RENDERER_RECOVERY_LIMIT) {
    log.error(`渲染进程 60 秒内崩溃 ${recent.length} 次，停止自动恢复（${reason}）`)
    return
  }
  log.warn(`渲染进程崩溃（${reason}），第 ${recent.length} 次自动恢复`)
  setTimeout(() => {
    if (isQuitting() || window.isDestroyed()) return
    try {
      window.webContents.reload()
    } catch (error) {
      log.error('渲染进程自动恢复失败', error)
    }
  }, 250).unref?.()
}

function broadcastPetState(state: PetState): PetState {
  const windows = [mainWindow, petWindow].filter(
    (window): window is BrowserWindow => Boolean(window && !window.isDestroyed())
  )
  windows.forEach((window) => safeSend(window, IPC.pet.stateChanged, state))
  return state
}

export function createMainWindow(): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow
  const stored = getWindowBounds()
  const width = stored?.width ?? 1400
  const height = stored?.height ?? 880
  const hasStoredOrigin = typeof stored?.x === 'number' && typeof stored?.y === 'number'
  const placed = hasStoredOrigin
    ? recoverPosition({ x: stored.x ?? 0, y: stored.y ?? 0, width, height }, displayAreas())
    : null
  mainWindow = new BrowserWindow({
    width,
    height,
    x: placed?.x,
    y: placed?.y,
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
    if (!getSettings().onboardingDone) mainWindow?.show()
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
      hideMain()
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
            hideMain()
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
            hideMain()
          } else if (response === 1) {
            markQuitting()
            quitApplication()
          }
        })
      return
    }
    hideMain()
  })

  mainWindow.on('closed', () => {
    if (saveBoundsTimer) clearTimeout(saveBoundsTimer)
    saveBoundsTimer = null
    mainWindow = null
  })

  return mainWindow
}

export function createPetWindow(): BrowserWindow {
  if (petWindow && !petWindow.isDestroyed()) return petWindow
  const saved = getSavedPetPosition()
  const { width, height } = petWindowSize()
  const cursor = screen.getCursorScreenPoint()
  const anchor = resetAnchor({ x: cursor.x, y: cursor.y, width, height }, displayAreas())
  const preferredX = saved?.x ?? anchor.x
  const preferredY = saved?.y ?? anchor.y
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
    if (petDrag || !petWindow || petWindow.isDestroyed()) return
    const [x, y] = petWindow.getPosition()
    if (savePetTimer) clearTimeout(savePetTimer)
    savePetTimer = setTimeout(() => {
      savePetPosition(characterOriginX(x), y)
      broadcastPetState(getPetStateSafe())
    }, 120)
  })

  petWindow.on('closed', () => {
    if (savePetTimer) clearTimeout(savePetTimer)
    savePetTimer = null
    petWindow = null
  })

  return petWindow
}

export function broadcastPetPerformance(cue: unknown): void {
  safeSend(getPetWindow(), IPC.pet.performance, cue)
}

/** F-04：只在桌宠可见时投递小剧场；不弹独立窗口、不抢焦点。 */
export function broadcastTheater(scene: unknown): void {
  if (isPetHidden()) return
  safeSend(getPetWindow(), IPC.pet.theater, scene)
}

export function isPetHidden(): boolean {
  const window = getPetWindow()
  return !window || !window.isVisible()
}

export function initializeWindows(): void {
  const main = createMainWindow()
  const pet = createPetWindow()
  if (!getSettings().petVisible) pet.hide()
  const recoverWindows = (): void => {
    const pet = getPetWindow()
    if (pet) {
      const bounds = pet.getBounds()
      const size = petWindowSize()
      const next = recoverPosition({ ...bounds, width: size.width, height: size.height }, displayAreas())
      pet.setBounds({ x: next.x, y: next.y, width: size.width, height: size.height })
      savePetPosition(characterOriginX(next.x), next.y)
      broadcastPetState(getPetStateSafe())
    }
    const consoleWindow = getMainWindow()
    if (consoleWindow) bringOntoScreen(consoleWindow)
  }
  screen.on('display-removed', recoverWindows)
  screen.on('display-added', recoverWindows)
  screen.on('display-metrics-changed', recoverWindows)
  if (!getSettings().onboardingDone) main.show()
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

export function getPetWindow(): BrowserWindow | null {
  return petWindow && !petWindow.isDestroyed() ? petWindow : null
}

const MAIN_PATHS = new Set(['/tasks', '/chat', '/settings', '/autonomy'])

/** 把控制台唤到前面，并让它打开指定页面。可以带 ?focus=任务编号。 */
export function openMainPath(path: string): void {
  const pathOnly = path.split('?')[0]
  if (!MAIN_PATHS.has(pathOnly)) return
  showMain()
  safeSend(getMainWindow(), IPC.window.navigated, path)
}

function bringOntoScreen(window: BrowserWindow): void {
  const bounds = window.getBounds()
  const next = recoverPosition(bounds, displayAreas())
  if (next.x === bounds.x && next.y === bounds.y) return
  window.setBounds({ ...bounds, x: next.x, y: next.y })
  saveWindowBounds({ ...bounds, x: next.x, y: next.y })
}

export function showMain(): void {
  mainVisibilityRevision++
  const window = getMainWindow() ?? createMainWindow()
  if (window.isMinimized()) window.restore()
  bringOntoScreen(window)
  window.show()
  window.focus()
}

export function hideMain(): void {
  mainVisibilityRevision++
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
  // 以持久化意图为准，而不是瞬时 isVisible()：show/hide 是异步窗口操作，
  // 连续快速切换时 isVisible 可能滞后，导致奇偶次翻转错位（状态与窗口分叉）。
  return getSettings().petVisible ? hidePet() : showPet()
}

export function getPetStateSafe(): PetState {
  const settings = getSettings()
  const window = getPetWindow()
  const [x, y] = window?.getPosition() ?? [0, 0]
  return {
    // 可见性以持久化设置为准：窗口可能尚未完成首次 show，但状态早已是「应显示」。
    visible: Boolean(window) && settings.petVisible,
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
  const window = getPetWindow()
  const bounds = window?.getBounds()
  const oldColumn = bounds ? bounds.width - (petChatOpen ? PET_CHAT_WIDTH : 0) : 360
  updateSettings({ petScale: scale })
  if (window && bounds) {
    const size = petDimensions(scale, petChatOpen)
    const left = petChatOpen && petChatSide === 'left' ? PET_CHAT_WIDTH : 0
    const anchor = resizePetAroundFeet(bounds, oldColumn, size.columnWidth, size.height, left, left)
    const position = clampPetPosition(anchor.x, anchor.y, size.width, size.height)
    window.setBounds({ ...position, width: size.width, height: size.height })
    savePetPosition(characterOriginX(position.x), position.y)
  }
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
  const size = petWindowSize()
  const position = clampPetPosition(x, y, size.width, size.height)
  window?.setBounds({ x: position.x, y: position.y, width: size.width, height: size.height })
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

export function beginPetDrag(screenX: number, screenY: number): void {
  const window = getPetWindow()
  if (!window) return
  const [x, y] = window.getPosition()
  petDrag = { offsetX: screenX - x, offsetY: screenY - y, lastX: screenX, lastY: screenY }
}

/** 只用这次事件里的屏幕坐标。窗口自己移动产生的重复事件直接丢掉，避免按住就往下溜。 */
export function movePetDrag(screenX: number, screenY: number): void {
  const window = getPetWindow()
  if (!window || !petDrag) return
  if (screenX === petDrag.lastX && screenY === petDrag.lastY) return
  petDrag.lastX = screenX
  petDrag.lastY = screenY
  const size = petWindowSize()
  const next = clampPetPosition(screenX - petDrag.offsetX, screenY - petDrag.offsetY, size.width, size.height)
  if (!Number.isFinite(next.x) || !Number.isFinite(next.y)) return
  const [currentX, currentY] = window.getPosition()
  if (next.x === currentX && next.y === currentY) return
  // setPosition 在 125% 缩放下每次都会把窗口撑大 1 像素，聊天框就被越拉越长。
  window.setBounds({ x: next.x, y: next.y, width: size.width, height: size.height })
  // DPI 缩放可能让实际 bounds 比请求值大 1px；落位后按真实 bounds 再夹一次，避免越出工作区。
  const actual = window.getBounds()
  const corrected = clampPetPosition(actual.x, actual.y, actual.width, actual.height)
  if (corrected.x !== actual.x || corrected.y !== actual.y) {
    window.setBounds({ x: corrected.x, y: corrected.y, width: actual.width, height: actual.height })
  }
}

export function endPetDrag(): void {
  const window = getPetWindow()
  petDrag = null
  if (!window) return
  const [x, y] = window.getPosition()
  savePetPosition(characterOriginX(x), y)
}

export function setPetChatOpen(open: boolean): PetChatLayout {
  const window = getPetWindow()
  if (!window) {
    petChatOpen = open
    return { open, side: petChatSide }
  }
  // 已经打开时再打开一次不再重算左右，否则松手时角色会跳到对话框那边。
  if (open && petChatOpen) return { open: true, side: petChatSide }
  const bounds = window.getBounds()
  const originX = characterOriginX(bounds.x)
  const { columnWidth: PET_WIDTH, height: PET_HEIGHT } = petDimensions(getSettings().petScale, false)
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
  safeSend(window, IPC.pet.focusChat)
}
