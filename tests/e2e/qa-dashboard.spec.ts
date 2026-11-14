import { expect, test } from '@playwright/test'
import { closeApp, findMainPage, launchApp } from './helpers'

test.describe('[FULL-QA] 仪表盘快捷入口与统计', () => {
  test('[DASH-10] 快捷按钮真实跳转到对话与任务页', async () => {
    const app = await launchApp()
    try {
      const page = await findMainPage(app)
      await page.getByRole('button', { name: '继续交流' }).click()
      await expect(page).toHaveURL(/\/chat/)
      await page.getByTestId('nav-overview').click()
      await page.getByRole('button', { name: '查看今日任务' }).click()
      await expect(page).toHaveURL(/\/tasks/)
      await expect(page.getByTestId('nav-tasks')).toBeVisible()
    } finally {
      await closeApp(app)
    }
  })

  test('[DASH-11] 统计卡展示真实记忆与可用能力计数', async () => {
    const app = await launchApp()
    try {
      const page = await findMainPage(app)
      const added = await page.evaluate(() => window.murasame.core.addMemory('偏好', '仪表盘统计测试记忆'))
      expect(added.ok).toBe(true)
      await page.getByTestId('nav-memory').click()
      await page.getByTestId('nav-overview').click()
      const counts = await page.evaluate(async () => {
        const state = await window.murasame.core.getBootstrap()
        if (!state.ok) throw new Error(state.error)
        return {
          memories: state.data.memories.length,
          tools: state.data.tools.length,
          enabledTools: state.data.tools.filter((tool) => tool.enabled).length
        }
      })
      const grid = page.locator('.stat-grid')
      await expect(grid.locator('.stat-tile').filter({ hasText: '长期记忆' })).toContainText(String(counts.memories))
      await expect(grid.locator('.stat-tile').filter({ hasText: '可用能力' })).toContainText(`${counts.enabledTools} / ${counts.tools}`)
    } finally {
      await closeApp(app)
    }
  })
})
