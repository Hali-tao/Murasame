# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: pet-work.spec.ts >> real pet follows current work, keeps a native loop and stops without celebrating stale output
- Location: tests\e2e\pet-work.spec.ts:20:5

# Error details

```
Error: expect(locator).toBeEnabled() failed

Locator: getByTestId('autonomy-export')
Expected: enabled
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeEnabled" getByTestId('autonomy-export') with timeout 5000ms
  - waiting for getByTestId('autonomy-export')

```

```yaml
- complementary:
  - text: m murasame 桌面伙伴
  - navigation "主导航":
    - text: 对话
    - link "交流":
      - /url: "#/chat"
    - link "历史":
      - /url: "#/history"
    - link "长期记忆":
      - /url: "#/memory"
    - link "任务":
      - /url: "#/tasks"
    - text: 角色
    - link "角色设置":
      - /url: "#/character"
    - text: 设置
    - link "运行与隐私":
      - /url: "#/settings"
    - link "模型服务":
      - /url: "#/models"
    - link "工具与插件":
      - /url: "#/tools"
    - link "屏幕辅助":
      - /url: "#/screen"
    - link "自主活动":
      - /url: "#/autonomy"
    - link "概览":
      - /url: "#/"
  - text: 未
  - strong: 未命名
  - text: 运行中 · 本地加密 v0.9.0 · 本机运行
- banner:
  - heading "概览" [level=1]
  - paragraph: 今天的对话、任务和运行状态
  - text: 06:50 · 10月29日 模型服务待验证
  - button "隐藏桌宠"
  - button "隐藏到托盘"
- main:
  - text: 星期四 · 10月29日
  - heading "早上好，你。" [level=2]
  - paragraph: 桌宠会接着上次的对话。敏感操作仍然要你确认后才执行。
  - text: 模型待验证 记忆已启用 屏幕权限未授权
  - button "继续交流"
  - button "查看今日任务"
  - text: 进行中任务
  - strong: "0"
  - paragraph: 0 项等待批准
  - text: 长期记忆
  - strong: "0"
  - paragraph: 可逐条查看与删除
  - text: 本机消息
  - strong: "0"
  - paragraph: 0 个会话
  - text: 可用能力
  - strong: 4 / 7
  - paragraph: 3 项权限停用
  - heading "正在发生" [level=2]
  - paragraph: 来自对话、任务、屏幕与工具的最近记录
  - text: 还没有可展示的记录。
  - heading "当前任务" [level=2]
  - paragraph: 执行期间仍可继续交流
  - paragraph: 当前没有运行中的任务。
  - heading "运行状态" [level=2]
  - paragraph: 本地能力不受在线服务短暂波动影响
  - text: 桌面应用
  - strong: 正在运行
  - text: 本地数据
  - strong: 已加密 · 仅此设备
  - text: 屏幕采集
  - strong: 已关闭
  - text: 正在本地运行。 尚未创建会话
  - button "继续上次工作 →"
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
> 52 |     await expect(main.getByTestId('autonomy-export')).toBeEnabled()
     |                                                       ^ Error: expect(locator).toBeEnabled() failed
  53 |     await pet.screenshot({ path: test.info().outputPath('verified-artifact-before-saving.png') })
  54 |
  55 |     const stopped = { ...ready, running: false, phase: 'stopped' as const, canStop: false, reason: '已停止，保留旧产物只作历史状态' }
  56 |     await app.evaluate(({ BrowserWindow, ipcMain }, payload) => {
  57 |       ipcMain.removeHandler(payload.stopChannel)
  58 |       ipcMain.handle(payload.stopChannel, () => {
  59 |         ipcMain.removeHandler(payload.statusChannel)
  60 |         ipcMain.handle(payload.statusChannel, () => payload.state)
  61 |         for (const window of BrowserWindow.getAllWindows()) window.webContents.send(payload.channel, payload.state)
  62 |         return { ok: true, data: payload.state }
  63 |       })
  64 |     }, { state: stopped, channel: IPC.autonomy.updated, statusChannel: IPC.autonomy.status, stopChannel: IPC.autonomy.stop })
  65 |     await pet.getByRole('button', { name: '结束活动', exact: true }).click()
  66 |     await expect(pet.getByTestId('pet-isolation-progress')).toHaveCount(0)
  67 |     await expect(pet.locator('.pet-stage')).toHaveAttribute('data-work-phase', 'idle')
  68 |     await expect(pet.locator('.live2d-pet-host')).toHaveAttribute('data-motion-group', 'Idle')
  69 |     await pet.screenshot({ path: test.info().outputPath('stopped-no-stale-success.png') })
  70 |   } finally { await closeApp(app) }
  71 | })
  72 |
```
