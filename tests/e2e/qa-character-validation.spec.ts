import { expect, test } from '@playwright/test'
import { closeApp, findMainPage, launchApp } from './helpers'

/**
 * 全量测试：角色页保存校验、关键词持久化、非法导入、关系重置与形象切换取消。
 */
test.describe('[FULL-QA] 角色页校验与持久化', () => {
  test('[CHAR-01] 名称/风格/关键词保存后持久化，切页回来仍在', async () => {
    const app = await launchApp()
    try {
      const page = await findMainPage(app)
      await page.getByTestId('nav-character').click()
      await expect(page.getByTestId('pet-preset-naiwa')).toContainText('奶娃')
      await expect(page.getByTestId('pet-preset-nailong')).toContainText('奶龙')
      await expect(page.getByRole('heading', { name: '交流设定', exact: true })).toBeVisible()
      const layout = await page.locator('.character-page').evaluate(element => {
        const appearance = element.querySelector('.character-left')!.getBoundingClientRect()
        const editor = element.querySelector('.character-editor')!.getBoundingClientRect()
        const sections = Array.from(element.querySelector('.character-secondary')!.children).map(item => item.getBoundingClientRect())
        return { stacked: editor.top >= appearance.bottom && sections[1].top >= sections[0].bottom, aligned: Math.abs(editor.left - appearance.left) < 1 }
      })
      expect(layout).toEqual({ stacked: true, aligned: true })
      await page.screenshot({ path: test.info().outputPath('character-reorganized.png'), fullPage: true })
      await page.locator('.character-secondary').scrollIntoViewIfNeeded()
      await page.screenshot({ path: test.info().outputPath('character-secondary.png') })
      await page.getByLabel('名称', { exact: true }).fill('测试角色')
      await page.getByLabel('交流风格', { exact: true }).fill('简洁直接')
      await page.getByPlaceholder('添加自定义关键词').fill('葱花')
      await page.getByRole('button', { name: '添加', exact: true }).click()
      await page.getByTestId('save-character').click()
      await expect(page.locator('.toast-green').filter({ hasText: '角色设定已保存' })).toBeVisible()
      const saved = await page.evaluate(async () => {
        const state = await window.murasame.core.getBootstrap()
        return state.ok ? { name: state.data.character.name, style: state.data.character.style, keywords: state.data.character.keywords } : null
      })
      expect(saved?.name).toBe('测试角色')
      expect(saved?.style).toBe('简洁直接')
      expect(saved?.keywords).toContain('葱花')
      await page.getByTestId('nav-memory').click()
      await page.getByTestId('nav-character').click()
      await expect(page.getByLabel('名称', { exact: true })).toHaveValue('测试角色')
      await expect(page.getByLabel('交流风格', { exact: true })).toHaveValue('简洁直接')
    } finally {
      await closeApp(app)
    }
  })

  test('[CHAR-02] 空名称保存被拦截，持久化的角色不被破坏', async () => {
    const app = await launchApp()
    try {
      const page = await findMainPage(app)
      await page.getByTestId('nav-character').click()
      await page.getByLabel('名称', { exact: true }).fill('有效名称')
      await page.getByLabel('交流风格', { exact: true }).fill('简洁')
      await page.getByTestId('save-character').click()
      await expect(page.locator('.toast-green')).toBeVisible()
      await page.getByLabel('名称', { exact: true }).fill('')
      await expect(page.getByTestId('save-character')).toBeEnabled()
      await page.getByTestId('save-character').click()
      await expect(page.locator('.toast-amber')).toContainText('角色名称和交流风格不能为空')
      const after = await page.evaluate(async () => {
        const state = await window.murasame.core.getBootstrap()
        return state.ok ? state.data.character.name : ''
      })
      expect(after).toBe('有效名称')
    } finally {
      await closeApp(app)
    }
  })

  test('[CHAR-03] 非法形象路径导入被中文拒绝，不启用该形象', async () => {
    const app = await launchApp()
    try {
      const page = await findMainPage(app)
      await page.getByTestId('nav-character').click()
      await page.getByPlaceholder('用下面的按钮选择目录或 zip').fill('C:\\不存在\\角色模型.zip')
      await page.getByRole('button', { name: '校验并导入' }).click()
      await expect(page.locator('.toast-red')).toBeVisible({ timeout: 20_000 })
      const toast = await page.locator('.toast-red').first().innerText()
      expect(toast.trim().length).toBeGreaterThan(0)
      expect(toast).not.toMatch(/^Error:|ENOENT|No such file/i)
      await expect(page.getByRole('button', { name: '使用该形象' })).toBeDisabled()
    } finally {
      await closeApp(app)
    }
  })

  test('[CHAR-04] 重置关系取消不改变关系状态', async () => {
    const app = await launchApp()
    try {
      const page = await findMainPage(app)
      await page.getByTestId('nav-character').click()
      const before = await page.evaluate(() => window.murasame.relationship.get())
      await page.getByRole('button', { name: '重置关系' }).click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toContainText('重置当前关系')
      await dialog.getByRole('button', { name: '取消' }).click()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      const after = await page.evaluate(() => window.murasame.relationship.get())
      expect(after.stage).toBe(before.stage)
    } finally {
      await closeApp(app)
    }
  })

  test('[CHAR-05] 更换形象取消后当前形象不变', async () => {
    const app = await launchApp()
    try {
      const page = await findMainPage(app)
      await page.getByTestId('nav-character').click()
      const before = (await page.evaluate(() => window.murasame.settings.get())).petPreset
      const target = before === 'whale-girl' ? 'tororo' : 'whale-girl'
      await page.getByTestId(`pet-preset-${target}`).click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toContainText('更换形象')
      await dialog.getByRole('button', { name: '取消' }).click()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      const after = (await page.evaluate(() => window.murasame.settings.get())).petPreset
      expect(after).toBe(before)
    } finally {
      await closeApp(app)
    }
  })

  test('[CHAR-06] 主动互动与记忆参考开关保存到角色档案', async () => {
    const app = await launchApp()
    try {
      const page = await findMainPage(app)
      await page.getByTestId('nav-character').click()
      await page.getByLabel('名称', { exact: true }).fill('测试角色')
      await page.getByLabel('交流风格', { exact: true }).fill('简洁')
      await page.getByTestId('save-character').click()
      await expect(page.locator('.toast-green')).toBeVisible()
      const proactive = page.getByRole('switch', { name: '主动互动' })
      if (await proactive.isChecked()) await proactive.click()
      const memory = page.getByRole('switch', { name: '在交流中参考长期记忆' })
      if (await memory.isChecked()) await memory.click()
      await page.getByTestId('save-character').click()
      await expect(page.locator('.toast-green').filter({ hasText: '角色设定已保存' })).toBeVisible()
      const character = await page.evaluate(async () => {
        const state = await window.murasame.core.getBootstrap()
        return state.ok ? state.data.character : null
      })
      expect(character?.proactive).toBe(false)
      expect(character?.memory).toBe(false)
    } finally {
      await closeApp(app)
    }
  })
})
