import { expect, test, type ElectronApplication } from '@playwright/test'
import { closeApp, configureTestModel, findMainPage, launchApp } from './helpers'
import { startControlledModelServer } from './qa-helpers'

const MAIN_TITLE_PART = 'AI 桌面伙伴'

async function mainVisible(app: ElectronApplication): Promise<boolean> {
  return app.evaluate(({ BrowserWindow }, part) => {
    const window = BrowserWindow.getAllWindows().find((item) => item.getTitle().includes(part))
    return Boolean(window?.isVisible())
  }, MAIN_TITLE_PART)
}

test('[QA-E2E-03] 流式回复过程中再次发送被拒绝：不重复请求、不丢草稿、消息不重复', async () => {
  test.setTimeout(120_000)
  const server = await startControlledModelServer()
  const app = await launchApp()
  try {
    const page = await findMainPage(app)
    await configureTestModel(page, server.url)
    await page.getByTestId('nav-chat').click()
    await page.getByLabel('新建会话', { exact: true }).click()

    const marker = 'QA-STREAM-RESEND'
    await page.getByTestId('chat-input').fill(marker)
    await page.getByTestId('chat-send').click()
    await server.waitHeld(marker)
    // 真实请求已经在流式返回中：服务端先推一段，但控制台的完整回复要等流结束才落库。
    server.writeChunk(marker, '流式第一段')
    await expect(page.locator('.thinking-bubble')).toBeVisible({ timeout: 15_000 })

    // 流式进行中：输入框可以继续输入，但发送按钮必须禁用，不能把第二条请求发出去。
    await page.getByTestId('chat-input').fill('QA-SECOND-MESSAGE')
    await expect(page.getByTestId('chat-send')).toBeDisabled()
    const quickSummary = page.getByRole('button', { name: '总结这段对话', exact: true })
    if (await quickSummary.count()) await quickSummary.click({ force: true })
    await page.waitForTimeout(400)
    expect(server.chatRequests('QA-SECOND-MESSAGE')).toHaveLength(0)
    expect(server.chatRequests('总结这段对话，保留结论、待办和仍然不确定的部分。')).toHaveLength(0)

    await server.finishStream(marker, ['流式第二段', '流式第三段'])
    const fullReply = '流式第一段流式第二段流式第三段'
    await expect(page.locator('.message-row.assistant').filter({ hasText: fullReply })).toHaveCount(1, { timeout: 15_000 })
    // 草稿没有被清空，用户输入没有丢失。
    await expect(page.getByTestId('chat-input')).toHaveValue('QA-SECOND-MESSAGE')
    await expect(page.locator('.message-row.user')).toHaveCount(1)
    await expect(page.locator('.message-row.user').first()).toContainText(marker)

    // 只发出过一次真实聊天请求，服务端没有收到第二条。
    expect(server.chatRequests(marker)).toHaveLength(1)
    expect(server.chatRequests('QA-SECOND-MESSAGE')).toHaveLength(0)
    const state = await page.evaluate(() => window.murasame.core.getBootstrap())
    if (!state.ok) throw new Error(state.error)
    const conversation = state.data.conversations.find((item) => item.messages.some((message) => message.text === marker))
    expect(conversation).toBeTruthy()
    expect(conversation!.messages.filter((message) => message.role === 'user').map((message) => message.text)).toEqual([marker])
    expect(conversation!.messages.filter((message) => message.role === 'assistant').at(-1)?.text).toContain(fullReply)
    await expect(page.locator('.toast-red')).toHaveCount(0)
    await page.screenshot({ path: test.info().outputPath('resend-during-stream.png') })
  } finally {
    await closeApp(app)
    await server.close()
  }
})

