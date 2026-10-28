# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: pet-work.spec.ts >> real pet follows current work, keeps a native loop and stops without celebrating stale output
- Location: tests\e2e\pet-work.spec.ts:20:5

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: getByTestId('pet-isolation-progress')
Expected substring: "等待创作内容"
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toContainText" getByTestId('pet-isolation-progress') with timeout 5000ms
  - waiting for getByTestId('pet-isolation-progress')

```

```yaml
- button "拖动桌宠，单击打开对话"
- button "缩小桌宠"
- text: 90%
- button "放大桌宠"
- button "复位桌宠位置"
- button "隐藏桌宠"
- text: MURASAME
```

# Test source

```ts
  1  | import { expect, test, type ElectronApplication } from '@playwright/test'
  2  | import type { ActivityStatus } from '../../src/shared/types'
  3  | import { IPC } from '../../src/shared/ipc'
  4  | import { closeApp, findMainPage, findPetPage, launchApp } from './helpers'
  5  |
  6  | const active: ActivityStatus = {
  7  |   activityId: 'synthetic-activity', kind: 'code', running: true, phase: 'running',
  8  |   reason: '独立状态边界验收', viewUrl: '', notes: [], taskStatus: '独立于任务',
  9  |   allowNetwork: false, canStop: true, busy: true
  10 | }
  11 |
  12 | async function publish(app: ElectronApplication, state: ActivityStatus): Promise<void> {
  13 |   await app.evaluate(({ BrowserWindow, ipcMain }, payload) => {
  14 |     ipcMain.removeHandler(payload.statusChannel)
  15 |     ipcMain.handle(payload.statusChannel, () => payload.state)
  16 |     for (const window of BrowserWindow.getAllWindows()) window.webContents.send(payload.channel, payload.state)
  17 |   }, { state, channel: IPC.autonomy.updated, statusChannel: IPC.autonomy.status })
  18 | }
  19 |
  20 | test('real pet follows current work, keeps a native loop and stops without celebrating stale output', async () => {
  21 |   test.setTimeout(90_000)
  22 |   const app = await launchApp()
  23 |   try {
  24 |     const main = await findMainPage(app)
  25 |     await main.evaluate(() => window.murasame.settings.update({ petPreset: 'naiwa', speakReplies: false }))
  26 |     const pet = await findPetPage(app)
  27 |     await expect(pet.locator('[data-model-id="naiwa"][data-live2d-state="ready"]')).toBeVisible({ timeout: 20_000 })
  28 |     // Synthetic status boundary; real preload, React surface, Cubism and native
  29 |     // window remain in use. Real Docker execution is covered by isolated-creation.
  30 |     await publish(app, { ...active, creation: { phase: 'drafting', message: '等待独立测试模型生成候选' } })
> 31 |     await expect(pet.getByTestId('pet-isolation-progress')).toContainText('等待创作内容')
     |                                                             ^ Error: expect(locator).toContainText(expected) failed
  32 |     await expect(pet.locator('.pet-stage')).toHaveAttribute('data-work-phase', 'waiting')
  33 |     await expect(pet.locator('.live2d-pet-host')).toHaveAttribute('data-motion-group', 'Think')
  34 |     await publish(app, { ...active, creation: { phase: 'executing', message: '独立测试：代码正在隔离区运行' } })
  35 |     await expect(pet.locator('.live2d-pet-host')).toHaveAttribute('data-motion-group', 'WorkingLoop')
  36 |     await expect(pet.getByTestId('pet-isolation-progress')).toContainText('正在运行代码')
  37 |     await pet.waitForTimeout(13_000)
  38 |     await expect(pet.locator('.live2d-pet-host')).toHaveAttribute('data-motion-group', 'WorkingLoop')
  39 |     await pet.screenshot({ path: test.info().outputPath('native-working-with-real-pet-ui.png') })
  40 |
  41 |     // An older restoration response must not resurrect Working after Ready.
  42 |     await app.evaluate(({ ipcMain }, channel) => {
  43 |       ipcMain.removeHandler(channel)
  44 |       ipcMain.handle(channel, () => new Promise(() => undefined))
  45 |     }, IPC.autonomy.status)
  46 |     await publish(app, { ...active, creation: { phase: 'reviewing', message: '正在核对真实执行证据（边界fixture）' } })
  47 |     await expect(pet.locator('.pet-stage')).toHaveAttribute('data-work-phase', 'reviewing')
  48 |     await expect(pet.locator('.live2d-pet-host')).toHaveAttribute('data-motion-group', 'Think')
  49 |     const ready: ActivityStatus = { ...active, busy: false, creation: { phase: 'ready', message: '文件和输出均已核验（边界fixture）', artifact: {
  50 |       id: '24f71552-e878-4577-8485-6c52fe1fd72c', kind: 'code', title: '独立状态样例', name: 'main.py',
  51 |       sha256: '0'.repeat(64), bytes: 8, preview: 'print(1)', stdout: '1', review: '独立审阅通过', attempt: 0
  52 |     } } }
  53 |     await publish(app, ready)
  54 |     await expect(pet.getByTestId('pet-isolation-progress')).toContainText('产物已核验，待保存')
  55 |     await expect(pet.locator('.live2d-pet-host')).toHaveAttribute('data-motion-group', 'Agree')
  56 |     await pet.getByRole('button', { name: '查看或保存', exact: true }).click()
  57 |     await expect(main.getByTestId('autonomy-export')).toBeEnabled()
  58 |     await pet.screenshot({ path: test.info().outputPath('verified-artifact-before-saving.png') })
  59 |
  60 |     const stopped = { ...ready, running: false, phase: 'stopped' as const, canStop: false, reason: '已停止，保留旧产物只作历史状态' }
  61 |     await app.evaluate(({ BrowserWindow, ipcMain }, payload) => {
  62 |       ipcMain.removeHandler(payload.stopChannel)
  63 |       ipcMain.handle(payload.stopChannel, () => {
  64 |         ipcMain.removeHandler(payload.statusChannel)
  65 |         ipcMain.handle(payload.statusChannel, () => payload.state)
  66 |         for (const window of BrowserWindow.getAllWindows()) window.webContents.send(payload.channel, payload.state)
  67 |         return { ok: true, data: payload.state }
  68 |       })
  69 |     }, { state: stopped, channel: IPC.autonomy.updated, statusChannel: IPC.autonomy.status, stopChannel: IPC.autonomy.stop })
  70 |     await pet.getByRole('button', { name: '结束活动', exact: true }).click()
  71 |     await expect(pet.getByTestId('pet-isolation-progress')).toHaveCount(0)
  72 |     await expect(pet.locator('.pet-stage')).toHaveAttribute('data-work-phase', 'idle')
  73 |     await expect(pet.locator('.live2d-pet-host')).toHaveAttribute('data-motion-group', 'Idle')
  74 |     await pet.screenshot({ path: test.info().outputPath('stopped-no-stale-success.png') })
  75 |   } finally { await closeApp(app) }
  76 | })
  77 |
```
