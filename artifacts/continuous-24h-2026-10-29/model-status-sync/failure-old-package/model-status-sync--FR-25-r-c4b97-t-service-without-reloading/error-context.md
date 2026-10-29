# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: model-status-sync.spec.ts >> [FR-25] real chat failure and recovery update the current service without reloading
- Location: tests\e2e\model-status-sync.spec.ts:36:5

# Error details

```
Error: expect(locator).toHaveText(expected) failed

Locator:  locator('.service-pill')
Expected: "模型服务离线"
Received: "模型服务在线"
Timeout:  5000ms

Call log:
  - Expect "toHaveText" locator('.service-pill') with timeout 5000ms
  - waiting for locator('.service-pill')
    14 × locator resolved to <span class="pill pill-green service-pill">…</span>
       - unexpected value "模型服务在线"

```

```yaml
- text: 模型服务在线
```

# Test source

```ts
  1  | import { expect, test } from '@playwright/test'
  2  | import { writeFileSync } from 'node:fs'
  3  | import { createServer } from 'node:http'
  4  | import { closeApp, configureTestModel, findMainPage, launchApp, startModelServer } from './helpers'
  5  |
  6  | test('[FR-25] verified service status survives a completed chat and renderer reload', async () => {
  7  |   const server = await startModelServer(), app = await launchApp()
  8  |   const snapshots: unknown[] = []
  9  |   try {
  10 |     const page = await findMainPage(app)
  11 |     await configureTestModel(page, server.url)
  12 |     const snapshot = async (stage: string) => {
  13 |       const result = await page.evaluate(() => window.murasame.core.getBootstrap())
  14 |       if (!result.ok) throw new Error(result.error)
  15 |       snapshots.push({ stage, models: result.data.models, label: await page.locator('.service-pill').innerText() })
  16 |       return result.data.models
  17 |     }
  18 |     expect((await snapshot('verified')).find(model => model.default)?.status).toBe('在线')
  19 |     await page.getByTestId('nav-chat').click()
  20 |     await page.getByLabel('新建会话', { exact: true }).click()
  21 |     await page.getByTestId('chat-input').fill('你好，请解释一下变量是什么')
  22 |     await page.getByTestId('chat-send').click()
  23 |     await expect(page.locator('.message-row.assistant').last()).toContainText('真实流式回复')
  24 |     expect((await snapshot('after-chat')).find(model => model.default)?.status).toBe('在线')
  25 |     await page.reload()
  26 |     await expect(page.getByTestId('nav-chat')).toBeVisible()
  27 |     expect((await snapshot('reloaded')).find(model => model.default)?.status).toBe('在线')
  28 |     await expect(page.locator('.service-pill')).toHaveText('模型服务在线')
  29 |     await page.screenshot({ path: test.info().outputPath('verified-status-after-reload.png') })
  30 |   } finally {
  31 |     writeFileSync(test.info().outputPath('status-snapshots.json'), JSON.stringify(snapshots, null, 2))
  32 |     await closeApp(app); await server.close()
  33 |   }
  34 | })
  35 |
  36 | test('[FR-25] real chat failure and recovery update the current service without reloading', async () => {
  37 |   const upstream = await startModelServer()
  38 |   let fail = false
  39 |   const server = createServer((request, response) => {
  40 |     let body = ''
  41 |     request.setEncoding('utf8'); request.on('data', chunk => { body += chunk })
  42 |     request.on('end', () => {
  43 |       if (fail) { response.writeHead(503); response.end('controlled service outage'); return }
  44 |       void fetch(`${upstream.url}/chat/completions`, { method: 'POST', headers: { authorization: 'Bearer test-key', 'content-type': 'application/json' }, body })
  45 |         .then(async result => { response.writeHead(result.status, { 'content-type': result.headers.get('content-type') ?? 'application/json' }); response.end(Buffer.from(await result.arrayBuffer())) })
  46 |         .catch(() => { response.writeHead(500); response.end('fixture proxy failure') })
  47 |     })
  48 |   })
  49 |   await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  50 |   const address = server.address()
  51 |   if (!address || typeof address === 'string') throw new Error('No local listener')
  52 |   const app = await launchApp()
  53 |   try {
  54 |     const page = await findMainPage(app)
  55 |     await configureTestModel(page, `http://127.0.0.1:${address.port}/v1`)
  56 |     await page.getByTestId('nav-chat').click()
  57 |     await page.getByLabel('新建会话', { exact: true }).click()
  58 |     fail = true
  59 |     await page.getByTestId('chat-input').fill('你好，解释一下变量是什么')
  60 |     await page.getByTestId('chat-send').click()
  61 |     await expect(page.locator('.toast-red').filter({ hasText: '503' })).toBeVisible()
  62 |     const offline = await page.evaluate(() => window.murasame.core.getBootstrap())
  63 |     if (!offline.ok) throw new Error(offline.error)
  64 |     expect(offline.data.models.find(model => model.default)?.status).toBe('离线')
> 65 |     await expect(page.locator('.service-pill')).toHaveText('模型服务离线')
     |                                                 ^ Error: expect(locator).toHaveText(expected) failed
  66 |     await page.getByTestId('nav-models').click()
  67 |     await expect(page.getByTestId('model-item')).toContainText('离线')
  68 |     fail = false
  69 |     await page.getByTestId('nav-chat').click()
  70 |     await page.getByTestId('chat-input').fill('你好，请再解释一下变量')
  71 |     await page.getByTestId('chat-send').click()
  72 |     await expect(page.locator('.message-row.assistant').last()).toContainText('真实流式回复')
  73 |     await expect(page.locator('.service-pill')).toHaveText('模型服务在线')
  74 |     await page.getByTestId('nav-models').click()
  75 |     await expect(page.getByTestId('model-item')).toContainText('在线')
  76 |     await page.screenshot({ path: test.info().outputPath('service-recovers-without-reload.png') })
  77 |   } finally {
  78 |     await closeApp(app)
  79 |     server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
  80 |     await upstream.close()
  81 |   }
  82 | })
  83 |
```
