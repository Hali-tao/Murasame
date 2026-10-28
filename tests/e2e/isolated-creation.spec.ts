import { expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { closeApp, configureTestModel, findMainPage, launchApp, startModelServer, testUserData } from './helpers'

// Opt in because these cases use real Docker/LibreOffice/code-server, never a
// host process substitute. All profiles and exports are independent fixtures.
test.describe('real isolated creation', () => {
  test.skip(process.env.MURASAME_E2E_ISOLATION !== '1', 'Requires the verified schema-3 Docker image')
  for (const kind of ['office', 'code'] as const) test(`${kind} through actual UI, IPC, model transport and Docker`, async () => {
    test.setTimeout(180_000)
    let drafts = 0; let reviews = 0
    const candidate = kind === 'office'
      ? { title: '合成验收文档', content: '第一步：准备  独立资料。\n\t第二步：执行测试。\n验收：检查结果和文件。', expectedOutput: '' }
      : { title: '平方和验收', content: 'print(sum(i*i for i in range(1, 11)))', expectedOutput: '385' }
    const server = await startModelServer({ toolResponse(tool, messages) {
      if (tool === 'get_color') return { color: '蓝色' }
      if (tool === 'create_isolated_artifact') { drafts++; return candidate }
      if (tool === 'review_isolated_artifact') {
        reviews++
        const input = JSON.parse(String(messages.filter(item => item.role === 'user').at(-1)?.content))
        expect(input.kind).toBe(kind); expect(input.evidence.text).toContain(kind === 'code' ? 'print' : '合成验收')
        return { accepted: true, reason: '受控模型边界：已检查实际文件和输出' }
      }
      return undefined
    } })
    const app = await launchApp()
    try {
      const page = await findMainPage(app)
      await configureTestModel(page, server.url, '创作边界验收服务')
      await page.getByTestId('nav-autonomy').click()
      await page.getByRole('combobox').selectOption(kind === 'office' ? '办公' : '写代码')
      await page.getByRole('switch', { name: '允许隔离桌面联网', exact: true }).click()
      await page.getByRole('switch', { name: '我确认只在隔离桌面里活动', exact: true }).click()
      await page.getByTestId('autonomy-start').click()
      await expect(page.getByTestId('autonomy-create')).toBeDisabled()
      await expect(page.getByAltText('离线隔离桌面实时画面')).toBeVisible({ timeout: 70_000 })
      expect(await page.getByAltText('离线隔离桌面实时画面').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
      await page.getByRole('textbox', { name: '创作目标', exact: false }).fill(kind === 'office' ? '写一份独立测试安排' : '计算1到10的平方和')
      await page.getByTestId('autonomy-create').click()
      await expect(page.getByTestId('autonomy-export')).toBeEnabled({ timeout: 70_000 })
      expect(drafts).toBe(1); expect(reviews).toBe(1)
      await page.getByTestId('nav-overview').click(); await page.getByTestId('nav-autonomy').click()
      await expect(page.getByRole('combobox')).toHaveValue(kind === 'office' ? '办公' : '写代码')
      await expect(page.getByTestId('autonomy-export')).toBeEnabled()
      await page.getByRole('button', { name: '让模型看一眼桌面', exact: true }).click()
      await expect(page.locator('.autonomy-status')).toContainText('需要先允许发送截图')
      await expect(page.getByTestId('autonomy-export')).toBeEnabled()
      const status = await page.evaluate(() => window.murasame.autonomy.status())
      expect(status.allowNetwork).toBe(false)
      const artifact = status.creation!.artifact!
      expect(artifact.preview).toBe(kind === 'office' ? `${candidate.title}\n${candidate.content}` : candidate.content)
      await page.getByAltText('离线隔离桌面实时画面').screenshot({ path: test.info().outputPath(`${kind}-offline-live-desktop.png`) })
      const destination = join(testUserData(app), artifact.name)
      // Only substitute the native picker result. Production handler/service
      // still validate the current artifact, read the container and write wx.
      await app.evaluate(({ dialog }, filePath) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath })
      }, destination)
      await page.getByTestId('autonomy-export').click()
      await expect(page.locator('.autonomy-status')).toContainText('已保存到', { timeout: 15000 })
      expect(existsSync(destination)).toBe(true)
      expect(createHash('sha256').update(readFileSync(destination)).digest('hex')).toBe(artifact.sha256)
      await page.getByTestId('autonomy-export').click()
      await expect(page.locator('.autonomy-status')).toContainText('没有覆盖', { timeout: 15000 })
      await page.screenshot({ path: test.info().outputPath(`${kind}-verified-export.png`), fullPage: true })
      await page.getByTestId('autonomy-stop').click()
      await expect(page.getByAltText('离线隔离桌面实时画面')).toHaveCount(0)
      await expect(page.getByTestId('autonomy-export')).toBeDisabled()
      expect((await page.evaluate(id => window.murasame.autonomy.exportArtifact(id), artifact.id)).ok).toBe(false)
    } finally { await closeApp(app); await server.close() }
  })
})
