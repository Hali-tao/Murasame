import { expect, test, type ElectronApplication } from '@playwright/test'
import type { ActivityStatus } from '../../src/shared/types'
import { IPC } from '../../src/shared/ipc'
import { closeApp, findMainPage, findPetPage, launchApp } from './helpers'

const active: ActivityStatus = {
  activityId: 'synthetic-activity', kind: 'code', running: true, phase: 'running',
  reason: '独立状态边界验收', viewUrl: '', notes: [], taskStatus: '独立于任务',
  allowNetwork: false, canStop: true, busy: true
}

async function publish(app: ElectronApplication, state: ActivityStatus): Promise<void> {
  await app.evaluate(({ BrowserWindow, ipcMain }, payload) => {
    ipcMain.removeHandler(payload.statusChannel)
    ipcMain.handle(payload.statusChannel, () => payload.state)
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send(payload.channel, payload.state)
  }, { state, channel: IPC.autonomy.updated, statusChannel: IPC.autonomy.status })
}

test('real pet follows current work, keeps a native loop and stops without celebrating stale output', async () => {
  test.setTimeout(90_000)
  const app = await launchApp()
  try {
    const main = await findMainPage(app)
    await main.evaluate(() => window.murasame.settings.update({ petPreset: 'naiwa', speakReplies: false }))
    const pet = await findPetPage(app)
    await expect(pet.locator('[data-model-id="naiwa"][data-live2d-state="ready"]')).toBeVisible({ timeout: 20_000 })
    // Synthetic status boundary; real preload, React surface, Cubism and native
    // window remain in use. Real Docker execution is covered by isolated-creation.
    await publish(app, { ...active, creation: { phase: 'drafting', message: '等待独立测试模型生成候选' } })
    await expect(pet.getByTestId('pet-isolation-progress')).toContainText('等待创作内容')
    await expect(pet.locator('.pet-stage')).toHaveAttribute('data-work-phase', 'waiting')
    await expect(pet.locator('.live2d-pet-host')).toHaveAttribute('data-motion-group', 'Think')
    await publish(app, { ...active, creation: { phase: 'executing', message: '独立测试：代码正在隔离区运行' } })
    await expect(pet.locator('.live2d-pet-host')).toHaveAttribute('data-motion-group', 'WorkingLoop')
    await expect(pet.getByTestId('pet-isolation-progress')).toContainText('正在运行代码')
    await pet.waitForTimeout(13_000)
    await expect(pet.locator('.live2d-pet-host')).toHaveAttribute('data-motion-group', 'WorkingLoop')
    await pet.screenshot({ path: test.info().outputPath('native-working-with-real-pet-ui.png') })

    await publish(app, { ...active, creation: { phase: 'reviewing', message: '正在核对真实执行证据（边界fixture）' } })
    await expect(pet.locator('.pet-stage')).toHaveAttribute('data-work-phase', 'reviewing')
    await expect(pet.locator('.live2d-pet-host')).toHaveAttribute('data-motion-group', 'Think')
    const ready: ActivityStatus = { ...active, busy: false, creation: { phase: 'ready', message: '文件和输出均已核验（边界fixture）', artifact: {
      id: '24f71552-e878-4577-8485-6c52fe1fd72c', kind: 'code', title: '独立状态样例', name: 'main.py',
      sha256: '0'.repeat(64), bytes: 8, preview: 'print(1)', stdout: '1', review: '独立审阅通过', attempt: 0
    } } }
    await publish(app, ready)
    await expect(pet.getByTestId('pet-isolation-progress')).toContainText('产物已核验，待保存')
    await expect(pet.locator('.live2d-pet-host')).toHaveAttribute('data-motion-group', 'Agree')
    await pet.getByRole('button', { name: '查看或保存', exact: true }).click()
    await expect(main.getByTestId('autonomy-export')).toBeEnabled()
    await pet.screenshot({ path: test.info().outputPath('verified-artifact-before-saving.png') })

    const savedPath = `E:\\独立测试资料\\${'LongUnbrokenDirectoryName'.repeat(8)}\\result.py`
    await publish(app, { ...ready, creation: { ...ready.creation!, saved: {
      artifactId: ready.creation!.artifact!.id, path: savedPath, bytes: ready.creation!.artifact!.bytes, sha256: ready.creation!.artifact!.sha256
    } } })
    const progress = pet.getByTestId('pet-isolation-progress')
    await expect(progress).toContainText('产物已保存')
    await expect(progress).toContainText(savedPath)
    expect(await progress.locator('.pet-activity-main span').evaluate(element => {
      const card = element.closest('[data-testid="pet-isolation-progress"]')!.getBoundingClientRect()
      const text = element.getBoundingClientRect()
      return text.right <= card.right - 1 && element.scrollWidth <= element.clientWidth + 1
    })).toBe(true)
    await pet.screenshot({ path: test.info().outputPath('saved-long-path-fits-card.png') })

    const stopped = { ...ready, running: false, phase: 'stopped' as const, canStop: false, reason: '已停止，保留旧产物只作历史状态' }
    await app.evaluate(({ BrowserWindow, ipcMain }, payload) => {
      ipcMain.removeHandler(payload.stopChannel)
      ipcMain.handle(payload.stopChannel, () => {
        ipcMain.removeHandler(payload.statusChannel)
        ipcMain.handle(payload.statusChannel, () => payload.state)
        for (const window of BrowserWindow.getAllWindows()) window.webContents.send(payload.channel, payload.state)
        return { ok: true, data: payload.state }
      })
    }, { state: stopped, channel: IPC.autonomy.updated, statusChannel: IPC.autonomy.status, stopChannel: IPC.autonomy.stop })
    await pet.getByRole('button', { name: '结束活动', exact: true }).click()
    await expect(pet.getByTestId('pet-isolation-progress')).toHaveCount(0)
    await expect(pet.locator('.pet-stage')).toHaveAttribute('data-work-phase', 'idle')
    await expect(pet.locator('.live2d-pet-host')).toHaveAttribute('data-motion-group', 'Idle')
    await pet.screenshot({ path: test.info().outputPath('stopped-no-stale-success.png') })
  } finally { await closeApp(app) }
})
