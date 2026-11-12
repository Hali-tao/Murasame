import { expect, test } from '@playwright/test'
import { closeApp, configureTestModel, findMainPage, launchApp, startModelServer } from './helpers'

/**
 * F-03 情绪原因链：卡片如实显示「刚刚发生了什么」，
 * 初始没有事件时显示诚实的空状态；一次真实对话回复后显示事件原因（不显示数值、不猜动机）。
 */
test('[FR-EMO-15] 情绪天气显示最近一次情绪事件的原因，初始为空状态', async () => {
  const server = await startModelServer()
  const app = await launchApp()
  try {
    const page = await findMainPage(app)
    const card = page.getByTestId('affect-weather')
    await expect(card).toBeVisible()
    const reason = card.getByTestId('affect-weather-reason')
    await expect(reason).toHaveText('还没有值得解释的情绪变化。')

    await configureTestModel(page, server.url)
    await page.getByTestId('nav-chat').click()
    await page.getByLabel('新建会话', { exact: true }).click()
    await page.getByTestId('chat-input').fill('你好，今天过得怎么样？')
    await page.getByTestId('chat-send').click()
    await expect(page.locator('.message-row.assistant').last()).toContainText('真实流式回复')

    // 回到仪表盘（卡片重新挂载并拉取最新事件）。
    await page.getByTestId('nav-overview').click()
    await expect(card.getByTestId('affect-weather-reason')).toContainText(/收到对话回复|回复后的情绪评价/)
    // 原因行不出现情绪数值（PAD 小数）。
    const text = await card.innerText()
    expect(text).not.toMatch(/pleasure|arousal|dominance/i)
  } finally {
    await closeApp(app)
    await server.close()
  }
})
