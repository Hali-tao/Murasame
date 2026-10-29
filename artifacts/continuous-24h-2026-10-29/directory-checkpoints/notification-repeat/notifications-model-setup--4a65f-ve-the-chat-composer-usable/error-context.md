# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: notifications.spec.ts >> model setup has one complete result and notifications leave the chat composer usable
- Location: tests\e2e\notifications.spec.ts:5:5

# Error details

```
Error: expect(locator).toHaveCount(expected) failed

Locator:  locator('.toast')
Expected: 0
Received: 1
Timeout:  8000ms

Call log:
  - Expect "toHaveCount" locator('.toast') with timeout 8000ms
  - waiting for locator('.toast')
    10 × locator resolved to 2 elements
       - unexpected value "2"
    2 × locator resolved to 1 element
      - unexpected value "1"

```

# Test source

```ts
  1   | import { expect, test } from '@playwright/test'
  2   | import { IPC } from '../../src/shared/ipc'
  3   | import { closeApp, configureTestModel, findMainPage, launchApp, startModelServer } from './helpers'
  4   |
  5   | test('model setup has one complete result and notifications leave the chat composer usable', async () => {
  6   |   test.setTimeout(90_000)
  7   |   const server = await startModelServer()
  8   |   const app = await launchApp()
  9   |   try {
  10  |     const page = await findMainPage(app)
  11  |     await configureTestModel(page, server.url, '独立通知测试服务')
  12  |     await expect(page.locator('.toast')).toHaveCount(1)
  13  |     await expect(page.locator('.toast')).toContainText('独立通知测试服务 已验证并设为当前服务')
  14  |     await page.getByTestId('nav-memory').click()
  15  |     await page.getByTestId('add-memory').click()
  16  |     await page.getByTestId('memory-category').fill('偏好')
  17  |     await page.getByTestId('memory-text').fill('独立界面测试：回答时优先说明结果。')
  18  |     await page.getByRole('button', { name: '添加记忆', exact: true }).click()
  19  |     await expect(page.getByRole('dialog')).toHaveCount(0)
  20  |     await page.getByTestId('nav-chat').click()
  21  |     await page.getByLabel('新建会话', { exact: true }).click()
  22  |     const pageLayout = await page.locator('.content-scroll').evaluate(element => ({ height: element.clientHeight, contentHeight: element.scrollHeight, scrollTop: element.scrollTop }))
  23  |     expect(pageLayout.contentHeight).toBeLessThanOrEqual(pageLayout.height + 1)
  24  |     expect(pageLayout.scrollTop).toBe(0)
  25  |     await page.getByTestId('chat-input').fill('确认通知不会挡住发送按钮')
  26  |     await expect(page.getByTestId('chat-input')).toBeFocused()
  27  |     const stack = await page.getByRole('region', { name: '操作提示' }).boundingBox()
  28  |     const input = await page.getByTestId('chat-input').boundingBox()
  29  |     expect(stack).not.toBeNull()
  30  |     expect(input).not.toBeNull()
  31  |     expect(stack!.y + stack!.height).toBeLessThan(input!.y)
  32  |     expect(await page.locator('.toast').count()).toBeLessThanOrEqual(2)
  33  |     await page.getByTestId('chat-send').click({ trial: true })
  34  |     await page.screenshot({ path: test.info().outputPath('actual-model-memory-notifications.png') })
  35  |     await page.getByTestId('chat-send').click()
  36  |     await expect(page.locator('.message-row.assistant').last()).toContainText('真实流式回复')
> 37  |     await expect(page.locator('.toast')).toHaveCount(0, { timeout: 8000 })
      |                                          ^ Error: expect(locator).toHaveCount(expected) failed
  38  |   } finally { await closeApp(app); await server.close() }
  39  | })
  40  |
  41  | test('distinct errors remain scrollable and keyboard dismissible after routine notices expire', async () => {
  42  |   test.setTimeout(90_000)
  43  |   const server = await startModelServer()
  44  |   const app = await launchApp()
  45  |   try {
  46  |     const page = await findMainPage(app)
  47  |     await configureTestModel(page, server.url, '独立错误提示测试')
  48  |     // Controlled failures at the main-process IPC boundary exercise the real
  49  |     // ModelsPage/store/ToastHost, without touching user data or a remote provider.
  50  |     await app.evaluate(({ ipcMain }, channel) => {
  51  |       let sequence = 0
  52  |       ipcMain.removeHandler(channel)
  53  |       ipcMain.handle(channel, () => ({ ok: false, error: `独立测试失败 ${++sequence}：这条提示需要手动关闭，旧配置仍然保留。` }))
  54  |     }, IPC.core.verifyModel)
  55  |     for (let index = 1; index <= 6; index += 1) {
  56  |       await page.getByRole('button', { name: '再测一次', exact: true }).click()
  57  |       await expect(page.locator('.toast-red')).toHaveCount(index)
  58  |     }
  59  |     await page.getByTestId('nav-chat').click()
  60  |     await page.getByLabel('新建会话', { exact: true }).click()
  61  |     await page.getByTestId('chat-input').fill('错误提示保留时，仍可继续输入')
  62  |     await page.waitForTimeout(5500)
  63  |     await expect(page.locator('.toast-red')).toHaveCount(6)
  64  |     await expect(page.getByTestId('chat-input')).toBeFocused()
  65  |     const region = page.getByRole('region', { name: '操作提示' })
  66  |     const size = await region.evaluate(element => ({ height: element.clientHeight, scrollHeight: element.scrollHeight, viewportHeight: window.innerHeight }))
  67  |     expect(size.scrollHeight).toBeGreaterThan(size.height)
  68  |     expect(size.height).toBeLessThanOrEqual(size.viewportHeight * 0.36 + 1)
  69  |     await page.getByTestId('chat-send').click({ trial: true })
  70  |     await page.screenshot({ path: test.info().outputPath('actual-persistent-errors.png') })
  71  |     const closeLast = page.getByRole('button', { name: /^关闭提示：独立测试失败 6/ })
  72  |     await closeLast.focus()
  73  |     await expect(closeLast).toBeFocused()
  74  |     await page.keyboard.press('Enter')
  75  |     await expect(page.locator('.toast-red')).toHaveCount(5)
  76  |     await expect(page.getByRole('alert').filter({ hasText: '独立测试失败 6' })).toHaveCount(0)
  77  |     await app.evaluate(({ BrowserWindow }) => {
  78  |       const main = BrowserWindow.getAllWindows().find(window => !window.webContents.getURL().includes('/pet.html'))
  79  |       main?.setSize(1024, 640)
  80  |     })
  81  |     await page.getByTestId('nav-models').click()
  82  |     await app.evaluate(({ ipcMain }, channel) => {
  83  |       ipcMain.removeHandler(channel)
  84  |       ipcMain.handle(channel, () => ({ ok: false, error: `独立长错误：${'这是用于检查换行和关闭入口的独立测试内容。'.repeat(28)}` }))
  85  |     }, IPC.core.verifyModel)
  86  |     await page.getByRole('button', { name: '再测一次', exact: true }).click()
  87  |     const longError = page.getByRole('alert').filter({ hasText: '独立长错误：' })
  88  |     await expect(longError).toHaveCount(1)
  89  |     const closeLong = longError.getByRole('button', { name: /^关闭提示：独立长错误/ })
  90  |     await closeLong.focus()
  91  |     await expect(closeLong).toBeInViewport()
  92  |     const overflow = await region.evaluate(element => element.scrollWidth > element.clientWidth)
  93  |     expect(overflow).toBe(false)
  94  |     await page.screenshot({ path: test.info().outputPath('actual-small-window-long-error.png') })
  95  |     await page.keyboard.press('Enter')
  96  |     await expect(longError).toHaveCount(0)
  97  |     await page.getByRole('button', { name: '再测一次', exact: true }).click({ trial: true })
  98  |   } finally { await closeApp(app); await server.close() }
  99  | })
  100 |
```