test('[QA-E2E-04] 流式回复中切换模型配置后回复仍完整且会话不丢', async () => {
  test.setTimeout(180_000)
  const server = await startControlledModelServer()
  const app = await launchApp()
  try {
    const page = await findMainPage(app)
    await configureTestModel(page, server.url, 'QA 服务 A')
    await configureTestModel(page, server.url, 'QA 服务 B')
    await expect(page.getByTestId('current-service-name')).toHaveText('QA 服务 B')

    await page.getByTestId('nav-chat').click()
    await page.getByLabel('新建会话', { exact: true }).click()
    const marker = 'QA-STREAM-MODEL-SWITCH'
    await page.getByTestId('chat-input').fill(marker)
    await page.getByTestId('chat-send').click()
    await server.waitHeld(marker)
    server.writeChunk(marker, '切换模型前已经收到的内容，')
    await expect(page.locator('.thinking-bubble')).toBeVisible({ timeout: 15_000 })

    // 流式进行中切到另一条已保存的模型配置。
    await page.getByTestId('nav-models').click()
    await page.getByTestId('model-item').filter({ hasText: 'QA 服务 A' }).click()
    await page.getByTestId('set-default-model').click()
    await expect(page.getByTestId('current-service-name')).toHaveText('QA 服务 A')

    await server.finishStream(marker, ['切换模型后仍然收到完整回复。'])
    await page.getByTestId('nav-chat').click()
    const fullReply = '切换模型前已经收到的内容，切换模型后仍然收到完整回复。'
    await expect(page.locator('.message-row.assistant').filter({ hasText: fullReply })).toHaveCount(1, { timeout: 20_000 })

    const state = await page.evaluate(() => window.murasame.core.getBootstrap())
    if (!state.ok) throw new Error(state.error)
    expect(state.data.models.find((model) => model.default)?.name).toBe('QA 服务 A')
    const conversation = state.data.conversations.find((item) => item.messages.some((message) => message.text === marker))
    expect(conversation).toBeTruthy()
    expect(conversation!.messages.filter((message) => message.role === 'user').map((message) => message.text)).toEqual([marker])
    expect(conversation!.messages.filter((message) => message.role === 'assistant').at(-1)?.text).toContain(fullReply)
    expect(server.chatRequests(marker)).toHaveLength(1)
    await expect(page.locator('.toast-red')).toHaveCount(0)
    await page.screenshot({ path: test.info().outputPath('switch-model-during-stream.png') })
  } finally {
    await closeApp(app)
    await server.close()
  }
})

test('[QA-E2E-05] 流式回复中关闭并重开控制台窗口：回复完整且之后还能继续对话', async () => {
  test.setTimeout(180_000)
  const server = await startControlledModelServer()
  const app = await launchApp()
  try {
    const page = await findMainPage(app)
    await configureTestModel(page, server.url)
    await page.getByTestId('nav-chat').click()
    await page.getByLabel('新建会话', { exact: true }).click()

    const first = 'QA-STREAM-HIDE-REOPEN'
    await page.getByTestId('chat-input').fill(first)
    await page.getByTestId('chat-send').click()
    await server.waitHeld(first)
    server.writeChunk(first, '窗口隐藏前的内容，')

    await page.getByTestId('hide-to-tray').click()
    await expect.poll(() => mainVisible(app), { timeout: 10_000 }).toBe(false)
    // 窗口隐藏期间服务端继续推流，真实 IPC 事件仍要送达隐藏的渲染进程。
    server.writeChunk(first, '窗口隐藏期间的内容，')
    await page.waitForTimeout(1_000)
    await page.evaluate(() => window.murasame.window.showMain())
    await expect.poll(() => mainVisible(app), { timeout: 10_000 }).toBe(true)
    server.writeChunk(first, '窗口重开后的内容，')
    await server.finishStream(first, ['全文完整。'])
    const firstReply = '窗口隐藏前的内容，窗口隐藏期间的内容，窗口重开后的内容，全文完整。'
    await expect(page.locator('.message-row.assistant').filter({ hasText: firstReply })).toHaveCount(1, { timeout: 20_000 })

    // 重开窗口后还能继续对话。
    const second = 'QA-STREAM-AFTER-REOPEN'
    await page.getByTestId('chat-input').fill(second)
    await page.getByTestId('chat-send').click()
    await server.waitHeld(second)
    await server.finishStream(second, ['重开窗口后的第二条回复。'])
    await expect(page.locator('.message-row.assistant').filter({ hasText: '重开窗口后的第二条回复。' })).toHaveCount(1, { timeout: 20_000 })

    const state = await page.evaluate(() => window.murasame.core.getBootstrap())
    if (!state.ok) throw new Error(state.error)
    const conversation = state.data.conversations.find((item) => item.messages.some((message) => message.text === first))
    expect(conversation).toBeTruthy()
    expect(conversation!.messages.filter((message) => message.role === 'user').map((message) => message.text)).toEqual([first, second])
    expect(conversation!.messages.filter((message) => message.role === 'assistant').at(-1)?.text).toContain('重开窗口后的第二条回复。')
    await expect(page.locator('.toast-red')).toHaveCount(0)
    await page.screenshot({ path: test.info().outputPath('reply-complete-after-reopen.png') })
  } finally {
    await closeApp(app)
    await server.close()
  }
})
