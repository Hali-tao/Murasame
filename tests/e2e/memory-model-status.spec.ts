import { expect, test } from '@playwright/test'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { EMBEDDING_FILES, EMBEDDING_MODEL_ID } from '../../src/main/local/embedding'
import { closeApp, findMainPage, launchApp, testUserData } from './helpers'

test('[FR-14] missing memory model is honest and real local installation can be rechecked without restart', async () => {
  test.skip(EMBEDDING_FILES.some(file => !existsSync(resolve('build/bundled-models', EMBEDDING_MODEL_ID, file))), 'Requires actual local model assets for recovery verification')
  const app = await launchApp()
  try {
    const page = await findMainPage(app)
    await page.getByTestId('nav-memory').click()
    const card = page.getByTestId('memory-model-status')
    await expect(card).toContainText('未安装')
    await expect(card).toContainText('仍可添加、查看、编辑和删除记忆')
    await expect(page.getByRole('button', { name: '下载并准备模型' })).toBeEnabled()
    await expect(page.getByTestId('add-memory')).toBeEnabled()
    await page.screenshot({ path: test.info().outputPath('memory-model-missing.png'), fullPage: true })
    const before = await page.evaluate(() => window.murasame.settings.get())
    // Use the actual downloaded model, never mock embeddings or mark readiness by file presence.
    for (const file of EMBEDDING_FILES) {
      const target = join(testUserData(app), 'models', EMBEDDING_MODEL_ID, file)
      mkdirSync(dirname(target), { recursive: true })
      copyFileSync(resolve('build/bundled-models', EMBEDDING_MODEL_ID, file), target)
    }
    await page.getByRole('button', { name: '重新检查', exact: true }).click()
    await expect(card).toContainText('可用', { timeout: 30_000 })
    const after = await page.evaluate(() => window.murasame.settings.get())
    expect(after.memoryEnabled).toBe(before.memoryEnabled)
    expect(after.permissions).toEqual(before.permissions)
  } finally { await closeApp(app) }
})
