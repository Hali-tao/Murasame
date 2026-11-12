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

    // 添加一条真实记忆，再回到仪表盘：回顾应显示「新记住 1 条」，而不是空状态。
    await page.getByTestId('nav-memory').click()
    await page.getByTestId('add-memory').click()
    await page.getByTestId('memory-category').fill('偏好')
    await page.getByTestId('memory-text').fill('回顾测试：我喜欢早上喝温水')
    await page.getByRole('button', { name: '添加记忆', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)

    await page.getByTestId('nav-overview').click()
    const facts = page.getByTestId('daily-recap-facts')
    await expect(facts).toBeVisible()
    await expect(facts).toContainText('新记住')
    await expect(facts).toContainText('1 条')
    // 回顾只读本地数据，不出现网络/模型调用措辞。
    await expect(card).toContainText('不调用模型')
  } finally {
    await closeApp(app)
  }
})
