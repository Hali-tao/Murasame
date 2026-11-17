import { expect, test } from '@playwright/test'
import { closeApp, configureTestModel, findMainPage, launchApp, startModelServer } from './helpers'

test('[FR-12] 历史正文按 Unicode 大小写匹配，符号按字面检索', async () => {
  const server = await startModelServer()
  const app = await launchApp()
  try {
    const page = await findMainPage(app)
    await configureTestModel(page, server.url)
    await page.getByTestId('nav-chat').click()
    await page.getByLabel('新建会话', { exact: true }).click()
    // Keep the searched content beyond the generated title and preview.
    const body = '这是检索回归记录的背景说明，仅用于让地点名称保存在正文的较后位置。ÉCOLE МОСКВА ΑΘΗΝΑ 100%_\\'
    await page.getByTestId('chat-input').fill(body)
    await page.getByTestId('chat-send').click()
    await expect(page.locator('.message-row.assistant').last()).toContainText('真实流式回复')
    await page.getByTestId('nav-history').click()
    const search = page.getByRole('textbox', { name: '搜索历史' })
    for (const keyword of ['école', 'москва', 'αθηνα', '100%_\\']) {
      const result = await page.evaluate(value => window.murasame.core.searchHistory(value), keyword)
      expect(result.ok && result.data.status === 'ok' ? result.data.items.length : 0).toBe(1)
      await search.fill(keyword)
      await expect(page.getByTestId('history-item')).toHaveCount(1)
      await expect(page.locator('.history-messages')).toContainText(body)
    }
    await search.fill('肯定不存在的地点')
    await expect(page.getByTestId('history-item')).toHaveCount(0)
    await expect(page.getByText('没有匹配的会话')).toBeVisible()
    await search.fill('')
    await expect(page.getByTestId('history-item')).toHaveCount(1)
  } finally {
    await closeApp(app)
    await server.close()
  }
})
