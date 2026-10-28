# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: pet-work.spec.ts >> real pet follows current work, keeps a native loop and stops without celebrating stale output
- Location: tests\e2e\pet-work.spec.ts:20:5

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false
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
  31 |     await expect(pet.getByTestId('pet-isolation-progress')).toContainText('等待创作内容')
  32 |     await expect(pet.locator('.pet-stage')).toHaveAttribute('data-work-phase', 'waiting')
  33 |     await expect(pet.locator('.live2d-pet-host')).toHaveAttribute('data-motion-group', 'Think')
  34 |     await publish(app, { ...active, creation: { phase: 'executing', message: '独立测试：代码正在隔离区运行' } })
  35 |     await expect(pet.locator('.live2d-pet-host')).toHaveAttribute('data-motion-group', 'WorkingLoop')
  36 |     await expect(pet.getByTestId('pet-isolation-progress')).toContainText('正在运行代码')
  37 |     await pet.waitForTimeout(13_000)
  38 |     await expect(pet.locator('.live2d-pet-host')).toHaveAttribute('data-motion-group', 'WorkingLoop')
  39 |     await pet.screenshot({ path: test.info().outputPath('native-working-with-real-pet-ui.png') })
  40 |
  41 |     await publish(app, { ...active, creation: { phase: 'reviewing', message: '正在核对真实执行证据（边界fixture）' } })
  42 |     await expect(pet.locator('.pet-stage')).toHaveAttribute('data-work-phase', 'reviewing')
  43 |     await expect(pet.locator('.live2d-pet-host')).toHaveAttribute('data-motion-group', 'Think')
  44 |     const ready: ActivityStatus = { ...active, busy: false, creation: { phase: 'ready', message: '文件和输出均已核验（边界fixture）', artifact: {
  45 |       id: '24f71552-e878-4577-8485-6c52fe1fd72c', kind: 'code', title: '独立状态样例', name: 'main.py',
  46 |       sha256: '0'.repeat(64), bytes: 8, preview: 'print(1)', stdout: '1', review: '独立审阅通过', attempt: 0
  47 |     } } }
  48 |     await publish(app, ready)
  49 |     await expect(pet.getByTestId('pet-isolation-progress')).toContainText('产物已核验，待保存')
  50 |     await expect(pet.locator('.live2d-pet-host')).toHaveAttribute('data-motion-group', 'Agree')
  51 |     await pet.getByRole('button', { name: '查看或保存', exact: true }).click()
  52 |     await expect(main.getByTestId('autonomy-export')).toBeEnabled()
  53 |     await pet.screenshot({ path: test.info().outputPath('verified-artifact-before-saving.png') })
  54 |
  55 |     const savedPath = `E:\\独立测试资料\\${'LongUnbrokenDirectoryName'.repeat(8)}\\result.py`
  56 |     await publish(app, { ...ready, creation: { ...ready.creation!, saved: {
  57 |       artifactId: ready.creation!.artifact!.id, path: savedPath, bytes: ready.creation!.artifact!.bytes, sha256: ready.creation!.artifact!.sha256
  58 |     } } })
  59 |     const progress = pet.getByTestId('pet-isolation-progress')
  60 |     await expect(progress).toContainText('产物已保存')
  61 |     await expect(progress).toContainText(savedPath)
  62 |     expect(await progress.locator('.pet-activity-main span').evaluate(element => {
  63 |       const card = element.closest('[data-testid="pet-isolation-progress"]')!.getBoundingClientRect()
  64 |       const text = element.getBoundingClientRect()
  65 |       return text.right <= card.right - 1 && element.scrollWidth <= element.clientWidth + 1
> 66 |     })).toBe(true)
     |         ^ Error: expect(received).toBe(expected) // Object.is equality
  67 |     await pet.screenshot({ path: test.info().outputPath('saved-long-path-fits-card.png') })
  68 |
  69 |     const stopped = { ...ready, running: false, phase: 'stopped' as const, canStop: false, reason: '已停止，保留旧产物只作历史状态' }
  70 |     await app.evaluate(({ BrowserWindow, ipcMain }, payload) => {
  71 |       ipcMain.removeHandler(payload.stopChannel)
  72 |       ipcMain.handle(payload.stopChannel, () => {
  73 |         ipcMain.removeHandler(payload.statusChannel)
  74 |         ipcMain.handle(payload.statusChannel, () => payload.state)
  75 |         for (const window of BrowserWindow.getAllWindows()) window.webContents.send(payload.channel, payload.state)
  76 |         return { ok: true, data: payload.state }
  77 |       })
  78 |     }, { state: stopped, channel: IPC.autonomy.updated, statusChannel: IPC.autonomy.status, stopChannel: IPC.autonomy.stop })
  79 |     await pet.getByRole('button', { name: '结束活动', exact: true }).click()
  80 |     await expect(pet.getByTestId('pet-isolation-progress')).toHaveCount(0)
  81 |     await expect(pet.locator('.pet-stage')).toHaveAttribute('data-work-phase', 'idle')
  82 |     await expect(pet.locator('.live2d-pet-host')).toHaveAttribute('data-motion-group', 'Idle')
  83 |     await pet.screenshot({ path: test.info().outputPath('stopped-no-stale-success.png') })
  84 |   } finally { await closeApp(app) }
  85 | })
  86 |
```
