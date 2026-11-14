import { expect, test } from '@playwright/test'
import { closeApp, configureTestModel, findMainPage, launchApp, startModelServer } from './helpers'

/**
 * 全量测试：模型页边界——密钥不暴露、默认模型删除、运营商预设自动填充。
 */
test.describe('[FULL-QA] 模型页边界', () => {
  test('[MODEL-01] 保存的 API Key 不进入渲染层 DOM/bootstrap，列表只显示已保存', async () => {
    const server = await startModelServer()
    const app = await launchApp()
    try {
      const page = await findMainPage(app)
      await configureTestModel(page, server.url)
      const html = await page.content()
      expect(html).not.toContain('test-key')
      const models = await page.evaluate(async () => {
        const state = await window.murasame.core.getBootstrap()
        return state.ok ? state.data.models.map((model) => ({ id: model.id, name: model.name, key: model.key, hasKey: model.hasKey })) : []
      })
      const configured = models.find((model) => model.name === '端到端测试服务')
      expect(configured?.hasKey).toBe(true)
      expect(configured?.key ?? '').not.toContain('test-key')
      await expect(page.getByTestId('model-item').filter({ hasText: '端到端测试服务' })).toContainText('密钥已保存')
    } finally {
      await closeApp(app)
      await server.close()
    }
  })

  test('[MODEL-02] 已保存密钥默认不回填，显示/隐藏只切换输入框类型', async () => {
    const server = await startModelServer()
    const app = await launchApp()
    try {
      const page = await findMainPage(app)
      await configureTestModel(page, server.url)
      await page.getByTestId('nav-models').click()
      const key = page.getByTestId('model-key')
      await expect(key).toHaveValue('')
      await expect(key).toHaveAttribute('type', 'password')
      await page.getByRole('button', { name: '显示密钥' }).click()
      await expect(key).toHaveAttribute('type', 'text')
      await expect(key).toHaveValue('')
      await page.getByRole('button', { name: '隐藏密钥' }).click()
      await expect(key).toHaveAttribute('type', 'password')
    } finally {
      await closeApp(app)
      await server.close()
    }
  })

  test('[MODEL-03] 删除当前默认模型后回到未选择状态，应用继续可用', async () => {
    const server = await startModelServer()
    const app = await launchApp()
    try {
      const page = await findMainPage(app)
      await configureTestModel(page, server.url)
      await page.getByTestId('nav-models').click()
      await page.getByTestId('delete-model').click()
      await expect(page.getByTestId('current-service-name')).toHaveText('未选择默认模型')
      const models = await page.evaluate(async () => {
        const state = await window.murasame.core.getBootstrap()
        return state.ok ? state.data.models : []
      })
      expect(models).toHaveLength(0)
      await page.getByTestId('nav-chat').click()
      await expect(page.getByTestId('nav-chat')).toBeVisible()
    } finally {
      await closeApp(app)
      await server.close()
    }
  })

  test('[MODEL-04] 选择运营商预设自动填充地址与模型名称', async () => {
    const app = await launchApp()
    try {
      const page = await findMainPage(app)
      await page.getByTestId('nav-models').click()
      await page.getByTestId('add-model').click()
      const preset = page.locator('[data-testid^="model-preset-"]').first()
      await preset.click()
      await expect(page.getByTestId('model-endpoint')).not.toHaveValue('')
      await expect(page.getByTestId('model-endpoint')).toHaveValue(/^https?:\/\//)
      await expect(page.getByTestId('model-name')).not.toHaveValue('')
    } finally {
      await closeApp(app)
    }
  })
})
