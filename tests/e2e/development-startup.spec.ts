import { expect, test } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { closeApp, launchApp } from './helpers'

test('[FR-01] development startup shows the console even after onboarding and with the pet hidden', async () => {
  test.skip(Boolean(process.env.MURASAME_E2E_EXECUTABLE), 'Development-only startup policy')
  const app = await launchApp(true, userData => {
    writeFileSync(join(userData, 'murasame.json'), JSON.stringify({ settings: { onboardingDone: true, petVisible: false } }))
  })
  try {
    // Do not use findMainPage: it explicitly shows the window and would hide this regression.
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
      const main = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('/index.html'))
      return Boolean(main?.isVisible())
    }), { timeout: 10000 }).toBe(true)
  } finally { await closeApp(app) }
})
