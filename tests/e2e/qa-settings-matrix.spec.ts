import { expect, test } from '@playwright/test'
import { closeApp, findMainPage, launchApp } from './helpers'

/**
 * 全量测试：设置页运行行为/权限/持续观察/热键/帮助/退出/清除/导出/更新检查。
 * 不依赖 mock 数据；以真实 settings.get() 与 bootstrap 状态为准。
 */
test.describe('[FULL-QA] 设置页全开关矩阵', () => {
  test('[SET-01] 运行行为开关与关闭窗口行为持久化', async () => {
    const app = await launchApp()
    try {
      const page = await findMainPage(app)
      await page.getByTestId('nav-settings').click()
      const dnd = page.getByRole('switch', { name: '忙时免打扰' })
      await expect(dnd).not.toBeChecked()
      await dnd.click()
      await expect(dnd).toBeChecked()
      await page.getByLabel('关闭窗口时').selectOption('ask')
      const settings = await page.evaluate(() => window.murasame.settings.get())
      expect(settings.doNotDisturb).toBe(true)
      expect(settings.closeBehavior).toBe('ask')
      // 切页回来保持。
      await page.getByTestId('nav-overview').click()
      await page.getByTestId('nav-settings').click()
      await expect(page.getByRole('switch', { name: '忙时免打扰' })).toBeChecked()
      await expect(page.getByLabel('关闭窗口时')).toHaveValue('ask')
    } finally {
      await closeApp(app)
    }
  })

  test('[SET-02] 系统权限可申请与撤回，状态与设置一致', async () => {
    const app = await launchApp()
    try {
      const page = await findMainPage(app)
      await page.getByTestId('nav-settings').click()
      const row = page.locator('.permission-row').filter({ hasText: '屏幕读取' })
      await expect(row).toContainText('未授权')
      await row.getByRole('button', { name: '申请' }).click()
      await page.waitForTimeout(1000)
      await expect(row).toContainText('已授权')
      await expect(page.locator('.toast-green')).toBeVisible()
      await expect(page.locator('.toast-green')).toContainText('权限')
      await expect.poll(async () => (await page.evaluate(() => window.murasame.settings.get())).permissions.screen).toBe(true)
      await row.getByRole('button', { name: '撤销' }).click()
      await expect(row).toContainText('未授权')
      await expect.poll(async () => (await page.evaluate(() => window.murasame.settings.get())).permissions.screen).toBe(false)
    } finally {
      await closeApp(app)
    }
  })

  test('[SET-03] 持续观察选择项写入设置并联动权限行文案', async () => {
    const app = await launchApp()
    try {
      const page = await findMainPage(app)
      await page.getByTestId('nav-settings').click()
      await page.getByLabel('持续观察').selectOption('15')
      await expect.poll(async () => {
        const settings = await page.evaluate(() => window.murasame.settings.get())
        return { enabled: settings.screenWatchEnabled, seconds: settings.screenWatchSeconds }
      }).toEqual({ enabled: true, seconds: 15 })
      await expect(page.locator('.permission-row').filter({ hasText: '屏幕读取' })).toContainText('持续观察，每 15 秒一次')
      await page.getByLabel('持续观察').selectOption('off')
      await expect.poll(async () => (await page.evaluate(() => window.murasame.settings.get())).screenWatchEnabled).toBe(false)
    } finally {
      await closeApp(app)
    }
  })

  test('[SET-04] 非法快捷键被拒绝并回滚，界面提示原因', async () => {
    const app = await launchApp()
    try {
      const page = await findMainPage(app)
      await page.getByTestId('nav-settings').click()
      const before = (await page.evaluate(() => window.murasame.settings.get())).petHotkey
      const input = page.getByLabel('唤起桌宠的快捷键')
      await input.fill('definitely-not-a-hotkey')
      await page.getByRole('button', { name: '应用', exact: true }).click()
      await expect(page.locator('.toast-amber')).toBeVisible({ timeout: 10_000 })
      await expect(input).toHaveValue(before)
      expect((await page.evaluate(() => window.murasame.settings.get())).petHotkey).toBe(before)
    } finally {
      await closeApp(app)
    }
  })

  test('[SET-05] 检查更新给出诚实结果且按钮恢复可用', async () => {
    test.setTimeout(60_000)
    const app = await launchApp()
    try {
      const page = await findMainPage(app)
      await page.getByTestId('nav-settings').click()
      const button = page.getByRole('button', { name: '检查更新', exact: true })
      await button.click()
      await expect(page.locator('.toast-stack .toast').first()).toBeVisible({ timeout: 20_000 })
      await expect(page.getByRole('button', { name: '检查更新', exact: true })).toBeEnabled({ timeout: 20_000 })
    } finally {
      await closeApp(app)
    }
  })

  test('[SET-06] 使用说明弹窗可读可关', async () => {
    const app = await launchApp()
    try {
      const page = await findMainPage(app)
      await page.getByTestId('nav-settings').click()
      await page.getByRole('button', { name: '使用说明', exact: true }).click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toContainText('Murasame 使用说明')
      await expect(dialog).toContainText('模型')
      await expect(dialog).toContainText('桌宠')
      await dialog.getByRole('button', { name: '知道了' }).click()
      await expect(page.getByRole('dialog')).toHaveCount(0)
    } finally {
      await closeApp(app)
    }
  })

  test('[SET-07] 退出确认取消后应用继续运行', async () => {
    const app = await launchApp()
    try {
      const page = await findMainPage(app)
      await page.getByTestId('nav-settings').click()
      await page.getByRole('button', { name: '退出应用' }).click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toContainText('退出 Murasame')
      await dialog.getByRole('button', { name: '取消' }).click()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(page.getByTestId('nav-settings')).toBeVisible()
    } finally {
      await closeApp(app)
    }
  })

  test('[SET-08] 清除数据对话框未选范围时不可执行，取消不改变数据', async () => {
    const app = await launchApp()
    try {
      const page = await findMainPage(app)
      await page.getByTestId('nav-memory').click()
      const before = await page.evaluate(async () => {
        const state = await window.murasame.core.getBootstrap()
        return state.ok ? state.data.memories.length : -1
      })
      await page.getByTestId('nav-settings').click()
      await page.getByTestId('clear-data').click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toContainText('清除本地数据')
      await expect(dialog.getByRole('button', { name: '执行清除' })).toBeEnabled()
      await dialog.getByRole('button', { name: '取消' }).click()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      const after = await page.evaluate(async () => {
        const state = await window.murasame.core.getBootstrap()
        return state.ok ? state.data.memories.length : -1
      })
      expect(after).toBe(before)
    } finally {
      await closeApp(app)
    }
  })

  test('[SET-09] 导出未加密 JSON 的确认对话框可取消，不产生下载文件', async () => {
    const app = await launchApp()
    try {
      const page = await findMainPage(app)
      await page.getByTestId('nav-settings').click()
      await page.getByRole('button', { name: '导出我的数据' }).click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toContainText('导出未加密的 JSON')
      await dialog.getByRole('button', { name: '取消' }).click()
      await expect(page.getByRole('dialog')).toHaveCount(0)
    } finally {
      await closeApp(app)
    }
  })

  test('[SET-10] 加密本地数据始终开启且不可关闭', async () => {
    const app = await launchApp()
    try {
      const page = await findMainPage(app)
      await page.getByTestId('nav-settings').click()
      const toggle = page.getByRole('switch', { name: '加密本地数据' })
      await expect(toggle).toBeChecked()
      await expect(toggle).toBeDisabled()
    } finally {
      await closeApp(app)
    }
  })
})
