# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: model-lifecycle.spec.ts >> removing a model during a real pending request still delivers its complete answer to the conversation
- Location: tests\e2e\model-lifecycle.spec.ts:70:5

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: locator('.message-row.assistant').last()
Expected substring: "这是删除配置前已经发出的请求的完整回复。"
Received string:    "雨桌宠12:25朗读我在。"
Timeout: 5000ms

Call log:
  - Expect "toContainText" locator('.message-row.assistant').last() with timeout 5000ms
  - waiting for locator('.message-row.assistant').last()
    14 × locator resolved to <div class="message-row assistant">…</div>
       - unexpected value "雨桌宠12:25朗读我在。"

```

```yaml
- text: 雨
- strong: 桌宠
- time: 12:25
- button "朗读"
- text: 我在。
```

# Test source

```ts
  1  | import { createServer, type ServerResponse } from 'node:http'
  2  | import { expect, test } from '@playwright/test'
  3  | import { closeApp, configureTestModel, findMainPage, launchApp, startModelServer } from './helpers'
  4  |
  5  | async function controlledServer() {
  6  |   const upstream = await startModelServer({ toolResponse: tool => tool === 'get_color' ? { color: '蓝色' } : undefined })
  7  |   const pending = new Map<string, ServerResponse>()
  8  |   const server = createServer((request, response) => {
  9  |     let raw = ''
  10 |     request.setEncoding('utf8'); request.on('data', (part: string) => { raw += part })
  11 |     request.on('end', () => {
  12 |       void (async () => {
  13 |         const payload = JSON.parse(raw) as { stream?: boolean; messages?: Array<{ role: string; content: unknown }> }
  14 |         const text = String(payload.messages?.filter(item => item.role === 'user').at(-1)?.content ?? '')
  15 |         if (payload.stream && /LIFECYCLE_(FAILURE|SUCCESS)/.test(text)) { pending.set(text, response); return }
  16 |         const result = await fetch(`${upstream.url}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer test-key' }, body: raw })
  17 |         response.writeHead(result.status, { 'content-type': result.headers.get('content-type') ?? 'application/json' })
  18 |         response.end(Buffer.from(await result.arrayBuffer()))
  19 |       })().catch(() => { if (!response.writableEnded) { response.writeHead(500); response.end('fixture failure') } })
  20 |     })
  21 |   })
  22 |   await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  23 |   const address = server.address()
  24 |   if (!address || typeof address === 'string') throw new Error('No test listener')
  25 |   return {
  26 |     url: `http://127.0.0.1:${address.port}/v1`, pending,
  27 |     release(text: string, success: boolean) {
  28 |       const response = pending.get(text)
  29 |       if (!response) throw new Error('Expected a real pending HTTP request')
  30 |       pending.delete(text)
  31 |       if (success) {
  32 |         response.writeHead(200, { 'content-type': 'text/event-stream' })
  33 |         response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: '这是删除配置前已经发出的请求的完整回复。' } }] })}\n\ndata: [DONE]\n\n`)
  34 |       } else { response.writeHead(503, { 'content-type': 'text/plain' }); response.end('controlled old request failure') }
  35 |     },
  36 |     async close() {
  37 |       for (const response of pending.values()) response.destroy()
  38 |       server.closeAllConnections()
  39 |       await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  40 |       await upstream.close()
  41 |     }
  42 |   }
  43 | }
  44 |
  45 | test('an old failed chat cannot invalidate a newer actual model verification', async () => {
  46 |   test.setTimeout(90_000)
  47 |   const server = await controlledServer(), app = await launchApp()
  48 |   try {
  49 |     const page = await findMainPage(app)
  50 |     await configureTestModel(page, server.url)
  51 |     await page.getByTestId('nav-chat').click()
  52 |     await page.getByLabel('新建会话', { exact: true }).click()
  53 |     const text = '你好，解释一下 LIFECYCLE_FAILURE'
  54 |     await page.getByTestId('chat-input').fill(text)
  55 |     await page.getByTestId('chat-send').click()
  56 |     await expect.poll(() => server.pending.has(text)).toBe(true)
  57 |     await page.getByTestId('nav-models').click()
  58 |     await page.getByRole('button', { name: '再测一次', exact: true }).click()
  59 |     await expect(page.getByRole('button', { name: '再测一次', exact: true })).toBeEnabled()
  60 |     server.release(text, false)
  61 |     await expect(page.locator('.toast-red').filter({ hasText: '503' })).toBeVisible()
  62 |     const state = await page.evaluate(() => window.murasame.core.getBootstrap())
  63 |     expect(state.ok).toBe(true)
  64 |     if (!state.ok) throw new Error(state.error)
  65 |     expect(state.data.models.find(model => model.default)?.status).toBe('在线')
  66 |     await page.screenshot({ path: test.info().outputPath('verified-model-after-old-failure.png') })
  67 |   } finally { await closeApp(app); await server.close() }
  68 | })
  69 |
  70 | test('removing a model during a real pending request still delivers its complete answer to the conversation', async () => {
  71 |   test.setTimeout(90_000)
  72 |   const server = await controlledServer(), app = await launchApp()
  73 |   try {
  74 |     const page = await findMainPage(app)
  75 |     await configureTestModel(page, server.url)
  76 |     await page.getByTestId('nav-chat').click()
  77 |     await page.getByLabel('新建会话', { exact: true }).click()
  78 |     const text = '你好，解释一下 LIFECYCLE_SUCCESS'
  79 |     await page.getByTestId('chat-input').fill(text)
  80 |     await page.getByTestId('chat-send').click()
  81 |     await expect.poll(() => server.pending.has(text)).toBe(true)
  82 |     await page.getByTestId('nav-models').click()
  83 |     await page.getByTestId('delete-model').click()
  84 |     await expect(page.getByTestId('model-item')).toHaveCount(0)
  85 |     await page.getByTestId('nav-chat').click()
  86 |     server.release(text, true)
> 87 |     await expect(page.locator('.message-row.assistant').last()).toContainText('这是删除配置前已经发出的请求的完整回复。')
     |                                                                 ^ Error: expect(locator).toContainText(expected) failed
  88 |     await expect(page.locator('.toast-red').filter({ hasText: '模型配置不存在' })).toHaveCount(0)
  89 |     const state = await page.evaluate(() => window.murasame.core.getBootstrap())
  90 |     expect(state.ok).toBe(true)
  91 |     if (!state.ok) throw new Error(state.error)
  92 |     expect(state.data.models).toEqual([])
  93 |     expect(state.data.conversations.some(conversation => conversation.messages.at(-1)?.text === '这是删除配置前已经发出的请求的完整回复。')).toBe(true)
  94 |     await page.screenshot({ path: test.info().outputPath('reply-delivered-after-model-removal.png') })
  95 |   } finally { await closeApp(app); await server.close() }
  96 | })
  97 |
```
