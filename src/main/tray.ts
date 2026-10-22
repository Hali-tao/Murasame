import { app, dialog, Menu, nativeImage, Tray } from 'electron'
import { join } from 'node:path'
import { confirmQuit, focusPetChat, showMain, togglePet } from './windows'
import { getSettings, updateSettings } from './settings'
import { checkForUpdates } from './updater'
import log from './logger'

let tray: Tray | null = null

function resourcePath(name: string): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'resources', name)
    : join(app.getAppPath(), 'resources', name)
}

export function createTray(): Tray {
  if (tray) return tray
  const image = nativeImage.createFromPath(resourcePath('icon.png')).resize({ width: 20, height: 20 })
  tray = new Tray(image)
  const refresh = (): void => {
    if (!tray) return
    const quiet = getSettings().doNotDisturb
    tray.setToolTip(quiet ? 'Murasame · 勿扰中' : 'Murasame · AI 桌面伙伴')
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '和它说句话', click: () => focusPetChat() },
      { label: '显示 / 隐藏桌宠', click: () => togglePet() },
      {
        label: quiet ? '关闭勿扰' : '暂时别打扰我',
        click: () => {
          updateSettings({ doNotDisturb: !getSettings().doNotDisturb })
          refresh()
        }
      },
      { type: 'separator' },
      { label: '显示控制台', click: () => showMain() },
      {
        label: '检查更新',
        click: () => {
          void checkForUpdates().then((result) => {
            void dialog.showMessageBox({
              type: result.status === 'error' ? 'error' : 'info',
              title: 'Murasame 更新',
              message: result.message,
              buttons: ['关闭']
            })
          })
        }
      },
      { type: 'separator' },
      { label: '退出 Murasame', click: () => { void confirmQuit() } }
    ]))
  }
  refresh()
  tray.on('double-click', () => focusPetChat())
  tray.on('click', () => focusPetChat())
  log.info('Tray initialized')
  return tray
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}
