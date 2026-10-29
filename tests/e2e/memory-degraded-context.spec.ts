import { expect, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { EMBEDDING_FILES, EMBEDDING_MODEL_ID } from '../../src/main/local/embedding'
import { closeApp, configureTestModel, findMainPage, launchApp, startModelServer } from './helpers'

test('[NFR-U03] unusable local model does not silently become a successful empty memory search', async () => {
  test.setTimeout(90_000)
  const requests: Array<Array<{ role: string; content: unknown }>> = []
  const server = await startModelServer({ onMessages: messages => requests.push(messages) })
  const app = await launchApp(true, userData => {
    // A complete but invalid user override simulates damaged model files.
    // Only this fresh synthetic profile is changed; bundled models stay intact.
    for (const file of EMBEDDING_FILES) {
      const target = join(userData, 'models', EMBEDDING_MODEL_ID, file)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, 'synthetic invalid model content')
    }
  })
  try {
    const page = await findMainPage(app)
    await configureTestModel(page, server.url, '记忆降级独立测试')
    await page.getByTestId('nav-memory').click()
    await page.getByTestId('add-memory').click()
    await page.getByTestId('memory-category').fill('偏好')
    await page.getByTestId('memory-text').fill('我喜欢白茶，长期保留这条独立测试偏好。')
    await page.getByRole('button', { name: '添加记忆', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByTestId('memory-card')).toContainText('我喜欢白茶')
    const bootstrap = await page.evaluate(() => window.murasame.core.getBootstrap())
    expect(bootstrap.ok && bootstrap.data?.memoryIndex).toMatchObject({ completed: 0, total: 1 })
    await page.getByTestId('nav-chat').click()
    await page.getByLabel('新建会话', { exact: true }).click()
    const question = '我之前喜欢喝什么茶'
    await page.getByTestId('chat-input').fill(question)
    await page.getByTestId('chat-send').click()
    await expect(page.locator('.message-row.assistant').last()).toContainText('真实流式回复')
    const request = requests.find(messages => messages.some(item => item.role === 'user' && item.content === question))
    const system = request?.filter(item => item.role === 'system').map(item => String(item.content)).join('\n') ?? ''
    expect(system).toContain('本轮长期记忆检索不完整或暂不可用')
    expect(system).toContain('不得把未检出当作用户从未说过或没有这项偏好')
    expect(system).not.toContain('可参考的长期记忆：')
    await expect(page.getByTestId('memory-recall-status')).toContainText('记忆检索受限')
    await page.reload()
    await expect(page.getByTestId('memory-recall-status')).toContainText('记忆检索受限')
    await page.getByLabel('新建会话', { exact: true }).click()
    await expect(page.getByTestId('memory-recall-status')).toContainText('尚无检索记录')
    await page.locator('.conversation-item').filter({ hasText: question }).click()
    await expect(page.getByTestId('memory-recall-status')).toContainText('记忆检索受限')
    await page.screenshot({ path: test.info().outputPath('persisted-recall-warning.png'), fullPage: true })
    await page.getByTestId('nav-memory').click()
    await expect(page.getByTestId('memory-card')).toContainText('我喜欢白茶')
    await page.screenshot({ path: test.info().outputPath('preserved-memory-with-unavailable-index.png'), fullPage: true })
  } finally { await closeApp(app); await server.close() }
})
