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

/**
 * F-01 房间视图（隐私遮罩）：正文默认遮蔽且 DOM 中不含原文；可单条显示；Esc 一次遮罩全部。
 */
test('[F-01-ROOM-01] 记忆房间视图默认遮蔽正文，Esc 可一次遮罩全部', async () => {
  const app = await launchApp()
  try {
    const page = await findMainPage(app)
    const phrase = '周末喜欢去江边散步，不喜欢太吵的地方。'
    await page.evaluate((text) => window.murasame.core.addMemory('偏好', text), phrase)
    await page.getByTestId('nav-memory').click()
    // 列表视图仍显示正文（默认行为不变）。
    await expect(page.getByTestId('memory-card').filter({ hasText: '周末喜欢去江边散步' })).toContainText(phrase)

    await page.getByTestId('memory-view-room').click()
    const room = page.getByTestId('memory-room')
    await expect(room).toBeVisible()
    await expect(room).toContainText('房间只在本机显示，不会上传')
    await expect(page.getByTestId('memory-room-masked')).toBeVisible()
    // 遮罩状态下 DOM 中不应出现原文（F-01/AC-7）。
    await expect(page.getByText(phrase)).toHaveCount(0)

    const roomCard = page.getByTestId('memory-room-card').filter({ hasText: '偏好' })
    await roomCard.getByTestId('memory-room-reveal').click()
    await expect(page.getByTestId('memory-room-text')).toHaveText(phrase)

    // Esc 一次遮罩全部正文。
    await page.keyboard.press('Escape')
    await expect(page.getByText(phrase)).toHaveCount(0)
    await expect(page.getByTestId('memory-room-masked')).toBeVisible()

    // 切回列表视图仍可正常阅读（房间只是视图，不改数据）。
    await page.getByTestId('memory-view-list').click()
    await expect(page.getByTestId('memory-card').filter({ hasText: '周末喜欢去江边散步' })).toContainText(phrase)
  } finally {
    await closeApp(app)
  }
})
