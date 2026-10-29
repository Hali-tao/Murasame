import { expect, test } from '@playwright/test'
import { closeApp, configureTestModel, findMainPage, findPetPage, launchApp, startModelServer } from './helpers'

test('an already open autonomy page follows externally started real isolated work and stop', async () => {
  test.skip(process.env.MURASAME_E2E_ISOLATION !== '1', 'Requires the verified schema-3 Docker image')
  test.setTimeout(150_000)
  const server = await startModelServer({ toolResponse(tool) {
    if (tool === 'get_color') return { color: '蓝色' }
    if (tool === 'create_isolated_artifact') return { title: '跨入口真实产物', content: 'print(6 * 7)', expectedOutput: '42' }
    if (tool === 'review_isolated_artifact') return { accepted: true, reason: '固定模型边界；实际文件与输出由容器核验' }
    return undefined
  } })
  const app = await launchApp()
  try {
    const page = await findMainPage(app)
    const pet = await findPetPage(app)
    await configureTestModel(page, server.url)
    await page.getByTestId('nav-autonomy').click()
    await expect(page.getByTestId('autonomy-stop')).toBeDisabled()
    // Enter through the public preload API while this page is already idle.
    // Production IPC, service, Docker, event publication and rendering all run.
    const started = await page.evaluate(() => window.murasame.autonomy.start({ confirmed: true, allowNetwork: false, kind: 'code' }))
    expect(started.ok).toBe(true)
    await expect(page.getByRole('combobox')).toHaveValue('写代码', { timeout: 10_000 })
    await expect(page.getByTestId('autonomy-stop')).toBeEnabled()
    await expect(page.getByAltText('离线隔离桌面实时画面')).toBeVisible({ timeout: 15_000 })
    await page.screenshot({ path: test.info().outputPath('externally-started-visible.png') })
    const created = await page.evaluate(() => window.murasame.autonomy.create('code', '打印6乘7的结果'))
    expect(created.ok).toBe(true)
    await expect(page.getByTestId('autonomy-export')).toBeEnabled()
    await expect(page.getByRole('heading', { name: '跨入口真实产物' })).toBeVisible()
    await expect(page.getByText('实际输出：', { exact: false })).toContainText('42')
    await expect(pet.getByTestId('pet-isolation-progress')).toContainText('产物已核验，待保存')
    await page.screenshot({ path: test.info().outputPath('external-real-code-result.png') })
    const stopped = await page.evaluate(() => window.murasame.autonomy.stop())
    expect(stopped.ok).toBe(true)
    await expect(page.getByTestId('autonomy-stop')).toBeDisabled()
    await expect(page.getByAltText('离线隔离桌面实时画面')).toHaveCount(0)
    await expect(page.getByTestId('autonomy-export')).toBeDisabled()
    await expect(pet.getByTestId('pet-isolation-progress')).toHaveCount(0)
    await page.screenshot({ path: test.info().outputPath('external-stop-synchronized.png') })
  } finally { await closeApp(app); await server.close() }
})
