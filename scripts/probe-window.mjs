import { _electron as electron } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const userData = mkdtempSync(join(tmpdir(), 'murasame-probe-'))
writeFileSync(join(userData, 'murasame.json'), JSON.stringify({ settings: { onboardingDone: true } }))

const app = await electron.launch({
  args: ['.'],
  cwd: root,
  env: { ...process.env, MURASAME_USER_DATA: userData }
})
app.process().stderr?.on('data', (chunk) => console.log('[stderr]', String(chunk).trim().slice(0, 400)))

await new Promise((done) => setTimeout(done, 8000))
for (const page of app.windows()) {
  const url = page.url()
  const title = await page.title().catch(() => '(无标题)')
  const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 200)).catch(() => '(读不到)')
  console.log('---')
  console.log('url =', url)
  console.log('title =', title)
  console.log('body =', bodyText.replace(/\n/g, ' | '))
}
await app.close()
