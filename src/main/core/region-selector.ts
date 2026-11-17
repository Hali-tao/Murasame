import { BrowserWindow, desktopCapturer, ipcMain, screen, type NativeImage } from 'electron'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { regionPixels, type RegionRect } from './region-geometry'
import { regionOverlay } from './region-overlay'

export async function selectScreenRegion(signal: AbortSignal, guard: () => void): Promise<NativeImage | null> {
  guard()
  const displays = screen.getAllDisplays()
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: {
    width: Math.ceil(Math.max(...displays.map(display => display.size.width * display.scaleFactor))),
    height: Math.ceil(Math.max(...displays.map(display => display.size.height * display.scaleFactor)))
  } })
  guard()
  return new Promise((resolve, reject) => {
    const channel = `region-select-${randomUUID()}`
    const windows = new Map<BrowserWindow, NativeImage>()
    let settled = false
    const finish = (image: NativeImage | null, error?: unknown): void => {
      if (settled) return
      settled = true
      clearInterval(timer)
      clearTimeout(timeout)
      signal.removeEventListener('abort', aborted)
      screen.removeListener('display-removed', displayChanged)
      screen.removeListener('display-metrics-changed', displayChanged)
      ipcMain.removeListener(channel, selected)
      for (const window of windows.keys()) if (!window.isDestroyed()) window.destroy()
      windows.clear()
      if (error) reject(error); else resolve(image)
    }
    const aborted = (): void => finish(null, new Error('区域选择已停止'))
    const displayChanged = (): void => finish(null, new Error('显示器布局已改变，请重新框选'))
    const selected = (event: Electron.IpcMainEvent, value: unknown): void => {
      const window = [...windows.keys()].find(item => !item.isDestroyed() && item.webContents === event.sender)
      if (!window || event.senderFrame !== window.webContents.mainFrame) return
      try {
        guard()
        if (value === null) { finish(null); return }
        if (!value || typeof value !== 'object') throw new Error('无效选区')
        const image = windows.get(window)!
        const bounds = window.getContentBounds()
        const rect = regionPixels(value as RegionRect, bounds, image.getSize())
        finish(image.crop(rect))
      } catch (error) { finish(null, error) }
    }
    const timer = setInterval(() => { try { guard() } catch (error) { finish(null, error) } }, 200)
    const timeout = setTimeout(() => finish(null), 120000)
    signal.addEventListener('abort', aborted, { once: true })
    screen.on('display-removed', displayChanged)
    screen.on('display-metrics-changed', displayChanged)
    ipcMain.on(channel, selected)
    try {
      guard()
      for (const display of displays) {
        const image = sources.find(source => source.display_id === String(display.id))?.thumbnail
        if (!image || image.isEmpty()) throw new Error('无法读取显示器画面，请重试')
        const window = new BrowserWindow({ ...display.bounds, show: false, frame: false, resizable: false, movable: false,
          skipTaskbar: true, alwaysOnTop: true, fullscreenable: false, title: 'Murasame · 框选区域',
          webPreferences: { preload: join(__dirname, '../preload/region.js'), contextIsolation: true, sandbox: true, nodeIntegration: false,
            partition: 'region-selection', additionalArguments: [`--region-channel=${channel}`] } })
        windows.set(window, image)
        window.setMenu(null)
        window.setAlwaysOnTop(true, 'screen-saver')
        window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
        window.webContents.on('will-navigate', event => event.preventDefault())
        window.webContents.on('render-process-gone', () => finish(null, new Error('区域选择窗口异常关闭')))
        window.on('closed', () => finish(null))
        window.once('ready-to-show', () => { if (!settled) window.show() })
        const html = regionOverlay(image.toDataURL(), randomUUID())
        void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).catch(error => finish(null, error))
      }
    } catch (error) { finish(null, error) }
  })
}
