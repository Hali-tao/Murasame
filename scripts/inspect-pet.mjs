import { _electron as electron } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const userData = mkdtempSync(join(tmpdir(), 'murasame-pet-inspect-'))
const app = await electron.launch({
  args: ['.'],
  cwd: root,
  env: { ...process.env, MURASAME_USER_DATA: userData }
})

try {
  let petPage
  for (let attempt = 0; attempt < 100; attempt += 1) {
    petPage = app.windows().find((page) => page.url().includes('/pet.html'))
    if (petPage) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  if (!petPage) throw new Error('Pet page not found')
  petPage.on('console', (message) => console.log(`[pet:${message.type()}] ${message.text()}`))
  petPage.on('pageerror', (error) => console.log(`[pet:pageerror] ${error.stack ?? error.message}`))
  await petPage.waitForTimeout(4000)
  console.log(await petPage.evaluate(() => ({
    state: document.querySelector('.live2d-pet-host')?.getAttribute('data-live2d-state'),
    error: document.querySelector('.live2d-fallback')?.getAttribute('title'),
    core: typeof window.Live2DCubismCore,
    url: window.location.href,
    canvas: (() => {
      const canvas = document.querySelector('canvas')
      return canvas ? { width: canvas.width, height: canvas.height, cssWidth: canvas.clientWidth, cssHeight: canvas.clientHeight } : null
    })()
  })))
  await petPage.evaluate(() => { document.body.style.background = '#e8e2d9' })
  await petPage.screenshot({ path: join(root, 'pet-inspect.png') })
} finally {
  await app.close()
  rmSync(userData, { recursive: true, force: true })
}
