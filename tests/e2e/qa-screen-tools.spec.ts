import { expect, test } from '@playwright/test'
import { closeApp, configureTestModel, findMainPage, launchApp, startModelServer } from './helpers'

/**
 * 全量测试：屏幕感知页与工具页的权限门禁、隐私文案、诚实失败与开关持久化。
 * 真实屏幕捕获/OCR 依赖前台窗口与隐私环境，由 scripts/verify-perception.mjs 验收；这里覆盖 UI/IPC 边界。
 */
test.describe('[FULL-QA] 屏幕感知与工具页', () => {
  test('[SCREEN-01] 未授权时禁止分析，展示隐私边界并引导到设置', async () => {
    const app = await launchApp()
    try {
      const page = await findMainPage(app)
      await page.getByTestId('nav-screen').click()
      await expect(page.getByText('屏幕读取尚未授权')).toBeVisible()
      const analyze = page.getByRole('button', { name: '尚未授权' })
      await expect(analyze).toBeDisabled()
      await expect(page.getByText('还没有截取。点下面的按钮，读取你当前正在看的窗口。')).toBeVisible()
      await expect(page.getByText(/截图不会发给模型/)).toBeVisible()
      await page.getByRole('button', { name: '管理权限' }).click()
      await expect(page).toHaveURL(/\/settings/)
    } finally {
      await closeApp(app)
    }
  })

  test('[SCREEN-02] 授权但没有可用模型时分析诚实失败，忙碌状态能释放且页面可继续交互', async () => {
    test.setTimeout(90_000)
    const app = await launchApp()
    try {
      const page = await findMainPage(app)
      await page.evaluate(() => window.murasame.settings.update({ permissions: { screen: true, microphone: false, accessibility: false } }))
      await page.getByTestId('nav-screen').click()
      await expect(page.getByText(/已授权 · 屏幕读取仅用于当前问题/)).toBeVisible()
      const analyze = page.getByRole('button', { name: '分析当前画面' })
      await expect(analyze).toBeEnabled()
      await analyze.click()
      // 没有可用模型时：要么红字错误提示，要么保持占位（不伪造分析结果）；两者都必须在有限时间内结束忙碌。
      await expect.poll(async () => {
        const busy = await page.getByRole('button', { name: '正在分析…' }).count()
        const toast = await page.locator('.toast-red').count()
        const placeholder = await page.getByText(/还没有截取/).count()
        return { busy, toast, placeholder }
      }, { timeout: 30_000 }).toMatchObject({ busy: 0 })
      const state = await page.evaluate(async () => {
        const toast = document.querySelectorAll('.toast-red').length
        const analysis = document.body.innerText
        return { toast, hasModelError: /模型/.test(analysis) }
      })
      expect(state.toast > 0 || state.hasModelError).toBe(true)
      // 页面仍可交互。
      await page.getByTestId('nav-memory').click()
      await expect(page.getByTestId('nav-memory')).toBeVisible()
    } finally {
      await closeApp(app)
    }
  })

  test('[SCREEN-03] 持续观察开关与间隔文案跟随设置变化', async () => {
    const app = await launchApp()
    try {
      const page = await findMainPage(app)
      await page.evaluate(() => window.murasame.settings.update({
        permissions: { screen: true, microphone: false, accessibility: false },
        screenWatchEnabled: true,
        screenWatchSeconds: 5
      }))
      await page.getByTestId('nav-screen').click()
      await expect(page.getByText(/持续观察已打开，每 5 秒截取一次/)).toBeVisible()
      await page.evaluate(() => window.murasame.settings.update({ screenWatchEnabled: false }))
      const banner = page.locator('.permission-banner')
      await expect(banner).not.toContainText('持续观察已打开', { timeout: 10_000 })
      expect(await banner.innerText()).toMatch(/截取/)
    } finally {
      await closeApp(app)
    }
  })

  test('[SCREEN-04] 截图外发文案跟随「允许截图发给模型」与默认模型名称', async () => {
    const server = await startModelServer()
    const app = await launchApp()
    try {
      const page = await findMainPage(app)
      await configureTestModel(page, server.url)
      await page.evaluate(() => window.murasame.settings.update({ outboundImages: true }))
      await page.getByTestId('nav-screen').click()
      await expect(page.getByText(/截图会发给当前模型服务（端到端测试服务）/)).toBeVisible()
      await page.evaluate(() => window.murasame.settings.update({ outboundImages: false }))
      await expect(page.getByText(/截图不会发给模型/)).toBeVisible()
    } finally {
      await closeApp(app)
      await server.close()
    }
  })

  test('[TOOLS-01] 工具开关生效并持久化，统计与状态同步', async () => {
    const app = await launchApp()
    try {
      const page = await findMainPage(app)
      await page.getByTestId('nav-tools').click()
      const cards = await page.locator('.tools-page .card').evaluateAll(items => items.map(item => {
        const bounds = item.getBoundingClientRect()
        return { top: bounds.top, bottom: bounds.bottom, left: bounds.left, width: bounds.width }
      }))
      expect(cards).toHaveLength(3)
      for (let index = 1; index < cards.length; index++) {
        expect(cards[index].top).toBeGreaterThanOrEqual(cards[index - 1].bottom)
        expect(Math.abs(cards[index].left - cards[0].left)).toBeLessThan(1)
        expect(Math.abs(cards[index].width - cards[0].width)).toBeLessThan(1)
      }
      await expect(page.locator('.tools-page')).not.toContainText('今日调用')
      await expect(page.locator('.tools-page')).not.toContainText('过去 24 小时')
      await page.getByLabel('筛选能力类型').selectOption('插件')
      const expectedPlugins = await page.evaluate(async () => {
        const state = await window.murasame.core.getBootstrap()
        return state.ok ? state.data.tools.filter(tool => tool.kind === '插件').length : 0
      })
      await expect(page.locator('.tool-row')).toHaveCount(expectedPlugins)
      await page.getByLabel('筛选能力类型').selectOption('全部')
      await page.screenshot({ path: test.info().outputPath('tools-single-column.png') })
      const row = page.locator('.tool-row').filter({ hasText: '文件系统' })
      await expect(row).toContainText('已启用')
      await row.getByRole('switch', { name: '停用文件系统' }).click()
      await expect(row).toContainText('已停用')
      const disabled = await page.evaluate(async () => {
        const state = await window.murasame.core.getBootstrap()
        return state.ok ? state.data.tools.find((tool) => tool.id === 'filesystem')?.enabled : null
      })
      expect(disabled).toBe(false)
      // 切页回来仍保持停用（持久化）。
      await page.getByTestId('nav-memory').click()
      await page.getByTestId('nav-tools').click()
      await expect(page.locator('.tool-row').filter({ hasText: '文件系统' })).toContainText('已停用')
      await page.locator('.tool-row').filter({ hasText: '文件系统' }).getByRole('switch', { name: '启用文件系统' }).click()
      await expect(page.locator('.tool-row').filter({ hasText: '文件系统' })).toContainText('已启用')
      await page.getByRole('button', { name: '管理系统权限' }).click()
      await expect(page.locator('.settings-page')).toBeVisible()
    } finally {
      await closeApp(app)
    }
  })

  test('[TOOLS-02] 停用工具后创建任务被中文拒绝，重新启用后恢复', async () => {
    const app = await launchApp()
    try {
      const page = await findMainPage(app)
      await page.evaluate(() => window.murasame.core.setToolEnabled('filesystem', false))
      const rejected = await page.evaluate(async () => window.murasame.core.createTask('整理下载文件夹'))
      expect(rejected.ok).toBe(false)
      if (!rejected.ok) expect(rejected.error).toMatch(/未启用|停用/)
      await page.evaluate(() => window.murasame.core.setToolEnabled('filesystem', true))
      const restored = await page.evaluate(async () => window.murasame.core.createTask('整理下载文件夹'))
      // 恢复后不再报工具未启用（没有配置模型时会是模型相关错误，允许）。
      if (!restored.ok) expect(restored.error).not.toMatch(/未启用|停用/)
    } finally {
      await closeApp(app)
    }
  })

  test('[TOOLS-03] 未实现的能力显示「不可用」，开关禁用且不会假装可启用', async () => {
    const app = await launchApp()
    try {
      const page = await findMainPage(app)
      await page.getByTestId('nav-tools').click()
      const row = page.locator('.tool-row').filter({ hasText: 'Obsidian' })
      await expect(row).toContainText('不可用')
      await expect(row).toContainText('已停用')
      const toggle = row.getByRole('switch', { name: '启用Obsidian' })
      await expect(toggle).toBeDisabled()
      // 页面如实说明「尚未实现」，不把不可用工具显示为可调用。
      await expect(row).toContainText('尚未实现')
    } finally {
      await closeApp(app)
    }
  })

  test('[TOOLS-04] 工具详情弹窗可读、Esc 关闭', async () => {
    const app = await launchApp()
    try {
      const page = await findMainPage(app)
      await page.getByTestId('nav-tools').click()
      const row = page.locator('.tool-row').filter({ hasText: '终端命令' })
      await row.getByRole('button', { name: '详情' }).click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toContainText('能力详情')
      await expect(dialog).toContainText('在授权目录中执行命令')
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toHaveCount(0)
    } finally {
      await closeApp(app)
    }
  })
})
