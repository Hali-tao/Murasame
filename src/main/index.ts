import { app, dialog, globalShortcut, powerMonitor, protocol, session } from 'electron'
import { createHash } from 'node:crypto'
import { cleanupOwnedContainersAsync, configureContainerOwner } from './isolation/docker-runtime'
import { readFile } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'
import log from './logger'
import { markQuitting } from './app-state'
import { getDatabase, databaseCapacityWarning } from './data/db'
import { MurasameCore } from './core/murasame-core'
import { ModelRegistry } from './model/registry'
import { registerIpcHandlers } from './ipc'
import { getSettings, readRelationship } from './settings'
import { createTray, destroyTray } from './tray'
import { initializeUpdater, stopUpdater } from './updater'
import { allowMicrophone } from './security/media-permission'
import { contentSecurityPolicy } from './security/hardening'
import { broadcastPetPerformance, focusPetChat, hideMain, initializeWindows, isPetHidden, showMain } from './windows'
import { refreshMemoryStatus } from './local/memory-status'
import { setBundledModelsRoot } from './local/model-env'
import { applyHotkey } from './hotkey-status'
import { logExpired } from './privacy/redact'
import { statSync } from 'node:fs'
import { ProactiveLoop } from './core/proactive-loop'

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
      if (relativePath.startsWith('characters/')) {
        const charactersRoot = resolve(app.getPath('userData'), 'characters')
        const filePath = resolve(charactersRoot, relativePath.slice('characters/'.length))
        if (filePath !== charactersRoot && !filePath.startsWith(`${charactersRoot}${sep}`)) {
          return new Response('Forbidden', { status: 403 })
        }
        const contents = await readFile(filePath)
        const contentType = rendererMimeTypes[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
        return new Response(new Uint8Array(contents), { headers: { 'Content-Type': contentType, 'Cache-Control': 'no-cache' } })
      }
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
        'Content-Security-Policy': [contentSecurityPolicy(!app.isPackaged)]
      }
    })
  })
  const developmentOrigin = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL
  session.defaultSession.setPermissionCheckHandler((_contents, permission, origin, details) => allowMicrophone({ permission, url: origin, audioOnly: details.mediaType === 'audio', enabled: getSettings().permissions.microphone, developmentOrigin }))
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback, details) => {
    const media = 'mediaTypes' in details ? details.mediaTypes : []
    callback(allowMicrophone({ permission, url: details.requestingUrl, audioOnly: Array.isArray(media) && media.length > 0 && media.every(kind => kind === 'audio'), enabled: getSettings().permissions.microphone, developmentOrigin }))
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

  app.whenReady().then(async () => {
    hardenSession()
    registerRendererProtocol()
    if (app.isPackaged) setBundledModelsRoot(join(process.resourcesPath, 'models'))
    try {
      getDatabase()
    } catch (error) {
      const message = error instanceof Error ? error.message : '本地数据库无法打开'
      log.error('Startup failed before the window opened', error)
      dialog.showErrorBox('Murasame 无法启动', message)
      app.exit(1)
      return
    }
    const capacityWarning = databaseCapacityWarning()
    if (capacityWarning) log.warn(capacityWarning)
    const settings = getSettings()
    configureContainerOwner(createHash('sha256').update(app.getPath('userData')).digest('hex').slice(0, 24))
    const core = MurasameCore.create(getDatabase(), new ModelRegistry(), app.getPath('userData'))
    // 打包后随附的插件在 resources/plugins，asar 里没有这个目录。
    core.tools.loadDirectory(
      app.isPackaged ? join(process.resourcesPath, 'plugins') : join(app.getAppPath(), 'plugins')
    )
    core.tools.loadDirectory(join(app.getPath('userData'), 'plugins'))

    app.setLoginItemSettings({
      openAtLogin: settings.startAtLogin,
      args: ['--hidden']
    })

    let screenLocked = powerMonitor.getSystemIdleState(1) === 'locked'
    let suspended = false
    const refreshLock = (): void => core.setLocked(screenLocked || suspended)
    powerMonitor.on('lock-screen', () => { screenLocked = true; refreshLock() })
    powerMonitor.on('unlock-screen', () => { screenLocked = false; refreshLock() })
    powerMonitor.on('suspend', () => { suspended = true; refreshLock() })
    powerMonitor.on('resume', () => { suspended = false; refreshLock() })
    refreshLock()
    const recovery = await cleanupOwnedContainersAsync().catch(error => { log.warn('上次活动的容器恢复未完成', error); return null })
    if (recovery?.failed.length) log.error('以下旧容器需要再次清理', recovery.failed.join(', '))
    registerIpcHandlers(core)
    initializeWindows()
    createTray()
    const hotkey = applyHotkey(getSettings().petHotkey, () => focusPetChat())
    refreshMemoryStatus(app.getPath('userData'))
    if (!hotkey.ok) log.warn(hotkey.message)
    try {
      const file = log.transports.file.getFile()
      const ageDays = (Date.now() - statSync(file.path).mtimeMs) / 86_400_000
      if (logExpired(ageDays, settings.logRetentionDays)) file.clear()
    } catch {
      // 日志文件还不存在时不清理。
    }
    let lastWatch = 0
    const watchTimer = setInterval(() => {
      const current = getSettings()
      if (!current.screenWatchEnabled || !current.permissions.screen || current.doNotDisturb) return
      if (Date.now() - lastWatch < current.screenWatchSeconds * 1000) return
      lastWatch = Date.now()
      void core.analyzeScreen(true).catch(error => log.warn('持续观察暂停', error))
    }, 5000)
    let healthPending = false
    const healthTimer = setInterval(() => {
      if (healthPending || !core.autonomy.status().running) return
      healthPending = true
      void core.autonomy.health().catch(error => log.warn('活动健康检查失败', error)).finally(() => { healthPending = false })
    }, 5000)
    app.on('before-quit', () => clearInterval(watchTimer))
    let cleanupStarted = false
    let cleanupFinished = false
    app.on('before-quit', event => {
      clearInterval(healthTimer)
      if (cleanupFinished) return
      event.preventDefault()
      if (cleanupStarted) return
      cleanupStarted = true
      core.cancelSensitiveRequests()
      void (async () => {
        const running = core.tasks.list().filter(task => ['执行中', '规划中', '正在停止'].includes(task.status))
        await Promise.allSettled(running.map(async task => { await core.tasks.cancel(task.id); await core.tasks.settled(task.id) }))
        const stopped = await core.autonomy.stop({ containerGone: false })
        if (!stopped.ok) log.error('退出时隔离活动未完全清理', stopped.error)
      })().catch(error => log.error('退出清理失败', error)).finally(() => { cleanupFinished = true; app.quit() })
    })
    initializeUpdater()

    const proactive = new ProactiveLoop({
      hidden: () => isPetHidden(),
      doNotDisturb: () => getSettings().doNotDisturb || !core.characterService.load().proactive,
      taskRunning: () => core.tasks.list().some((task) => task.status === '执行中' || task.status === '等待批准'),
      pace: () => getSettings().proactivePace,
      stage: () => readRelationship().stage,
      reasons: () => {
        const finished = core.tasks.list().filter((task) => task.status === '已完成' || task.status === '部分完成')
        const blocked = core.tasks.list().filter((task) => task.status === '等待批准')
        const reasons: string[] = []
        if (finished.length > 0) reasons.push(`你交代的「${finished[0].title}」已经有结果了`)
        if (blocked.length > 0) reasons.push(`「${blocked[0].title}」还等着你批准`)
        return reasons
      },
      say: (text) => {
        broadcastPetPerformance({ intent: '打招呼', motion: null, expression: null, degraded: false, pad: core.affect.pad, text })
        log.info(`Proactive: ${text}`)
      }
    })
    proactive.start()
    app.on('before-quit', () => proactive.stop())

    if (process.argv.includes('--hidden')) {
      setTimeout(() => hideMain(), 250)
    }

    app.on('activate', () => showMain())
    log.info(`Murasame ${app.getVersion()} started; packaged=${app.isPackaged}`)
  }).catch((error: unknown) => {
    // 启动链路任何一步失败（数据库之后）都必须让用户看到原因并退出，
    // 不能留下没有窗口、没有托盘、没有 IPC 的挂起进程。
    const message = error instanceof Error ? error.message : String(error)
    log.error('Startup chain failed', error)
    dialog.showErrorBox('Murasame 启动失败', `初始化过程中发生错误，应用将退出。\n${message}`)
    app.exit(1)
  })

  app.on('before-quit', () => {
    markQuitting()
    stopUpdater()
  })

  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
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
