import { expect, test } from '@playwright/test'
import { closeApp, findMainPage, launchApp } from './helpers'

test('context labels stay on one line and explain remote model requests', async () => {
  const app = await launchApp()
  try {
    const page = await findMainPage(app)
    await page.getByTestId('nav-chat').click()
    const panel = page.locator('#chat-context-panel')
    await expect(panel.getByText('对话上下文', { exact: true })).toBeVisible()
    await expect(panel).toContainText('使用远程模型时，消息和相关上下文会联网发送给模型服务')
    await expect(panel.getByText('仅本机', { exact: true })).toHaveCount(0)
    const label = panel.locator('.context-list span').filter({ hasText: '已保存记忆' })
    for (const zoom of [1, 1.25]) {
      await app.evaluate(({ BrowserWindow }, factor) => {
        const window = BrowserWindow.getAllWindows().find(item => !item.webContents.getURL().includes('/pet.html'))!
        window.setSize(1440, 1000)
        window.webContents.setZoomFactor(factor)
      }, zoom)
      await expect(label).toBeVisible()
      await expect.poll(() => label.evaluate(element => {
        const range = document.createRange()
        range.selectNodeContents(element)
        return new Set(Array.from(range.getClientRects(), rect => Math.round(rect.top))).size
      })).toBe(1)
    }
  } finally { await closeApp(app) }
})
