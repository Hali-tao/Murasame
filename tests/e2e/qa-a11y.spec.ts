import { expect, test } from '@playwright/test'
import { closeApp, findMainPage, findPetPage, launchApp } from './helpers'

/** 键盘可达性与交互死角：弹窗 Esc/Tab、侧边栏键盘导航、桌宠菜单键盘关闭、聊天面板与形象切换并发。 */
test.describe('[QA-A11Y-00] 键盘可达性与交互死角', () => {
  test('[QA-A11Y-01] 记忆弹窗按 Esc 关闭且不保存', async () => {
    const app = await launchApp()
    try {
      const page = await findMainPage(app)
      await page.getByTestId('nav-memory').click()
      const before = await page.getByTestId('memory-card').count()
      await page.getByTestId('add-memory').click()
      await page.getByTestId('memory-category').fill('偏好')
      await page.getByTestId('memory-text').fill('按 Esc 不应该保存这条')
      await expect(page.getByRole('dialog')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(page.getByTestId('memory-card')).toHaveCount(before)
      await expect(page.getByTestId('memory-card').filter({ hasText: '按 Esc 不应该保存这条' })).toHaveCount(0)
    } finally {
      await closeApp(app)
    }
  })

  test('[QA-A11Y-02] 删除确认弹窗 Esc 取消，Tab 焦点不逃出弹窗', async () => {
    const app = await launchApp()
    try {
      const page = await findMainPage(app)
      await page.getByTestId('nav-memory').click()
      await page.getByTestId('add-memory').click()
      await page.getByTestId('memory-category').fill('偏好')
      await page.getByTestId('memory-text').fill('用于键盘焦点测试的记忆')
      await page.getByRole('button', { name: '添加记忆', exact: true }).click()
      await expect(page.getByTestId('memory-card').filter({ hasText: '用于键盘焦点测试的记忆' })).toBeVisible()

      await page.getByTestId('memory-card').filter({ hasText: '用于键盘焦点测试的记忆' }).getByRole('button', { name: '删除' }).click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      // Tab 若干次，焦点必须仍在弹窗内（焦点陷阱）。
      for (let index = 0; index < 6; index += 1) await page.keyboard.press('Tab')
      const focusInDialog = await page.evaluate(() => {
        const active = document.activeElement
        const dialogElement = document.querySelector('[role="dialog"]')
        return Boolean(active && dialogElement && dialogElement.contains(active))
      })
      expect(focusInDialog).toBe(true)
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toHaveCount(0)
      // Esc 取消后记忆仍在。
      await expect(page.getByTestId('memory-card').filter({ hasText: '用于键盘焦点测试的记忆' })).toBeVisible()
    } finally {
      await closeApp(app)
    }
  })

  test('[QA-A11Y-03] 侧边栏链接可键盘聚焦并回车导航', async () => {
    const app = await launchApp()
    try {
      const page = await findMainPage(app)
      const link = page.getByTestId('nav-tasks')
      await link.focus()
      await expect(link).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(page).toHaveURL(/\/tasks/)
      await expect(page.getByTestId('nav-tasks')).toHaveAttribute('aria-current', 'page')
    } finally {
      await closeApp(app)
    }
  })

  test('[QA-A11Y-04] 桌宠右键菜单可用 Esc 关闭，F10 键盘打开', async () => {
    const app = await launchApp()
    try {
      await findMainPage(app)
      const pet = await findPetPage(app)
      await pet.locator('.pet-character').click({ button: 'right' })
      await expect(pet.locator('.pet-menu')).toBeVisible()
      await pet.keyboard.press('Escape')
      await expect(pet.locator('.pet-menu')).toHaveCount(0)

      // 键盘路径：聚焦桌宠 → F10 打开菜单 → Esc 关闭并把焦点还给桌宠。
      await pet.locator('.pet-character').focus()
      await pet.keyboard.press('F10')
      await expect(pet.locator('.pet-menu')).toBeVisible()
      await expect(pet.locator('.pet-menu button')).toHaveCount(9)
      await expect(pet.locator('.pet-menu button').first()).toBeFocused()
      await pet.keyboard.press('Escape')
      await expect(pet.locator('.pet-menu')).toHaveCount(0)
      await expect(pet.locator('.pet-character')).toBeFocused()
    } finally {
      await closeApp(app)
    }
  })

  test('[QA-PET-10] 桌宠聊天打开时快速切换形象 10 次：面板一致且不崩溃', async () => {
    const app = await launchApp()
    try {
      const page = await findMainPage(app)
      const pet = await findPetPage(app)
      await pet.locator('.pet-character').click({ button: 'right' })
      await pet.getByRole('button', { name: '打开对话', exact: true }).click()
      await expect(pet.locator('.pet-chat')).toBeVisible()
      const presets = ['whale-girl', 'naiwa', 'nailong', 'tororo'] as const
      for (let index = 0; index < 10; index += 1) {
        await page.evaluate((preset) => window.murasame.settings.update({ petPreset: preset }), presets[index % presets.length])
      }
      await expect(pet.locator('.pet-chat')).toBeVisible()
      // 最终形象与设置一致，窗口仍在。
      const state = await page.evaluate(() => window.murasame.pet.getState())
      const settings = await page.evaluate(() => window.murasame.settings.get())
      expect(state.preset).toBe(settings.petPreset)
      await expect(pet.locator('.pet-character')).toBeVisible()
    } finally {
      await closeApp(app)
    }
  })

  test('[QA-MODEL-10] 非法模型地址被拒绝且应用不崩溃', async () => {
    const app = await launchApp()
    try {
      const page = await findMainPage(app)
      const before = await page.getByTestId('nav-overview').isVisible()
      const result = await page.evaluate(() =>
        window.murasame.core.saveModel('qa-invalid-model', {
          name: '非法地址',
          provider: 'openai',
          endpoint: 'file:///etc/passwd',
          key: 'sk-qa-invalid',
          model: 'gpt-4o-mini',
          caps: ['chat']
        })
      )
      expect(result.ok).toBe(false)
      expect(String(result.ok ? '' : result.error)).toContain('请求参数无效')
      // 拒绝后界面仍可交互。
      await page.getByTestId('nav-memory').click()
      await expect(page.getByTestId('nav-memory')).toBeVisible()
      expect(before).toBe(true)
    } finally {
      await closeApp(app)
    }
  })
})
