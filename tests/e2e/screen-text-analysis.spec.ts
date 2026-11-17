import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { closeApp, configureTestModel, findMainPage, launchApp, startModelServer, testUserData } from './helpers'

test('real OCR sends only text to the API with image outbound off and displays its reply', async () => {
  test.setTimeout(90000)
  const requests: Array<Array<{ role: string; content: unknown }>> = []
  const server = await startModelServer({ onMessages: messages => requests.push(messages) })
  const app = await launchApp()
  try {
    const page = await findMainPage(app)
    await configureTestModel(page, server.url)
    // Editing and saving the active connection clears probe metadata, but normal
    // chat still uses it. Screen text analysis must use the same connection too.
    await page.evaluate(async () => {
      const bootstrap = await window.murasame.core.getBootstrap()
      if (!bootstrap.ok) throw new Error(bootstrap.error)
      const current = bootstrap.data.models.find(model => model.default)!
      const input = { name: current.name, provider: current.provider, endpoint: current.endpoint, key: '', model: current.model, caps: current.caps }
      await window.murasame.core.saveModel(current.id, { ...input, model: 'temporary-model' })
      await window.murasame.core.saveModel(current.id, input)
      const latest = await window.murasame.core.getBootstrap()
      if (!latest.ok || latest.data.models.find(model => model.default)?.capabilities.length !== 0) throw new Error('Expected cleared probe metadata')
    })
    requests.length = 0
    const file = join(testUserData(app), 'synthetic-text.png')
    const script = `
$ProgressPreference='SilentlyContinue'
Add-Type -AssemblyName System.Drawing
$bitmap=New-Object System.Drawing.Bitmap(900,160)
$graphics=[System.Drawing.Graphics]::FromImage($bitmap)
$font=New-Object System.Drawing.Font('Microsoft YaHei',32)
try {
 $graphics.Clear([System.Drawing.Color]::White)
 $graphics.DrawString('中文测试 Enter Esc',$font,[System.Drawing.Brushes]::Black,20,40)
 $bitmap.Save($env:OCR_FIXTURE,[System.Drawing.Imaging.ImageFormat]::Png)
} finally { $font.Dispose(); $graphics.Dispose(); $bitmap.Dispose() }
`
    execFileSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { windowsHide: true, timeout: 20000, env: { ...process.env, OCR_FIXTURE: file } })
    await app.evaluate(({ desktopCapturer, nativeImage, screen }, path) => {
      desktopCapturer.getSources = async () => screen.getAllDisplays().map(display => ({
        id: `screen:${display.id}:0`, display_id: String(display.id), name: 'Synthetic', appIcon: nativeImage.createEmpty(), thumbnail: nativeImage.createFromPath(path)
      }))
    }, file)
    await page.evaluate(() => window.murasame.settings.update({ permissions: { screen: true, microphone: false, accessibility: false }, outboundImages: false }))
    await page.getByTestId('nav-screen').click()
    await page.getByRole('button', { name: '框选区域并分析' }).click()
    await expect.poll(() => app.windows().filter(window => window.url().startsWith('data:text/html')).length).toBeGreaterThan(0)
    const overlay = app.windows().find(window => window.url().startsWith('data:text/html'))!
    await expect(overlay.getByRole('button', { name: '分析选中区域' })).toBeVisible()
    const size = await overlay.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    await overlay.mouse.move(2, 2); await overlay.mouse.down(); await overlay.mouse.move(size.width - 2, size.height - 2); await overlay.mouse.up()
    await overlay.keyboard.press('Enter').catch(error => { if (!overlay.isClosed()) throw error })
    await expect(page.locator('.analysis-summary')).toHaveText('这是来自测试模型的真实流式回复。', { timeout: 30000 })
    const sent = requests.filter(messages => messages.some(message => String(message.content).startsWith('[不可信:screen]')))
    expect(sent).toHaveLength(1)
    expect(sent[0].every(message => typeof message.content === 'string')).toBe(true)
    expect(JSON.stringify(sent[0])).not.toMatch(/image_url|data:image|base64/)
    expect(String(sent[0].at(-1)?.content).replace(/\s/g, '')).toContain('中文测试')
    await expect(page.getByRole('button', { name: '放大查看截图' })).toBeVisible()
    await page.screenshot({ path: test.info().outputPath('ocr-text-analysis.png') })
  } finally { await closeApp(app); await server.close() }
})
