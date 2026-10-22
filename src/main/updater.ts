import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateCheckResult } from '../shared/types'
import log from './logger'

let configured = false
let timer: NodeJS.Timeout | null = null

function disabled(message: string): UpdateCheckResult {
  return { status: 'disabled', message }
}

function configure(): boolean {
  if (configured) return true
  const url = process.env.MURASAME_UPDATE_URL?.trim()
  if (!app.isPackaged) {
    log.info('Auto-update disabled in development build')
    return false
  }
  if (!url) {
    log.info('Auto-update disabled: MURASAME_UPDATE_URL is not configured')
    return false
  }
  autoUpdater.setFeedURL({ provider: 'generic', url })
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = log
  autoUpdater.on('error', (error) => log.error('Auto-update error', error))
  autoUpdater.on('update-available', (info) => log.info(`Update available: ${info.version}`))
  autoUpdater.on('update-not-available', () => log.info('Update not available'))
  autoUpdater.on('update-downloaded', (info) => log.info(`Update downloaded: ${info.version}`))
  configured = true
  return true
}

export async function checkForUpdates(): Promise<UpdateCheckResult> {
  if (!configure()) {
    return disabled(
      !app.isPackaged
        ? '开发环境不检查更新。安装版配置更新源后可自动检查。'
        : '尚未配置 MURASAME_UPDATE_URL，自动更新保持关闭。'
    )
  }
  try {
    const result = await autoUpdater.checkForUpdates()
    if (!result) return { status: 'not-available', message: '当前已是最新版本。' }
    if (result.updateInfo.version !== app.getVersion()) {
      return {
        status: 'available',
        message: `发现新版本 ${result.updateInfo.version}，正在后台下载。`,
        version: result.updateInfo.version
      }
    }
    return { status: 'not-available', message: '当前已是最新版本。' }
  } catch (error) {
    log.error('Update check failed', error)
    return {
      status: 'error',
      message: error instanceof Error ? error.message : '检查更新失败，请稍后重试。'
    }
  }
}

export function initializeUpdater(): void {
  if (!configure()) return
  timer = setInterval(() => {
    void checkForUpdates()
  }, 6 * 60 * 60 * 1000)
  setTimeout(() => {
    void checkForUpdates()
  }, 10_000)
}

export function stopUpdater(): void {
  if (timer) clearInterval(timer)
  timer = null
}
