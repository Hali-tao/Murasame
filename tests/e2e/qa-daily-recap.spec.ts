import { expect, test } from '@playwright/test'
import { closeApp, configureTestModel, findMainPage, launchApp, startModelServer } from './helpers'

/**
 * F-02 每日回顾（事实版）：
 * 没活动时诚实显示空状态；有真实活动后只汇总真实事实，不评分、不打卡、不调用模型。
 */
test('[FR-RECAP-06] 仪表盘今日回顾：空状态诚实，新增记忆后显示真实计数', async () => {
  const server = await startModelServer()
  const app = await launchApp()
  try {
    const page = await findMainPage(app)
    const card = page.getByTestId('daily-recap')
    await expect(card).toBeVisible()
    await expect(card).toContainText('不做评分或打卡')
    await expect(card.getByTestId('daily-recap-empty')).toContainText('今天还没有可回顾的记录')

    // 未保存草稿：回顾自动刷新不能覆盖用户正在输入的「留给明天」。
    const noteInput = page.getByTestId('recap-note-input')
    await expect(noteInput).not.toBeVisible()
    await page.locator('.recap-note summary').click()
    await noteInput.fill('草稿不能丢：还没保存')
    // 停留在仪表盘：直接新增一条记忆（模拟其它入口/自动提取），回顾应自动刷新，无需重新挂载。
    const added = await page.evaluate(() => window.murasame.core.addMemory('偏好', '回顾测试：我喜欢早上喝温水'))
    expect(added.ok).toBe(true)
    const facts = page.getByTestId('daily-recap-facts')
    await expect(facts).toBeVisible({ timeout: 10_000 })
    await expect(facts).toContainText('新记住')
    await expect(facts).toContainText('1 条')
    // 刷新完成后，用户仍在输入的草稿必须保留（自动刷新不能覆盖未保存内容）。
    await expect(noteInput).toHaveValue('草稿不能丢：还没保存')
    // 回顾只读本地数据，不出现网络/模型调用措辞。
    await expect(card).toContainText('不调用模型')

    // 「留给明天」一句话：保存后切页再回来（重新挂载卡片）仍能读回，证明保存在主进程本地存储。
    await expect(noteInput).toBeVisible()
    await noteInput.fill('明天先做最重要的一件事。')
    await page.getByTestId('recap-note-save').click()
    await expect(page.getByTestId('recap-note-status')).toContainText('已留给明天')
    await page.getByTestId('nav-memory').click()
    await page.getByTestId('nav-overview').click()
    await page.locator('.recap-note summary').click()
    await expect(page.getByTestId('recap-note-input')).toHaveValue('明天先做最重要的一件事。')
    // 真实消息到达（例如桌宠聊天）时，停在同一仪表盘也要刷新「聊了 N 句」。
    await configureTestModel(page, server.url)
    await page.getByTestId('nav-overview').click()
    const conversationId = await page.evaluate(async () => {
      const created = await window.murasame.core.createConversation()
      if (!created.ok) throw new Error(created.error)
      return created.data.id
    })
    await page.evaluate(async (id) => {
      const sent = await window.murasame.core.sendMessage(id, '回顾测试：聊一句')
      if (!sent.ok) throw new Error(sent.error)
    }, conversationId)
    const liveFacts = page.getByTestId('daily-recap-facts')
    await expect(liveFacts).toContainText('聊了', { timeout: 15_000 })
    // 新建会话自带一条问候，加上用户消息与助手回复 = 3 句。
    await expect(liveFacts).toContainText('3 句')
    await expect(liveFacts).toContainText('1 个会话')
  } finally {
    await closeApp(app)
    await server.close()
  }
})
