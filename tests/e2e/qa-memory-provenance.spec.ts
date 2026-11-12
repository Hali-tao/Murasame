import { expect, test } from '@playwright/test'
import { closeApp, findMainPage, launchApp } from './helpers'

/**
 * 记忆房间切片的可验证行为：新加的记忆若从未真正进入过模型上下文，
 * 不能假装它「记得」——必须显示「还没有被真正想起过」。
 * 正向路径（真实召回后显示来源）由单测覆盖：不依赖本机 BGE 资产。
 */
test('[QA-MEMRECALL-06] 新记忆在真正被召回前标注「还没有被真正想起过」', async () => {
  const app = await launchApp()
  try {
    const page = await findMainPage(app)
    await page.getByTestId('nav-memory').click()
    await page.getByTestId('add-memory').click()
    await page.getByTestId('memory-category').fill('偏好')
    await page.getByTestId('memory-text').fill('我周末喜欢去江边散步，不喜欢太吵的地方。')
    await page.getByRole('button', { name: '添加记忆', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const card = page.getByTestId('memory-card').filter({ hasText: '我周末喜欢去江边散步' })
    await expect(card).toBeVisible()
    await expect(card.getByTestId('memory-recall-source')).toHaveText('还没有被真正想起过')
    // 这条记忆不是从对话提取的：来源标签不能伪造会话。
    await expect(card).not.toContainText('来自：')
  } finally {
    await closeApp(app)
  }
})
