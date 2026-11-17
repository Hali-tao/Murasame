import { expect, test } from '@playwright/test'
import { join } from 'node:path'
import { closeApp, findMainPage, launchApp, testUserData } from './helpers'
import assets from '../../resources/ocr-assets.json'

test('OCR settings show custom model path, installation failure and retry without disabling Windows fallback', async () => {
  const app = await launchApp()
  try {
    const page = await findMainPage(app)
    await page.getByTestId('nav-settings').click()
    const card = page.getByTestId('ocr-settings')
    await expect(card).toContainText('未安装')
    await expect(card).toContainText(join(testUserData(app), 'models', 'pp-ocrv5'))
    await expect(card).toContainText('Windows OCR 备用')
    await app.evaluate(() => { globalThis.fetch = async () => { throw new Error('受控下载失败') } })
    await card.getByRole('button', { name: '安装 OCR 模型', exact: true }).click()
    await expect(card).toContainText('失败 · 使用备用')
    await expect(card).toContainText('受控下载失败')
    await expect(card.getByRole('button', { name: '重新安装 OCR 模型' })).toBeEnabled()
    await card.getByRole('button', { name: '检查 OCR 模型' }).click()
    await expect(card).toContainText('加载失败或文件不完整')
    await page.screenshot({ path: test.info().outputPath('ocr-settings-fallback.png') })
  } finally { await closeApp(app) }
})

test('installs verified OCR assets through the UI and recognizes a crop locally', async () => {
  test.skip(!process.env.MURASAME_OCR_ASSET_CACHE, 'Explicit local assets required; normal UI tests never download models')
  test.setTimeout(180000)
  const app = await launchApp()
  try {
    const page = await findMainPage(app)
    await app.evaluate(async (_electron, input) => {
      const fs = process.getBuiltinModule('fs/promises')
      const path = process.getBuiltinModule('path')
      globalThis.fetch = async url => {
        const asset = input.assets.find(item => item.url === String(url))
        if (!asset) throw new Error('Unexpected network request')
        return new Response(await fs.readFile(path.join(input.cache, asset.file)))
      }
    }, { cache: process.env.MURASAME_OCR_ASSET_CACHE!, assets: [assets.python, ...assets.wheels, ...assets.models] })
    await page.getByTestId('nav-settings').click()
    const card = page.getByTestId('ocr-settings')
    await card.getByRole('button', { name: '安装 OCR 模型', exact: true }).click()
    await expect(card).toContainText('正在安装')
    await expect(card.getByRole('button', { name: /安装 OCR 模型/ })).toBeDisabled()
    await expect(card).toContainText('安装完成', { timeout: 120000 })
    await expect(card).toContainText('优先使用 PP-OCRv5')
    await card.getByRole('button', { name: '检查 OCR 模型' }).click()
    await expect(card).toContainText('PP-OCRv5 轻量模型已验证', { timeout: 30000 })
    await card.scrollIntoViewIfNeeded()
    await page.screenshot({ path: test.info().outputPath('ocr-settings-ready.png') })
    await page.evaluate(() => window.murasame.settings.update({ permissions: { screen: true, microphone: false, accessibility: false }, outboundImages: false }))
    await app.evaluate(({ desktopCapturer, nativeImage, screen }) => {
      desktopCapturer.getSources = async () => screen.getAllDisplays().map(display => ({
        id: `screen:${display.id}:0`, display_id: String(display.id), name: 'Synthetic', appIcon: nativeImage.createEmpty(),
        thumbnail: nativeImage.createFromBitmap(Buffer.alloc(800 * 600 * 4, 180), { width: 800, height: 600 })
      }))
    })
    await page.getByTestId('nav-screen').click()
    await page.getByRole('button', { name: '框选区域并分析' }).click()
    await expect.poll(() => app.windows().filter(window => window.url().startsWith('data:text/html')).length).toBeGreaterThan(0)
    const overlay = app.windows().find(window => window.url().startsWith('data:text/html'))!
    await expect(overlay.getByRole('button', { name: '分析选中区域' })).toBeVisible()
    await overlay.mouse.move(20, 20); await overlay.mouse.down(); await overlay.mouse.move(400, 200); await overlay.mouse.up()
    await overlay.keyboard.press('Enter').catch(error => { if (!overlay.isClosed()) throw error })
    await expect(page.getByRole('button', { name: '框选区域并分析' })).toBeEnabled({ timeout: 30000 })
    const bootstrap = await page.evaluate(() => window.murasame.core.getBootstrap())
    expect(bootstrap.ok && bootstrap.data.screenAnalysis.ocrEngine).toBe('ppocrv5')
    await page.locator('.screen-ocr summary').click()
    await expect(page.locator('.screen-ocr')).toContainText('PP-OCRv5 · 本地识别')
  } finally { await closeApp(app) }
})
