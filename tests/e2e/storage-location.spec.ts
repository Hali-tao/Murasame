import { _electron as electron, expect, test } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findMainPage } from './helpers'

test('storage move preserves encrypted memories, settings, models and routes logs after restart', async () => {
  test.setTimeout(90000)
  const fixture = mkdtempSync(join(tmpdir(), 'murasame-storage-e2e-'))
  const anchor = join(fixture, 'original'); mkdirSync(anchor)
  const destination = join(fixture, 'destination'); mkdirSync(destination)
  const target = join(destination, 'murasame-desktop')
  writeFileSync(join(anchor, 'murasame.json'), JSON.stringify({ settings: { onboardingDone: true } }))
  mkdirSync(join(anchor, 'models')); writeFileSync(join(anchor, 'models', 'fixture.bin'), 'model-fixture')
  const env = { ...process.env, MURASAME_USER_DATA: anchor } as Record<string, string>
  delete env.ELECTRON_RUN_AS_NODE
  const launch = () => electron.launch({ args: ['.'], cwd: join(__dirname, '../..'), env })
  let app = await launch()
  try {
    let page = await findMainPage(app)
    const memory = await page.evaluate(() => window.murasame.core.addMemory('偏好', '迁移后必须保留的测试记忆'))
    expect(memory.ok).toBe(true)
    await page.evaluate(() => window.murasame.settings.update({ doNotDisturb: true }))
    await expect.poll(() => existsSync(join(anchor, 'Local State')), { timeout: 20000 }).toBe(true)
    await app.evaluate(({ dialog }, destination) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [destination] })
      dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false })
    }, destination)
    await page.getByTestId('nav-settings').click()
    await page.getByRole('button', { name: '更改存储位置…' }).click()
    expect(existsSync(join(anchor, 'storage-location.json'))).toBe(false)
    await app.evaluate(({ app, dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
      const originalQuit = app.quit.bind(app)
      ;(globalThis as unknown as { restoreQuit: () => void }).restoreQuit = () => { app.quit = originalQuit }
      app.relaunch = () => undefined
      app.quit = () => undefined
    })
    await page.evaluate(() => window.murasame.app.changeStorageLocation())
    await app.evaluate(() => (globalThis as unknown as { restoreQuit: () => void }).restoreQuit())
    await app.close()
    app = await launch()
    page = await findMainPage(app)
    const info = await page.evaluate(() => window.murasame.app.getInfo())
    expect(info.userDataPath).toBe(target)
    expect(info.logsPath).toBe(join(target, 'logs'))
    expect(info.previousStoragePath).toBe(anchor)
    expect((await page.evaluate(() => window.murasame.settings.get())).doNotDisturb).toBe(true)
    const state = await page.evaluate(() => window.murasame.core.getBootstrap())
    expect(JSON.stringify(state)).toContain('迁移后必须保留的测试记忆')
    expect(readFileSync(join(target, 'models', 'fixture.bin'), 'utf8')).toBe('model-fixture')
    expect(existsSync(join(anchor, 'murasame.db'))).toBe(true)
    await app.evaluate(({ shell }) => {
      shell.openPath = async (path) => { (globalThis as unknown as { openedBackup: string }).openedBackup = path; return '' }
    })
    await page.getByTestId('nav-settings').click()
    await page.getByRole('button', { name: '打开旧数据备份' }).click()
    expect(await app.evaluate(() => (globalThis as unknown as { openedBackup: string }).openedBackup)).toBe(anchor)
    await page.getByRole('button', { name: '更改存储位置…' }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: test.info().outputPath('storage-settings.png') })
  } finally { await app.close(); rmSync(fixture, { recursive: true, force: true }) }
})
