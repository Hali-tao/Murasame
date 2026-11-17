import { expect, test } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { closeApp, configureTestModel, findMainPage, launchApp, startModelServer } from './helpers'

test.describe('[FULL-QA] 仪表盘快捷入口与统计', () => {
  test('主入口跳过空会话并恢复最近交流，新对话创建独立会话', async () => {
    const server = await startModelServer()
    const app = await launchApp()
    try {
      const page = await findMainPage(app)
      await configureTestModel(page, server.url)
      const conversationId = await page.evaluate(async () => {
        const created = await window.murasame.core.createConversation()
        if (!created.ok) throw new Error(created.error)
        const sent = await window.murasame.core.sendMessage(created.data.id, '写一个冒泡排序')
        if (!sent.ok) throw new Error(sent.error)
        await window.murasame.core.createConversation()
        return created.data.id
      })
      await page.getByTestId('nav-overview').click()
      await expect(page.locator('.dashboard-resume h2')).toHaveText('写一个冒泡排序')
      await expect(page.locator('.dashboard-task-list')).toHaveCount(0)
      await expect(page.getByTestId('recap-note-input')).not.toBeVisible()
      await page.screenshot({ path: test.info().outputPath('dashboard-resume.png') })
      await page.getByRole('button', { name: '继续交流', exact: true }).click()
      await expect(page.locator('.chat-thread-card')).toContainText('写一个冒泡排序')
      const active = await page.evaluate(() => window.murasame.core.getBootstrap())
      expect(active.ok && active.data.conversations.some(item => item.id === conversationId)).toBe(true)
      await page.getByTestId('nav-overview').click()
      await page.getByRole('button', { name: '新对话', exact: true }).click()
      await expect(page).toHaveURL(/\/chat/)
      const result = await page.evaluate(() => window.murasame.core.getBootstrap())
      expect(result.ok && result.data.conversations.length).toBe(3)
    } finally { await closeApp(app); await server.close() }
  })

  test('长任务标题与缩放窗口保持布局，入口定位到对应任务', async () => {
    const app = await launchApp()
    try {
      const page = await findMainPage(app)
      const title = '整理项目资料并生成详细说明'.repeat(6)
      const result = await page.evaluate(value => window.murasame.core.createTask(value), title)
      expect(result.ok).toBe(true)
      await page.getByTestId('nav-tasks').click()
      await page.getByTestId('nav-overview').click()
      await expect(page.locator('.dashboard-task h3')).toHaveText(title)
      for (const zoom of [1, 1.5]) {
        await app.evaluate(({ BrowserWindow }, factor) => {
          const window = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().includes('/index.html'))!
          window.webContents.setZoomFactor(factor)
        }, zoom)
        await expect.poll(() => page.locator('.dashboard-page').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
        await expect.poll(() => page.locator('.dashboard-task').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
        expect(await page.locator('.dashboard-page').evaluate(element => element.getBoundingClientRect().right <= innerWidth + 1)).toBe(true)
        // Electron's native capture keeps pixel dimensions correct at non-100% zoom.
        const screenshot = await app.evaluate(async ({ BrowserWindow }) => {
          const window = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().includes('/index.html'))!
          return (await window.capturePage()).toPNG().toString('base64')
        })
        writeFileSync(test.info().outputPath(`dashboard-${zoom}.png`), Buffer.from(screenshot, 'base64'))
      }
      await page.getByRole('button', { name: '查看并确认' }).click()
      if (result.ok) await expect(page).toHaveURL(new RegExp(`focus=${result.data.id}`))
    } finally { await closeApp(app) }
  })

  test('[DASH-10] 快捷按钮真实跳转到对话与任务页', async () => {
    const app = await launchApp()
    try {
      const page = await findMainPage(app)
      await page.getByRole('button', { name: '开始交流', exact: true }).click()
      await expect(page).toHaveURL(/\/chat/)
      await page.getByTestId('nav-overview').click()
      await page.getByRole('button', { name: '全部任务 →', exact: true }).click()
      await expect(page).toHaveURL(/\/tasks/)
      await expect(page.getByTestId('nav-tasks')).toBeVisible()
    } finally {
      await closeApp(app)
    }
  })

  test('[DASH-11] 统计卡展示真实记忆与可用能力计数', async () => {
    const app = await launchApp()
    try {
      const page = await findMainPage(app)
      const added = await page.evaluate(() => window.murasame.core.addMemory('偏好', '仪表盘统计测试记忆'))
      expect(added.ok).toBe(true)
      await page.getByTestId('nav-memory').click()
      await page.getByTestId('nav-overview').click()
      const counts = await page.evaluate(async () => {
        const state = await window.murasame.core.getBootstrap()
        if (!state.ok) throw new Error(state.error)
        return {
          memories: state.data.memories.length,
          tools: state.data.tools.length,
          enabledTools: state.data.tools.filter((tool) => tool.enabled).length
        }
      })
      const grid = page.locator('.dashboard-stats')
      await expect(grid.getByRole('button', { name: /长期记忆/ })).toContainText(String(counts.memories))
      await expect(grid.getByRole('button', { name: /已启用工具/ })).toContainText(`${counts.enabledTools} / ${counts.tools}`)
    } finally {
      await closeApp(app)
    }
  })
})
