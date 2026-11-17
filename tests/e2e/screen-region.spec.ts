import { expect, test } from '@playwright/test'
import { closeApp, findMainPage, launchApp } from './helpers'

test('region overlay crops confirmed coordinates, cancels cleanly and stops on permission revocation', async () => {
  test.setTimeout(90000)
  const app = await launchApp()
  try {
    const page = await findMainPage(app)
    await app.evaluate(({ desktopCapturer, nativeImage, screen }) => {
      // Synthetic screen: no user's real screen content is read by this UI test.
      desktopCapturer.getSources = async () => screen.getAllDisplays().map(display => ({
        id: `screen:${display.id}:0`, display_id: String(display.id), name: 'Synthetic display', appIcon: nativeImage.createEmpty(),
        thumbnail: nativeImage.createFromBitmap(Buffer.alloc(800 * 600 * 4, 180), { width: 800, height: 600 })
      }))
    })
    await page.evaluate(() => window.murasame.settings.update({ permissions: { screen: true, microphone: false, accessibility: false }, outboundImages: false }))
    await page.getByTestId('nav-screen').click()
    await expect(page.getByLabel('屏幕分析范围')).toHaveCount(0)
    await expect.poll(async () => (await page.evaluate(() => window.murasame.settings.get())).screenCaptureMode).toBe('region')
    const before = await page.locator('.analysis-card').innerText()
    const selector = async () => {
      await expect.poll(() => app.windows().filter(window => window.url().startsWith('data:text/html')).length).toBeGreaterThan(0)
      const overlay = app.windows().find(window => window.url().startsWith('data:text/html'))!
      await expect(overlay.getByRole('button', { name: '分析选中区域' })).toBeVisible()
      return overlay
    }
    await page.getByRole('button', { name: '框选区域并分析' }).click()
    let overlay = await selector()
    await overlay.keyboard.press('Escape').catch(error => { if (!overlay.isClosed()) throw error })
    await expect(page.getByRole('button', { name: '框选区域并分析' })).toBeEnabled()
    expect(await page.locator('.analysis-card').innerText()).toBe(before)
    await page.getByRole('button', { name: '框选区域并分析' }).click()
    overlay = await selector()
    const dimensions = await overlay.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    const start = { x: Math.floor(dimensions.width * .2), y: Math.floor(dimensions.height * .2) }
    const end = { x: Math.floor(dimensions.width * .6), y: Math.floor(dimensions.height * .6) }
    await overlay.mouse.move(start.x, start.y); await overlay.mouse.down(); await overlay.mouse.move(end.x, end.y, { steps: 6 }); await overlay.mouse.up()
    await expect(overlay.getByRole('button', { name: '分析选中区域' })).toBeEnabled()
    await overlay.screenshot({ path: test.info().outputPath('region-selection.png') })
    await overlay.keyboard.press('Enter').catch(error => { if (!overlay.isClosed()) throw error })
    await expect(page.getByRole('button', { name: '框选区域并分析' })).toBeEnabled({ timeout: 30000 })
    const expectedWidth = Math.ceil(end.x * 800 / dimensions.width) - Math.floor(start.x * 800 / dimensions.width)
    const expectedHeight = Math.ceil(end.y * 600 / dimensions.height) - Math.floor(start.y * 600 / dimensions.height)
    await expect(page.locator('.screen-toolbar')).toContainText(`${expectedWidth} × ${expectedHeight}`)
    await expect(page.locator('.screen-toolbar')).toContainText('手动框选区域')
    expect(app.windows().some(window => window.url().startsWith('data:text/html'))).toBe(false)
    const preview = page.getByRole('img', { name: '最近一次框选的屏幕截图', exact: true })
    await expect(preview).toBeVisible()
    expect(await preview.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true)
    const firstPreview = await preview.getAttribute('src')
    await page.getByRole('button', { name: '放大查看截图' }).click()
    await expect(page.getByRole('dialog', { name: '框选截图' })).toBeVisible()
    await expect(page.getByRole('img', { name: '放大的框选截图' })).toHaveAttribute('src', firstPreview!)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.reload()
    await page.getByTestId('nav-screen').click()
    await expect(preview).toHaveAttribute('src', firstPreview!)
    const bootstrap = await page.evaluate(() => window.murasame.core.getBootstrap())
    if (!bootstrap.ok) throw new Error(bootstrap.error)
    await app.evaluate(({ BrowserWindow }, analysis) => {
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send('core:screen-updated', {
        ...analysis, tree: '[不可信:screen] 中文识别内容 Enter Esc', observedText: '中文识别内容 Enter Esc',
        bullets: ['[不可信:screen] 中文识别内容 Enter Esc']
      })
    }, bootstrap.data.screenAnalysis)
    await expect(page.locator('.screen-ocr')).not.toHaveAttribute('open', '')
    await page.locator('.screen-ocr summary').click()
    await expect(page.locator('.screen-ocr')).toContainText('中文识别内容 Enter Esc')
    await expect(page.locator('.screen-page')).not.toContainText('[不可信:screen]')
    await page.screenshot({ path: test.info().outputPath('region-preview.png') })
    await page.getByRole('button', { name: '框选区域并分析' }).click()
    overlay = await selector()
    await overlay.mouse.move(20, 20); await overlay.mouse.down(); await overlay.mouse.move(200, 130); await overlay.mouse.up()
    await overlay.keyboard.press('Enter').catch(error => { if (!overlay.isClosed()) throw error })
    await expect(page.getByRole('button', { name: '框选区域并分析' })).toBeEnabled({ timeout: 30000 })
    await expect(preview).not.toHaveAttribute('src', firstPreview!)
    const secondPreview = await preview.getAttribute('src')
    await page.getByRole('button', { name: '框选区域并分析' }).click()
    overlay = await selector()
    await overlay.keyboard.press('Escape').catch(error => { if (!overlay.isClosed()) throw error })
    await expect(page.getByRole('button', { name: '框选区域并分析' })).toBeEnabled()
    await expect(preview).toHaveAttribute('src', secondPreview!)

    await page.getByRole('button', { name: '框选区域并分析' }).click()
    await selector()
    await page.evaluate(() => window.murasame.settings.update({ permissions: { screen: false, microphone: false, accessibility: false } }))
    await expect.poll(() => app.windows().filter(window => window.url().startsWith('data:text/html')).length).toBe(0)
    await expect(page.getByRole('button', { name: '尚未授权' })).toBeDisabled()
  } finally { await closeApp(app) }
})
