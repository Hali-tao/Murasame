import { expect, test } from '@playwright/test'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { EMBEDDING_FILES, EMBEDDING_MODEL_ID } from '../../src/main/local/embedding'
import { IPC } from '../../src/shared/ipc'
import { closeApp, configureTestModel, findMainPage, launchApp, startModelServer } from './helpers'

async function launchWithMemory() {
  const model = resolve('build/bundled-models', EMBEDDING_MODEL_ID)
  const packaged = Boolean(process.env.MURASAME_E2E_EXECUTABLE)
  test.skip(!packaged && EMBEDDING_FILES.some(file => !existsSync(join(model, file))), 'Requires actual BGE assets')
  return launchApp(true, userData => {
    if (packaged) return
    for (const file of EMBEDDING_FILES) {
      const target = join(userData, 'models', EMBEDDING_MODEL_ID, file)
      mkdirSync(dirname(target), { recursive: true }); copyFileSync(join(model, file), target)
    }
  })
}

test('[FR-15] memory source opens its history and scoped clearing leaves no stale extraction notice', async () => {
  test.setTimeout(90_000)
  const server = await startModelServer({ toolResponse: tool => tool === 'remember'
    ? { memories: [{ action: 'ADD', category: 'user', text: '喜欢白茶' }] } : undefined })
  const app = await launchWithMemory()
  try {
    const page = await findMainPage(app)
    await configureTestModel(page, server.url)
    await page.getByTestId('nav-chat').click()
    await page.getByLabel('新建会话', { exact: true }).click()
    await page.getByTestId('chat-input').fill('我喜欢喝白茶')
    await page.getByTestId('chat-send').click()
    await expect(page.locator('.message-row.assistant').last()).toContainText('真实流式回复')
    await page.getByTestId('nav-memory').click()
    const card = page.getByTestId('memory-card').filter({ hasText: '喜欢白茶' })
    await expect(card).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('.memory-extraction-status')).toContainText('已保存新记忆')
    const before = await page.evaluate(() => window.murasame.core.getBootstrap())
    if (!before.ok) throw new Error(before.error)
    const source = before.data.memories[0].source
    await page.getByRole('textbox', { name: '搜索记忆' }).fill('我喜欢喝白茶')
    await card.getByRole('link', { name: '查看来源：我喜欢喝白茶' }).click()
    await expect(page.locator('.history-detail-head h2')).toHaveText('我喜欢喝白茶')
    await page.getByTestId('clear-history').click()
    await page.getByRole('dialog').getByRole('button', { name: '按范围清除' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.getByTestId('nav-memory').click()
    await expect(card).toContainText('来源会话已删除')
    await expect(card).not.toContainText(source)
    await expect(page.locator('.memory-extraction-status')).toHaveCount(0)
    await page.screenshot({ path: test.info().outputPath('memory-survives-history-only-clear.png') })

    await page.getByTestId('nav-settings').click()
    await page.getByTestId('clear-data').click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('checkbox', { name: /对话历史/ }).uncheck()
    await dialog.getByRole('checkbox', { name: /相关长期记忆/ }).check()
    await dialog.getByRole('checkbox', { name: /本地缓存/ }).check()
    await dialog.getByRole('button', { name: '执行清除' }).click()
    await expect(dialog).toHaveCount(0)
    const after = await page.evaluate(() => window.murasame.core.getBootstrap())
    if (!after.ok) throw new Error(after.error)
    expect(after.data.memories).toEqual([])
    expect(after.data.conversations.some(item => item.id === source)).toBe(false)
    await page.getByTestId('nav-memory').click()
    await expect(page.getByText('还没有长期记忆', { exact: true })).toBeVisible()
    await page.screenshot({ path: test.info().outputPath('memory-cleared-without-old-notices.png') })
  } finally { await closeApp(app); await server.close() }
})

test('[FR-15] settings reports real IPC clear failures and keeps persisted memory visible', async () => {
  test.setTimeout(60_000)
  const app = await launchWithMemory()
  try {
    const page = await findMainPage(app)
    const seeded = await page.evaluate(async () => {
      const conversation = await window.murasame.core.createConversation()
      const memory = await window.murasame.core.addMemory('偏好', '清理失败后保留白茶')
      return { conversation, memory }
    })
    expect(seeded.conversation.ok && seeded.memory.ok).toBe(true)
    // The failure boundary is the main IPC handler. Renderer/store/preload and
    // existing persisted data are real; this is not a simulated disk failure.
    await app.evaluate(({ ipcMain }, channels) => {
      ipcMain.removeHandler(channels.clearMemories)
      ipcMain.handle(channels.clearMemories, () => ({ ok: false, error: '受控记忆写入失败' }))
      ipcMain.removeHandler(channels.deleteConversation)
      ipcMain.handle(channels.deleteConversation, () => ({ ok: false, error: '受控缓存清除失败' }))
    }, { clearMemories: IPC.core.clearMemories, deleteConversation: IPC.core.deleteConversation })
    await page.getByTestId('nav-settings').click()
    await page.getByTestId('clear-data').click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('checkbox', { name: /对话历史/ }).uncheck()
    await dialog.getByRole('checkbox', { name: /相关长期记忆/ }).check()
    await dialog.getByRole('checkbox', { name: /本地缓存/ }).check()
    await dialog.getByRole('button', { name: '执行清除' }).click()
    await expect(page.locator('.toast-red')).toContainText('受控记忆写入失败')
    await expect(page.locator('.toast-red')).toContainText('受控缓存清除失败')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await page.getByTestId('nav-memory').click()
    await expect(page.getByTestId('memory-card')).toContainText('清理失败后保留白茶')
    const actual = await page.evaluate(() => window.murasame.core.getBootstrap())
    if (!actual.ok) throw new Error(actual.error)
    expect(actual.data.memories.map(item => item.text)).toEqual(['清理失败后保留白茶'])
    expect(actual.data.conversations).toHaveLength(1)
    await page.screenshot({ path: test.info().outputPath('failed-clear-keeps-actual-memory.png') })
  } finally { await closeApp(app) }
})

test('[FR-15] a retained conversation can learn new facts after clearing only its memories', async () => {
  test.setTimeout(90_000)
  let currentFact = '喜欢绿茶'
  const server = await startModelServer({ toolResponse: tool => tool === 'remember'
    ? { memories: [{ action: 'ADD', category: 'user', text: '喜欢绿茶' }, { action: 'ADD', category: 'project', text: currentFact }] } : undefined })
  const app = await launchWithMemory()
  try {
    const page = await findMainPage(app)
    await configureTestModel(page, server.url)
    await page.getByTestId('nav-chat').click()
    await page.getByLabel('新建会话', { exact: true }).click()
    await page.getByTestId('chat-input').fill('我喜欢喝绿茶')
    await page.getByTestId('chat-send').click()
    await page.getByTestId('nav-memory').click()
    await expect(page.getByTestId('memory-card')).toContainText('喜欢绿茶', { timeout: 20_000 })
    await page.getByTestId('nav-history').click()
    await page.getByTestId('clear-history').click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('checkbox', { name: /对话历史/ }).uncheck()
    await dialog.getByRole('checkbox', { name: /相关长期记忆/ }).check()
    await dialog.getByRole('button', { name: '按范围清除' }).click()
    await expect(dialog).toHaveCount(0)
    currentFact = '正在开发白桦项目'
    await page.getByTestId('nav-chat').click()
    await page.getByTestId('chat-input').fill('我现在正在开发白桦项目')
    await page.getByTestId('chat-send').click()
    await expect(page.locator('.message-row.assistant').filter({ hasText: '真实流式回复' })).toHaveCount(2)
    await page.getByTestId('nav-memory').click()
    await expect(page.getByTestId('memory-card')).toContainText('正在开发白桦项目', { timeout: 20_000 })
    const result = await page.evaluate(() => window.murasame.core.getBootstrap())
    if (!result.ok) throw new Error(result.error)
    expect(result.data.memories.map(item => item.text)).toEqual(['正在开发白桦项目'])
    expect(result.data.conversations).toHaveLength(1)
    await page.reload()
    await page.getByTestId('nav-memory').click()
    await expect(page.getByTestId('memory-card')).toContainText('正在开发白桦项目')
    await page.screenshot({ path: test.info().outputPath('retained-conversation-learns-after-clearing.png') })
  } finally { await closeApp(app); await server.close() }
})
