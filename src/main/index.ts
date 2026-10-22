import { app, dialog, protocol, session } from 'electron'
import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import log from './logger'
import { markQuitting } from './app-state'
import { DesktopCore } from './core/desktop-core'
import { ModelRepository } from './core/model-repository'
import { registerIpcHandlers } from './ipc'
import { getSettings } from './settings'
import { createTray, destroyTray } from './tray'
import { initializeUpdater, stopUpdater } from './updater'
import { hideMain, initializeWindows, showMain } from './windows'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'murasame',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true
    }
  }
])

const rendererMimeTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.moc3': 'application/octet-stream',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2'
}

function registerRendererProtocol(): void {
  const rendererRoot = resolve(__dirname, '../renderer')
  protocol.handle('murasame', async (request) => {
    try {
      const requestUrl = new URL(request.url)
      const relativePath = decodeURIComponent(requestUrl.pathname).replace(/^[/\\]+/, '')
      const filePath = resolve(rendererRoot, relativePath || 'index.html')
      if (filePath !== rendererRoot && !filePath.startsWith(`${rendererRoot}${sep}`)) {
        return new Response('Forbidden', { status: 403 })
      }
      const contents = await readFile(filePath)
      const contentType = rendererMimeTypes[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
      return new Response(new Uint8Array(contents), {
        headers: {
          'Content-Type': contentType,
          'Cache-Control': app.isPackaged ? 'public, max-age=31536000, immutable' : 'no-cache'
        }
      })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}

if (process.env.MURASAME_USER_DATA) {
  app.setPath('userData', resolve(process.env.MURASAME_USER_DATA))
}

const gotSingleInstanceLock = app.requestSingleInstanceLock()

function hardenSession(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': ["frame-ancestors 'none'"]
      }
    })
  })
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })
}

if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.setAppUserModelId('com.murasame.desktop')

  app.on('second-instance', () => {
    log.info('Second instance requested; focusing the existing console')
    showMain()
  })

  app.whenReady().then(() => {
    hardenSession()
    registerRendererProtocol()
    const settings = getSettings()
    const core = new DesktopCore(new ModelRepository())

    app.setLoginItemSettings({
      openAtLogin: settings.startAtLogin,
      args: ['--hidden']
    })

    registerIpcHandlers(core)
    initializeWindows()
    createTray()
    initializeUpdater()

    if (process.argv.includes('--hidden')) {
      setTimeout(() => hideMain(), 250)
    }

    app.on('activate', () => showMain())
    log.info(`Murasame ${app.getVersion()} started; packaged=${app.isPackaged}`)
  })

  app.on('before-quit', () => {
    markQuitting()
    stopUpdater()
  })

  app.on('will-quit', () => {
    destroyTray()
  })

  app.on('window-all-closed', () => {
    // The tray remains the product's persistent entry point on Windows.
  })

  process.on('uncaughtException', (error) => {
    log.error('Uncaught main-process exception', error)
    dialog.showErrorBox(
      'Murasame 遇到意外错误',
      '应用可能无法继续运行。详情已写入本地日志，可在「运行与隐私」中打开日志目录。'
    )
  })

  process.on('unhandledRejection', (reason) => {
    log.error('Unhandled main-process rejection', reason)
  })
}
