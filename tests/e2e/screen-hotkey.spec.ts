import { _electron as electron, expect, test } from '@playwright/test'
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { findMainPage, launchApp, testUserData } from './helpers'

test('screen shortcut can be changed, rejects conflicts and persists across restart', async () => {
  test.setTimeout(90000)
  let app = await launchApp()
  const root = testUserData(app)
  const shortcut = 'Ctrl+Alt+Shift+F10'
  try {
    let page = await findMainPage(app)
    await page.getByTestId('nav-settings').click()
    await app.evaluate(({ globalShortcut }) => {
      const register = globalShortcut.register.bind(globalShortcut)
      globalShortcut.register = (accelerator, callback) => {
        const ok = register(accelerator, callback)
        if (ok) (globalThis as unknown as { screenShortcutCallback: () => void }).screenShortcutCallback = callback
        return ok
      }
    })
    const input = page.getByLabel('屏幕辅助的快捷键')
    await expect(input).toHaveValue('Ctrl+Alt+Q')
    await input.fill(shortcut)
    await page.getByRole('button', { name: '应用屏幕快捷键', exact: true }).click()
    expect(await app.evaluate(({ globalShortcut }, key) => globalShortcut.isRegistered(key), shortcut)).toBe(true)
    await page.getByTestId('nav-screen').click()
    await app.evaluate(() => (globalThis as unknown as { screenShortcutCallback: () => void }).screenShortcutCallback())
    await expect(page).toHaveURL(/\/settings/)
    await input.fill('definitely-not-a-hotkey')
    await page.getByRole('button', { name: '应用屏幕快捷键', exact: true }).click()
    await expect(input).toHaveValue(shortcut)
    await expect(page.locator('.toast-amber')).toBeVisible()
    const conflict = 'Ctrl+Alt+Shift+F11'
    expect(await app.evaluate(({ globalShortcut }, key) => globalShortcut.register(key, () => undefined), conflict)).toBe(true)
    await input.fill(conflict)
    await page.getByRole('button', { name: '应用屏幕快捷键', exact: true }).click()
    await expect(input).toHaveValue(shortcut)
    expect(await app.evaluate(({ globalShortcut }, key) => globalShortcut.isRegistered(key), shortcut)).toBe(true)
    await app.evaluate(({ globalShortcut }, key) => globalShortcut.unregister(key), conflict)
    expect(JSON.parse(readFileSync(join(root, 'murasame.json'), 'utf8')).settings.screenHotkey).toBe(shortcut)
    await app.close()
    const env = { ...process.env, MURASAME_USER_DATA: root } as Record<string, string>
    delete env.ELECTRON_RUN_AS_NODE
    app = await electron.launch({ args: ['.'], cwd: join(__dirname, '../..'), env })
    page = await findMainPage(app)
    expect((await page.evaluate(() => window.murasame.settings.get())).screenHotkey).toBe(shortcut)
    expect(await app.evaluate(({ globalShortcut }, key) => globalShortcut.isRegistered(key), shortcut)).toBe(true)
    await page.getByTestId('nav-screen').click()
    await expect(page.locator('.screen-setup')).toContainText(shortcut)
  } finally { await app.close(); rmSync(root, { recursive: true, force: true }) }
})
