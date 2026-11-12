import { spawn } from 'node:child_process'
import { rmSync } from 'node:fs'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, configureTestModel, findMainPage, launchApp, startModelServer, testUserData } from './helpers'

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function waitMainPage(app: ElectronApplication): Promise<Page> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    for (const candidate of app.windows()) {
      if (candidate.isClosed() || candidate.url().includes('/pet.html')) continue
      if (await candidate.evaluate(() => Boolean(window.murasame)).catch(() => false)) {
        await candidate.evaluate(() => window.murasame.window.showMain()).catch(() => undefined)
        return candidate
      }
    }
    await sleep(100)
  }
  throw new Error('重启后的主窗口未就绪')
}

function killTree(pid: number | undefined): void {
  if (!pid) return
  try {
    spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
  } catch {
    /* ignore */
  }
}

/**
 * 流式回复中途强杀的数据一致性（数据损坏类风险）：
 * 真实对话发送后，等假模型服务真正开始流式输出，强杀整个应用进程树；用同一 userData 重启，
 * 数据必须可读：会话存在、用户消息恰好一条、助手消息要么完整持久化要么不存在（不允许半截/重复）。
 *
 * 强杀前等待约 12 秒，让 Chromium Local State（safeStorage 密钥）落盘，覆盖「运行中崩溃」的正常场景；
 * 首启 10 秒内强杀导致的密钥恢复行为见 docs/40 §3.5（已有专项测试）。
 */
test('[QA-STREAMKILL-01] 流式中途强杀：重启后数据可打开，消息不重复不半截', async () => {
  test.setTimeout(240_000)
  let streamChunks = 0
  const server = await startModelServer({
    streamChunkDelayMs: 400,
    onStreamChunk: () => {
      streamChunks += 1
    }
  })
  const app = await launchApp()
  let userData = ''
  let restarted: ElectronApplication | null = null
  try {
    const main = await findMainPage(app)
    await configureTestModel(main, server.url)
    const conversationId = await main.evaluate(async () => {
      const created = await window.murasame.core.createConversation()
      if (!created.ok) throw new Error(created.error)
      return created.data.id
    })
    userData = testUserData(app)
    // 记录强杀前的消息数（新建会话会写入一条问候消息，属于正常基线）。
    const baselineMessages = await main.evaluate(async (id) => {
      const state = await window.murasame.core.getBootstrap()
      if (!state.ok) throw new Error(state.error)
      return state.data.conversations.find((item) => item.id === id)?.messages.length ?? 0
    }, conversationId)

    // 让 Local State 落盘（safeStorage 密钥真正可用）。
    await sleep(12_000)
    await main.evaluate((id) => { void window.murasame.core.sendMessage(id, '崩溃测试：流式中途强杀') }, conversationId)
    await expect.poll(() => streamChunks, { timeout: 15_000 }).toBeGreaterThanOrEqual(1)

    const pid = app.process().pid
    killTree(pid)
    await sleep(1500)
    await Promise.race([app.close().catch(() => undefined), sleep(5000)])

    const env = { ...process.env, MURASAME_USER_DATA: userData } as Record<string, string>
    delete env.ELECTRON_RUN_AS_NODE
    restarted = await electron.launch({ args: ['.'], cwd: process.cwd(), env })
    const page = await waitMainPage(restarted)
    const bootstrap = await page.evaluate(() => window.murasame.core.getBootstrap())
    expect(bootstrap.ok, bootstrap.ok ? '' : bootstrap.error).toBe(true)
    if (!bootstrap.ok) return

    const conversation = bootstrap.data.conversations.find((item) => item.id === conversationId)
    expect(conversation, '重启后应能找到被中断的会话').toBeTruthy()
    const messages = conversation?.messages ?? []
    // 完整性断言：不允许出现半截/重复消息。当前实现是「整轮原子提交」——
    // 模型完成前不落库，因此崩溃后消息数应与强杀前基线一致（可能只多一条问候）；
    // 若未来改为先落用户消息，允许最多一条用户消息，但绝不允许半截助手消息。
    expect(messages.length).toBeLessThanOrEqual(baselineMessages + 1)
    const userMessages = messages.filter((item) => item.role === 'user')
    expect(userMessages.length).toBeLessThanOrEqual(1)
    if (userMessages.length === 1) expect(userMessages[0].text).toBe('崩溃测试：流式中途强杀')
    const greeting = messages.filter((item) => item.role === 'assistant' && item.text.endsWith('在。'))
    const otherAssistant = messages.filter((item) => item.role === 'assistant' && !item.text.endsWith('在。'))
    expect(greeting.length).toBeLessThanOrEqual(1)
    expect(otherAssistant).toHaveLength(0)

    // 应用仍可交互。
    await page.getByTestId('nav-memory').click()
    await expect(page.getByTestId('nav-memory')).toBeVisible()
  } finally {
    killTree(restarted?.process().pid)
    await Promise.race([restarted?.close().catch(() => undefined) ?? Promise.resolve(), sleep(5000)])
    await server.close().catch(() => undefined)
    await closeApp(app).catch(() => undefined)
    if (userData) rmSync(userData, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
})
