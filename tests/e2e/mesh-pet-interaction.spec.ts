import { expect, test, type ElectronApplication } from '@playwright/test'
import type { ActivityStatus } from '../../src/shared/types'
import { IPC } from '../../src/shared/ipc'
import { closeApp, findMainPage, findPetPage, launchApp } from './helpers'

const active: ActivityStatus = {
  activityId: 'synthetic-nailong', kind: 'code', running: true, phase: 'running',
  reason: '网格桌宠状态边界验收', viewUrl: '', notes: [], taskStatus: '独立于任务',
  allowNetwork: false, canStop: true, busy: true
}

async function publish(app: ElectronApplication, state: ActivityStatus): Promise<void> {
  await app.evaluate(({ BrowserWindow, ipcMain }, payload) => {
    ipcMain.removeHandler(payload.statusChannel)
    ipcMain.handle(payload.statusChannel, () => payload.state)
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send(payload.channel, payload.state)
  }, { state, channel: IPC.autonomy.updated, statusChannel: IPC.autonomy.status })
}

test('official mesh pet reacts to click and drag, and follows task states', async () => {
  test.setTimeout(120_000)
  const app = await launchApp()
  try {
    const main = await findMainPage(app)
    await main.evaluate(() => window.murasame.settings.update({ petPreset: 'nailong', speakReplies: false }))
    const pet = await findPetPage(app)
    const host = pet.locator('[data-model-id="nailong"][data-live2d-state="ready"]')
    await expect(host).toBeVisible({ timeout: 30_000 })

    // 单击问候：Greet 持续约 1.4 秒后退回 Idle。
    // 先把指针移到角色上，让页面解除窗口的点击穿透（真实用户也是先移动再点击）。
    const box = await pet.locator('.pet-character').boundingBox()
    if (!box) throw new Error('pet character box missing')
    await pet.mouse.move(box.x + box.width / 2, box.y + box.height * 0.55)
    await pet.waitForTimeout(250)
    await pet.mouse.click(box.x + box.width / 2, box.y + box.height * 0.55)
    await expect(host).toHaveAttribute('data-motion-group', 'Greet')
    await expect.poll(async () => host.getAttribute('data-motion-group'), { timeout: 6_000 }).toBe('Idle')

    // 拖拽反应：Settle 后回到 Idle；窗口位置变化由主进程负责，不在断言里。
    const startX = box.x + box.width / 2
    const startY = box.y + box.height * 0.45
    await pet.mouse.move(startX, startY)
    await pet.mouse.down()
    await pet.mouse.move(startX + 24, startY + 12, { steps: 4 })
    await pet.mouse.up()
    await expect(host).toHaveAttribute('data-motion-group', 'Settle')
    await expect.poll(async () => host.getAttribute('data-motion-group'), { timeout: 6_000 }).toBe('Idle')

    // 任务状态：等待/工作中/完成分别映射到 Think / Working / Agree。
    await publish(app, { ...active, creation: { phase: 'drafting', message: '等待创作内容' } })
    await expect(host).toHaveAttribute('data-motion-group', 'Think')
    await publish(app, { ...active, creation: { phase: 'executing', message: '代码正在隔离区运行' } })
    await expect(host).toHaveAttribute('data-motion-group', 'Working')
    const ready: ActivityStatus = {
      ...active, busy: false, creation: {
        phase: 'ready', message: '产物已核验', artifact: {
          id: '11111111-1111-4111-8111-111111111111', kind: 'code', title: '网格状态样例', name: 'main.py',
          sha256: '0'.repeat(64), bytes: 8, preview: 'print(1)', stdout: '1', review: '审阅通过', attempt: 0
        }
      }
    }
    await publish(app, ready)
    await expect(host).toHaveAttribute('data-motion-group', 'Agree')
  } finally {
    await closeApp(app)
  }
})
