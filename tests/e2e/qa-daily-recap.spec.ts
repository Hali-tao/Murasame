import { expect, test } from '@playwright/test'
import { closeApp, findMainPage, launchApp } from './helpers'

/**
 * F-02 每日回顾（事实版）：
 * 没活动时诚实显示空状态；有真实活动后只汇总真实事实，不评分、不打卡、不调用模型。
 */
test('[FR-RECAP-06] 仪表盘今日回顾：空状态诚实，新增记忆后显示真实计数', async () => {
  const app = await launchApp()
  try {
    const page = await findMainPage(app)
    const card = page.getByTestId('daily-recap')
    await expect(card).toBeVisible()
    await expect(card).toContainText('不做评分或打卡')
    await expect(card.getByTestId('daily-recap-empty')).toContainText('今天还没有可回顾的记录')

    // 停留在仪表盘：直接新增一条记忆（模拟其它入口/自动提取），回顾应自动刷新，无需重新挂载。
    const added = await page.evaluate(() => window.murasame.core.addMemory('偏好', '回顾测试：我喜欢早上喝温水'))
    expect(added.ok).toBe(true)
    const facts = page.getByTestId('daily-recap-facts')
    await expect(facts).toBeVisible({ timeout: 10_000 })
    await expect(facts).toContainText('新记住')
    await expect(facts).toContainText('1 条')
    // 回顾只读本地数据，不出现网络/模型调用措辞。
    await expect(card).toContainText('不调用模型')
  } finally {
    await closeApp(app)
  }
})
