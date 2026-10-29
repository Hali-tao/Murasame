# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: model-lifecycle.spec.ts >> an old failed chat cannot invalidate a newer actual model verification
- Location: tests\e2e\model-lifecycle.spec.ts:55:5

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: "在线"
Received: "离线"
```

# Test source

```ts
  1   | import { createServer, type ServerResponse } from 'node:http'
  2   | import { expect, test } from '@playwright/test'
  3   | import { closeApp, configureTestModel, findMainPage, launchApp, startModelServer } from './helpers'
  4   |
  5   | async function controlledServer() {
  6   |   const upstream = await startModelServer({ toolResponse: tool => tool === 'get_color' ? { color: '蓝色' } : undefined })
  7   |   const pending = new Map<string, ServerResponse>()
  8   |   let holdVerification = false
  9   |   const server = createServer((request, response) => {
  10  |     let raw = ''
  11  |     request.setEncoding('utf8'); request.on('data', (part: string) => { raw += part })
  12  |     request.on('end', () => {
  13  |       void (async () => {
  14  |         const payload = JSON.parse(raw) as { stream?: boolean; messages?: Array<{ role: string; content: unknown }>; tools?: Array<{ function?: { name: string } }> }
  15  |         const text = String(payload.messages?.filter(item => item.role === 'user').at(-1)?.content ?? '')
  16  |         if (holdVerification && payload.tools?.[0]?.function?.name === 'get_color') { pending.set('verification', response); return }
  17  |         if (payload.stream && /LIFECYCLE_(FAILURE|SUCCESS)/.test(text)) { pending.set(text, response); return }
  18  |         const result = await fetch(`${upstream.url}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer test-key' }, body: raw })
  19  |         response.writeHead(result.status, { 'content-type': result.headers.get('content-type') ?? 'application/json' })
  20  |         response.end(Buffer.from(await result.arrayBuffer()))
  21  |       })().catch(() => { if (!response.writableEnded) { response.writeHead(500); response.end('fixture failure') } })
  22  |     })
  23  |   })
  24  |   await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  25  |   const address = server.address()
  26  |   if (!address || typeof address === 'string') throw new Error('No test listener')
  27  |   return {
  28  |     url: `http://127.0.0.1:${address.port}/v1`, pending,
  29  |     holdVerification() { holdVerification = true },
  30  |     releaseVerification() {
  31  |       const response = pending.get('verification')
  32  |       if (!response) throw new Error('Expected a real pending verification request')
  33  |       pending.delete('verification'); holdVerification = false
  34  |       response.writeHead(200, { 'content-type': 'application/json' })
  35  |       response.end(JSON.stringify({ choices: [{ message: { tool_calls: [{ type: 'function', function: { name: 'get_color', arguments: JSON.stringify({ color: '蓝色' }) } }] } }] }))
  36  |     },
  37  |     release(text: string, success: boolean) {
  38  |       const response = pending.get(text)
  39  |       if (!response) throw new Error('Expected a real pending HTTP request')
  40  |       pending.delete(text)
  41  |       if (success) {
  42  |         response.writeHead(200, { 'content-type': 'text/event-stream' })
  43  |         response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: '这是删除配置前已经发出的请求的完整回复。' } }] })}\n\ndata: [DONE]\n\n`)
  44  |       } else { response.writeHead(503, { 'content-type': 'text/plain' }); response.end('controlled old request failure') }
  45  |     },
  46  |     async close() {
  47  |       for (const response of pending.values()) response.destroy()
  48  |       server.closeAllConnections()
  49  |       await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  50  |       await upstream.close()
  51  |     }
  52  |   }
  53  | }
  54  |
  55  | test('an old failed chat cannot invalidate a newer actual model verification', async () => {
  56  |   test.setTimeout(90_000)
  57  |   const server = await controlledServer(), app = await launchApp()
  58  |   try {
  59  |     const page = await findMainPage(app)
  60  |     await configureTestModel(page, server.url)
  61  |     const before = await page.evaluate(() => window.murasame.core.getBootstrap())
  62  |     if (!before.ok) throw new Error(before.error)
  63  |     const previousProbe = before.data.models[0].capabilities.find(capability => capability.id === 'text.chat')?.probedAt
  64  |     // Finish the stream probe first: actual chat requests share its serial lane.
  65  |     // Hold a later tool probe so the old chat can start before verification commits.
  66  |     server.holdVerification()
  67  |     await page.getByRole('button', { name: '再测一次', exact: true }).click()
  68  |     await expect.poll(() => server.pending.has('verification')).toBe(true)
  69  |     await page.getByTestId('nav-chat').click()
  70  |     await page.getByLabel('新建会话', { exact: true }).click()
  71  |     const text = '你好，解释一下 LIFECYCLE_FAILURE'
  72  |     await page.getByTestId('chat-input').fill(text)
  73  |     await page.getByTestId('chat-send').click()
  74  |     await expect.poll(() => server.pending.has(text)).toBe(true)
  75  |     server.releaseVerification()
  76  |     await expect.poll(async () => {
  77  |       const current = await page.evaluate(() => window.murasame.core.getBootstrap())
  78  |       return current.ok && current.data.models[0].status === '在线'
  79  |         && current.data.models[0].capabilities.find(capability => capability.id === 'text.chat')?.probedAt !== previousProbe
  80  |     }).toBe(true)
  81  |     server.release(text, false)
  82  |     await expect(page.locator('.toast-red').filter({ hasText: '503' })).toBeVisible()
  83  |     const state = await page.evaluate(() => window.murasame.core.getBootstrap())
  84  |     expect(state.ok).toBe(true)
  85  |     if (!state.ok) throw new Error(state.error)
> 86  |     expect(state.data.models.find(model => model.default)?.status).toBe('在线')
      |                                                                    ^ Error: expect(received).toBe(expected) // Object.is equality
  87  |     await page.getByTestId('nav-models').click()
  88  |     await page.screenshot({ path: test.info().outputPath('verified-model-after-old-failure.png') })
  89  |   } finally { await closeApp(app); await server.close() }
  90  | })
  91  |
  92  | test('removing a model during a real pending request still delivers its complete answer to the conversation', async () => {
  93  |   test.setTimeout(90_000)
  94  |   const server = await controlledServer(), app = await launchApp()
  95  |   try {
  96  |     const page = await findMainPage(app)
  97  |     await configureTestModel(page, server.url)
  98  |     await page.getByTestId('nav-chat').click()
  99  |     await page.getByLabel('新建会话', { exact: true }).click()
  100 |     const text = '你好，解释一下 LIFECYCLE_SUCCESS'
  101 |     await page.getByTestId('chat-input').fill(text)
  102 |     await page.getByTestId('chat-send').click()
  103 |     await expect.poll(() => server.pending.has(text)).toBe(true)
  104 |     await page.getByTestId('nav-models').click()
  105 |     await page.getByTestId('delete-model').click()
  106 |     await expect(page.getByTestId('model-item')).toHaveCount(0)
  107 |     await page.getByTestId('nav-chat').click()
  108 |     server.release(text, true)
  109 |     await expect(page.locator('.message-row.assistant').last()).toContainText('这是删除配置前已经发出的请求的完整回复。')
  110 |     await expect(page.locator('.toast-red').filter({ hasText: '模型配置不存在' })).toHaveCount(0)
  111 |     const state = await page.evaluate(() => window.murasame.core.getBootstrap())
  112 |     expect(state.ok).toBe(true)
  113 |     if (!state.ok) throw new Error(state.error)
  114 |     expect(state.data.models).toEqual([])
  115 |     expect(state.data.conversations.some(conversation => conversation.messages.at(-1)?.text === '这是删除配置前已经发出的请求的完整回复。')).toBe(true)
  116 |     await page.screenshot({ path: test.info().outputPath('reply-delivered-after-model-removal.png') })
  117 |   } finally { await closeApp(app); await server.close() }
  118 | })
  119 |
```
