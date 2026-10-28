import { expect, test } from '@playwright/test'
import { IPC } from '../../src/shared/ipc'
import { closeApp, configureTestModel, findMainPage, launchApp, startModelServer } from './helpers'

test('model setup has one complete result and notifications leave the chat composer usable', async () => {
  test.setTimeout(90_000)
  const server = await startModelServer()
  const app = await launchApp()
  try {
    const page = await findMainPage(app)
    await configureTestModel(page, server.url, '独立通知测试服务')
    await expect(page.locator('.toast')).toHaveCount(1)
    await expect(page.locator('.toast')).toContainText('独立通知测试服务 已验证并设为当前服务')
    await page.getByTestId('nav-memory').click()
    await page.getByTestId('add-memory').click()
    await page.getByTestId('memory-category').fill('偏好')
    await page.getByTestId('memory-text').fill('独立界面测试：回答时优先说明结果。')
    await page.getByRole('button', { name: '添加记忆', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.getByTestId('nav-chat').click()
    await page.getByLabel('新建会话', { exact: true }).click()
    const pageLayout = await page.locator('.content-scroll').evaluate(element => ({ height: element.clientHeight, contentHeight: element.scrollHeight, scrollTop: element.scrollTop }))
    expect(pageLayout.contentHeight).toBeLessThanOrEqual(pageLayout.height + 1)
    expect(pageLayout.scrollTop).toBe(0)
    await page.getByTestId('chat-input').fill('确认通知不会挡住发送按钮')
    await expect(page.getByTestId('chat-input')).toBeFocused()
    const stack = await page.getByRole('region', { name: '操作提示' }).boundingBox()
    const input = await page.getByTestId('chat-input').boundingBox()
    expect(stack).not.toBeNull()
    expect(input).not.toBeNull()
    expect(stack!.y + stack!.height).toBeLessThan(input!.y)
    expect(await page.locator('.toast').count()).toBeLessThanOrEqual(2)
    await page.getByTestId('chat-send').click({ trial: true })
    await page.screenshot({ path: test.info().outputPath('actual-model-memory-notifications.png') })
    await page.getByTestId('chat-send').click()
    await expect(page.locator('.message-row.assistant').last()).toContainText('真实流式回复')
    await expect(page.locator('.toast')).toHaveCount(0, { timeout: 8000 })
  } finally { await closeApp(app); await server.close() }
})

test('distinct errors remain scrollable and keyboard dismissible after routine notices expire', async () => {
  test.setTimeout(90_000)
  const server = await startModelServer()
  const app = await launchApp()
  try {
    const page = await findMainPage(app)
    await configureTestModel(page, server.url, '独立错误提示测试')
    // Controlled failures at the main-process IPC boundary exercise the real
    // ModelsPage/store/ToastHost, without touching user data or a remote provider.
    await app.evaluate(({ ipcMain }, channel) => {
      let sequence = 0
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, () => ({ ok: false, error: `独立测试失败 ${++sequence}：这条提示需要手动关闭，旧配置仍然保留。` }))
    }, IPC.core.verifyModel)
    for (let index = 1; index <= 6; index += 1) {
      await page.getByRole('button', { name: '再测一次', exact: true }).click()
      await expect(page.locator('.toast-red')).toHaveCount(index)
    }
    await page.getByTestId('nav-chat').click()
    await page.getByLabel('新建会话', { exact: true }).click()
    await page.getByTestId('chat-input').fill('错误提示保留时，仍可继续输入')
    await page.waitForTimeout(5500)
    await expect(page.locator('.toast-red')).toHaveCount(6)
    await expect(page.getByTestId('chat-input')).toBeFocused()
    const region = page.getByRole('region', { name: '操作提示' })
    const size = await region.evaluate(element => ({ height: element.clientHeight, scrollHeight: element.scrollHeight, viewportHeight: window.innerHeight }))
    expect(size.scrollHeight).toBeGreaterThan(size.height)
    expect(size.height).toBeLessThanOrEqual(size.viewportHeight * 0.36 + 1)
    await page.getByTestId('chat-send').click({ trial: true })
    await page.screenshot({ path: test.info().outputPath('actual-persistent-errors.png') })
    const closeLast = page.getByRole('button', { name: /^关闭提示：独立测试失败 6/ })
    await closeLast.focus()
    await expect(closeLast).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.locator('.toast-red')).toHaveCount(5)
    await expect(page.getByRole('alert').filter({ hasText: '独立测试失败 6' })).toHaveCount(0)
    await app.evaluate(({ BrowserWindow }) => {
      const main = BrowserWindow.getAllWindows().find(window => !window.webContents.getURL().includes('/pet.html'))
      main?.setSize(1024, 640)
    })
    await page.getByTestId('nav-models').click()
    await app.evaluate(({ ipcMain }, channel) => {
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, () => ({ ok: false, error: `独立长错误：${'这是用于检查换行和关闭入口的独立测试内容。'.repeat(28)}` }))
    }, IPC.core.verifyModel)
    await page.getByRole('button', { name: '再测一次', exact: true }).click()
    const longError = page.getByRole('alert').filter({ hasText: '独立长错误：' })
    await expect(longError).toHaveCount(1)
    const closeLong = longError.getByRole('button', { name: /^关闭提示：独立长错误/ })
    await closeLong.focus()
    await expect(closeLong).toBeInViewport()
    const overflow = await region.evaluate(element => element.scrollWidth > element.clientWidth)
    expect(overflow).toBe(false)
    await page.screenshot({ path: test.info().outputPath('actual-small-window-long-error.png') })
    await page.keyboard.press('Enter')
    await expect(longError).toHaveCount(0)
    await page.getByRole('button', { name: '再测一次', exact: true }).click({ trial: true })
  } finally { await closeApp(app); await server.close() }
})
