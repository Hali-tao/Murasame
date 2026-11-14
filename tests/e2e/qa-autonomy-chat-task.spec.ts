import { expect, test } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeApp, configureTestModel, findMainPage, launchApp, startModelServer } from './helpers'

test.describe('[FULL-QA] 自主活动 / 聊天操作 / 任务取消', () => {
  test('[AUTONOMY-10] 自主活动页：未确认不可开始；真实 Docker 下可开始并停止', async () => {
    test.setTimeout(300_000)
    const app = await launchApp()
    try {
      const page = await findMainPage(app)
      await page.getByTestId('nav-autonomy').click()
      const start = page.getByTestId('autonomy-start')
      await expect(start).toBeDisabled()
      const environment = await page.evaluate(() => window.murasame.autonomy.environment())
      await page.getByRole('switch', { name: '我确认只在隔离桌面里活动' }).click()
      await expect(start).toBeEnabled()
      await start.click()
      if (!environment.docker || !environment.image) {
        // 环境未就绪：只要求诚实中文失败，不伪造开始。
        const notice = page.getByRole('status')
        await expect(notice).toContainText(/[\u4e00-\u9fff]/, { timeout: 60_000 })
        return
      }
      // 真实 Docker 可用：等待活动进入 running，再停止并等待回到非运行态。
      await expect.poll(async () => {
        const status = await page.evaluate(() => window.murasame.autonomy.status())
        return status.running
      }, { timeout: 150_000, intervals: [1000] }).toBe(true)
      const stop = page.getByTestId('autonomy-stop')
      await expect(stop).toBeEnabled()
      await stop.click()
      await expect.poll(async () => {
        const status = await page.evaluate(() => window.murasame.autonomy.status())
        return { running: status.running, phase: status.phase }
      }, { timeout: 120_000, intervals: [1000] }).toMatchObject({ running: false })
      await expect(page.getByTestId('nav-autonomy')).toBeVisible()
    } finally {
      await closeApp(app)
    }
  })

  test('[CHAT-10] 朗读无模型时中文降级；上下文面板与快捷总结可用', async () => {
    const server = await startModelServer()
    const app = await launchApp()
    try {
      const page = await findMainPage(app)
      await configureTestModel(page, server.url)
      await page.getByTestId('nav-chat').click()
      const conversationId = await page.evaluate(async () => {
        const created = await window.murasame.core.createConversation()
        if (!created.ok) throw new Error(created.error)
        return created.data.id
      })
      await page.getByTestId('chat-input').fill('聊天操作覆盖：请回复一句')
      await page.getByTestId('chat-send').click()
      await expect(page.locator('.message-row.assistant').last()).toContainText('真实流式回复', { timeout: 20_000 })
      // 测试 userData 没有语音模型：朗读必须中文说明并保留文字。
      await page.locator('.message-row.assistant').last().getByRole('button', { name: '朗读' }).click()
      await expect(page.locator('.toast-amber')).toBeVisible({ timeout: 20_000 })
      const toast = await page.locator('.toast-amber').first().innerText()
      expect(toast).toMatch(/[\u4e00-\u9fff]/)
      // 上下文面板可展开/收起（按钮 aria-expanded 与面板 hidden 由同一状态驱动）。
      const contextButton = page.locator('button[aria-controls="chat-context-panel"]')
      await expect(contextButton).toBeVisible()
      const initialExpanded = await contextButton.getAttribute('aria-expanded')
      await contextButton.click()
      await expect(contextButton).toHaveAttribute('aria-expanded', initialExpanded === 'true' ? 'false' : 'true')
      await contextButton.click()
      await expect(contextButton).toHaveAttribute('aria-expanded', initialExpanded === 'true' ? 'true' : 'false')
      // 快捷「总结这段对话」真实发一轮消息并落库。
      const before = await page.evaluate(async (id) => {
        const state = await window.murasame.core.getBootstrap()
        return state.ok ? state.data.conversations.find((item) => item.id === id)?.messages.length ?? 0 : 0
      }, conversationId)
      await page.getByRole('button', { name: '总结这段对话' }).click()
      await expect.poll(async () => {
        const state = await page.evaluate(() => window.murasame.core.getBootstrap())
        return state.ok ? state.data.conversations.find((item) => item.id === conversationId)?.messages.length ?? 0 : 0
      }, { timeout: 30_000 }).toBeGreaterThanOrEqual(before + 2)
    } finally {
      await closeApp(app)
      await server.close()
    }
  })

  test('[TASK-10] 创建任务后从界面取消，状态与筛选一致', async () => {
    test.setTimeout(120_000)
    const taskRoot = mkdtempSync(join(tmpdir(), 'murasame-task-cancel-'))
    // 假模型的计划必须返回绝对目录，否则任务根校验会按设计拒绝（与真实任务对话框一致）。
    const server = await startModelServer({ taskRoot })
    const app = await launchApp()
    try {
      const page = await findMainPage(app)
      await configureTestModel(page, server.url)
      const created = await page.evaluate(async (root) => window.murasame.core.createTask('整理下载文件夹并生成清单', root), taskRoot)
      expect(created.ok, created.ok ? '' : created.error).toBe(true)
      const taskId = created.ok ? created.data.id : ''
      expect(taskId).not.toBe('')
      expect(taskRoot.length).toBeGreaterThan(0)
      await page.getByTestId('nav-tasks').click()
      await expect(page.getByTestId('task-item').filter({ hasText: '整理下载文件夹并生成清单' })).toBeVisible({ timeout: 30_000 })
      await page.getByTestId('task-item').filter({ hasText: '整理下载文件夹并生成清单' }).click()
      await page.getByTestId('cancel-task').click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toContainText('取消这个任务')
      await dialog.getByRole('button', { name: '取消任务' }).click()
      await expect.poll(async () => {
        const state = await page.evaluate(() => window.murasame.core.getBootstrap())
        return state.ok ? state.data.tasks.find((item) => item.id === taskId)?.status : null
      }, { timeout: 30_000 }).toBe('已取消')
      await page.getByLabel('筛选任务').selectOption('已取消')
      await expect(page.getByTestId('task-item').filter({ hasText: '整理下载文件夹并生成清单' })).toBeVisible()
      expect((await page.evaluate(async () => {
        const state = await window.murasame.core.getBootstrap()
        return state.ok ? state.data.tasks.length : 0
      }))).toBeGreaterThanOrEqual(1)
    } finally {
      await closeApp(app)
      await server.close()
      rmSync(taskRoot, { recursive: true, force: true })
    }
  })
})
