import { expect, test } from '@playwright/test'
import { closeApp, findMainPage, launchApp } from './helpers'

/**
 * 通知风暴：连续失败的红色提示不能无限堆 DOM。
 * 无模型配置时发送消息会快速失败并产生红色持久提示；连续 20 次后提示数应有上限，
 * 页面仍可交互，关闭后全部清空。
 */
test('[QA-NOTIFY-03] 连续 20 次失败提示不会无限堆叠，页面仍可交互', async () => {
  const app = await launchApp()
  try {
    const page = await findMainPage(app)
    await page.getByTestId('nav-chat').click()
    await page.getByLabel('新建会话', { exact: true }).click()
    for (let index = 0; index < 30; index += 1) {
      await page.getByTestId('chat-input').fill(`风暴测试 ${index}`)
      await page.getByTestId('chat-send').click()
      await page.waitForTimeout(30)
    }
    await expect.poll(async () => page.locator('.toast').count(), { timeout: 10_000 }).toBeLessThanOrEqual(22)
    const redCount = await page.locator('.toast-red').count()
    expect(redCount).toBeGreaterThan(0)
    expect(redCount).toBeLessThanOrEqual(20)

    // 页面仍可交互：切换到记忆页再回来。
    await page.getByTestId('nav-memory').click()
    await expect(page.getByTestId('add-memory')).toBeVisible()

    // 关闭全部提示后不再残留。
    for (let guard = 0; guard < 10; guard += 1) {
      const close = page.locator('.toast button')
      if ((await close.count()) === 0) break
      await close.first().click()
    }
    await expect(page.locator('.toast')).toHaveCount(0)
  } finally {
    await closeApp(app)
  }
})
