import { expect, test } from '@playwright/test'
import { closeApp, findMainPage, launchApp } from './helpers'

for (const action of ['delete-last', 'change-category', 'delete-with-survivor'] as const) {
  test(`[FR-15] 记忆类别筛选在 ${action} 后保持与真实条目一致`, async () => {
    const app = await launchApp()
    try {
      const page = await findMainPage(app)
      await page.evaluate(async action => {
        const entries = [['偏好', '类别回归：早上喝温水'], ['项目', '类别回归：整理项目报告']]
        if (action === 'delete-with-survivor') entries.push(['偏好', '类别回归：早上散步'])
        for (const [category, text] of entries) {
          const result = await window.murasame.core.addMemory(category, text)
          if (!result.ok) throw new Error(result.error)
        }
      }, action)
      await page.getByTestId('nav-memory').click()
      const filter = page.getByRole('combobox', { name: '筛选类别' })
      await filter.selectOption('偏好')
      const target = page.getByTestId('memory-card').filter({ hasText: '类别回归：早上喝温水' })
      if (action === 'change-category') {
        await target.getByRole('button', { name: '编辑', exact: true }).click()
        await page.getByTestId('memory-category').fill('项目')
        await page.getByRole('button', { name: '保存更正', exact: true }).click()
      } else {
        await target.getByRole('button', { name: '删除', exact: true }).click()
        await page.getByRole('button', { name: '删除记忆', exact: true }).click()
      }
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(filter).toHaveValue(action === 'delete-with-survivor' ? '偏好' : '全部类别')
      await expect(page.getByTestId('memory-card')).toHaveCount(action === 'change-category' ? 2 : 1)
      await expect(page.getByTestId('memory-card').first()).toContainText(action === 'delete-with-survivor' ? '早上散步' : action === 'delete-last' ? '整理项目报告' : '类别回归')
      const state = await page.evaluate(() => window.murasame.core.getBootstrap())
      if (!state.ok) throw new Error(state.error)
      expect(state.data.memories).toHaveLength(action === 'delete-last' ? 1 : 2)
      if (action === 'change-category') expect(state.data.memories.every(memory => memory.category === '项目')).toBe(true)
      await page.screenshot({ path: test.info().outputPath(`${action}.png`) })
    } finally { await closeApp(app) }
  })
}
