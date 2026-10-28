import { expect, test } from '@playwright/test'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { EMBEDDING_FILES, EMBEDDING_MODEL_ID } from '../../src/main/local/embedding'
import { closeApp, configureTestModel, findMainPage, launchApp, startModelServer } from './helpers'

test('[FR-14] 真实离线BGE在Electron中召回独立偏好并进入实际对话请求', async () => {
  test.setTimeout(90_000)
  const model = resolve('build/bundled-models', EMBEDDING_MODEL_ID)
  const packaged = Boolean(process.env.MURASAME_E2E_EXECUTABLE)
  test.skip(!packaged && EMBEDDING_FILES.some(file => !existsSync(join(model, file))), '本机缺少真实BGE资产；不能用fixture向量冒充此验收')
  const requests: Array<Array<{ role: string; content: unknown }>> = []
  const server = await startModelServer({ onMessages: messages => requests.push(messages) })
  const app = await launchApp(true, userData => {
    // Packaged acceptance must use its own resources, never source-tree copies.
    if (packaged) return
    for (const file of EMBEDDING_FILES) {
      const target = join(userData, 'models', EMBEDDING_MODEL_ID, file)
      mkdirSync(dirname(target), { recursive: true }); copyFileSync(join(model, file), target)
    }
  })
  try {
    expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(packaged)
    const page = await findMainPage(app)
    await configureTestModel(page, server.url, '独立对话测试服务')
    await page.getByTestId('nav-memory').click()
    await page.getByTestId('add-memory').click()
    await page.getByTestId('memory-category').fill('偏好')
    await page.getByTestId('memory-text').fill('我不吃辣，喜欢清淡的菜。')
    await page.getByRole('button', { name: '添加记忆', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByTestId('memory-card')).toContainText('我不吃辣，喜欢清淡的菜。')
    const indexed = await page.evaluate(() => window.murasame.core.getBootstrap())
    expect(indexed.ok && indexed.data?.memoryIndex).toMatchObject({ state: 'idle', completed: 1, total: 1 })
    await page.getByTestId('nav-chat').click()
    await page.getByLabel('新建会话', { exact: true }).click()
    await page.getByTestId('chat-input').fill('推荐个菜')
    await page.getByTestId('chat-send').click()
    await expect.poll(() => requests.some(messages => messages.some(message => message.role === 'system' && String(message.content).includes('可参考的长期记忆：\n我不吃辣，喜欢清淡的菜。'))), { timeout: 20_000 }).toBe(true)
    const reply = page.locator('.message-row.assistant').last()
    await expect(reply).toContainText('真实流式回复')
    await reply.scrollIntoViewIfNeeded()
    await expect(page.locator('#chat-context-panel')).toBeVisible()
    await page.screenshot({ path: test.info().outputPath('actual-local-memory.png') })
  } finally { await closeApp(app); await server.close() }
})
