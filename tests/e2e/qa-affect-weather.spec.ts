import { expect, test } from '@playwright/test'
import { closeApp, findMainPage, launchApp } from './helpers'

/**
 * F-03 情绪天气切片：仪表盘上只显示定性状态与设计边界，
 * 不暴露 PAD 数值、不推断原因、不向用户索取安慰。
 */
test('[FR-EMO-06] 仪表盘显示定性的情绪天气，不显示数值、不索取安慰', async () => {
  const app = await launchApp()
  try {
    const page = await findMainPage(app)
    const card = page.getByTestId('affect-weather')
    await expect(card).toBeVisible()
    await expect(card).toContainText('只显示状态，不显示数值')

    const label = card.getByTestId('affect-weather-label')
    await expect(label).toBeVisible()
    await expect(label).toHaveText(/^(晴|多云转晴|小雨|起风)$/)

    // 卡片整体不得出现情绪数值（PAD 小数）。
    const text = await card.innerText()
    expect(text).not.toMatch(/\d+\.\d+/)
    expect(text).not.toMatch(/pleasure|arousal|dominance/i)

    // 设计边界必须可见：不索取安慰 / 不影响任务结果。
    expect(text).toMatch(/不影响任务结果|不会用情绪向你提要求|重启后会回到平静基线/)
  } finally {
    await closeApp(app)
  }
})
