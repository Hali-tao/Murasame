import { createServer, type ServerResponse } from 'node:http'
import { expect, test } from '@playwright/test'
import { closeApp, configureTestModel, findMainPage, launchApp, startModelServer } from './helpers'

async function controlledServer() {
  const upstream = await startModelServer({ toolResponse: tool => tool === 'get_color' ? { color: '蓝色' } : undefined })
  const pending = new Map<string, ServerResponse>()
  let holdVerification = false
  const server = createServer((request, response) => {
    let raw = ''
    request.setEncoding('utf8'); request.on('data', (part: string) => { raw += part })
    request.on('end', () => {
      void (async () => {
        const payload = JSON.parse(raw) as { stream?: boolean; messages?: Array<{ role: string; content: unknown }>; tools?: Array<{ function?: { name: string } }> }
        const text = String(payload.messages?.filter(item => item.role === 'user').at(-1)?.content ?? '')
        if (holdVerification && payload.tools?.[0]?.function?.name === 'get_color') { pending.set('verification', response); return }
        if (payload.stream && /LIFECYCLE_(FAILURE|SUCCESS)/.test(text)) { pending.set(text, response); return }
        const result = await fetch(`${upstream.url}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer test-key' }, body: raw })
        response.writeHead(result.status, { 'content-type': result.headers.get('content-type') ?? 'application/json' })
        response.end(Buffer.from(await result.arrayBuffer()))
      })().catch(() => { if (!response.writableEnded) { response.writeHead(500); response.end('fixture failure') } })
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No test listener')
  return {
    url: `http://127.0.0.1:${address.port}/v1`, pending,
    holdVerification() { holdVerification = true },
    releaseVerification() {
      const response = pending.get('verification')
      if (!response) throw new Error('Expected a real pending verification request')
      pending.delete('verification'); holdVerification = false
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ choices: [{ message: { tool_calls: [{ type: 'function', function: { name: 'get_color', arguments: JSON.stringify({ color: '蓝色' }) } }] } }] }))
    },
    release(text: string, success: boolean) {
      const response = pending.get(text)
      if (!response) throw new Error('Expected a real pending HTTP request')
      pending.delete(text)
      if (success) {
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: '这是删除配置前已经发出的请求的完整回复。' } }] })}\n\ndata: [DONE]\n\n`)
      } else { response.writeHead(503, { 'content-type': 'text/plain' }); response.end('controlled old request failure') }
    },
    async close() {
      for (const response of pending.values()) response.destroy()
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
      await upstream.close()
    }
  }
}

test('an old failed chat cannot invalidate a newer actual model verification', async () => {
  test.setTimeout(90_000)
  const server = await controlledServer(), app = await launchApp()
  try {
    const page = await findMainPage(app)
    await configureTestModel(page, server.url)
    const before = await page.evaluate(() => window.murasame.core.getBootstrap())
    if (!before.ok) throw new Error(before.error)
    const previousProbe = before.data.models[0].capabilities.find(capability => capability.id === 'text.chat')?.probedAt
    // Finish the stream probe first: actual chat requests share its serial lane.
    // Hold a later tool probe so the old chat can start before verification commits.
    server.holdVerification()
    await page.getByRole('button', { name: '再测一次', exact: true }).click()
    await expect.poll(() => server.pending.has('verification')).toBe(true)
    await page.getByTestId('nav-chat').click()
    await page.getByLabel('新建会话', { exact: true }).click()
    const text = '你好，解释一下 LIFECYCLE_FAILURE'
    await page.getByTestId('chat-input').fill(text)
    await page.getByTestId('chat-send').click()
    await expect.poll(() => server.pending.has(text)).toBe(true)
    server.releaseVerification()
    await expect.poll(async () => {
      const current = await page.evaluate(() => window.murasame.core.getBootstrap())
      return current.ok && current.data.models[0].status === '在线'
        && current.data.models[0].capabilities.find(capability => capability.id === 'text.chat')?.probedAt !== previousProbe
    }).toBe(true)
    server.release(text, false)
    await expect(page.locator('.toast-red').filter({ hasText: '503' })).toBeVisible()
    const state = await page.evaluate(() => window.murasame.core.getBootstrap())
    expect(state.ok).toBe(true)
    if (!state.ok) throw new Error(state.error)
    expect(state.data.models.find(model => model.default)?.status).toBe('在线')
    await page.getByTestId('nav-models').click()
    await page.screenshot({ path: test.info().outputPath('verified-model-after-old-failure.png') })
  } finally { await closeApp(app); await server.close() }
})

test('removing a model during a real pending request still delivers its complete answer to the conversation', async () => {
  test.setTimeout(90_000)
  const server = await controlledServer(), app = await launchApp()
  try {
    const page = await findMainPage(app)
    await configureTestModel(page, server.url)
    await page.getByTestId('nav-chat').click()
    await page.getByLabel('新建会话', { exact: true }).click()
    const text = '你好，解释一下 LIFECYCLE_SUCCESS'
    await page.getByTestId('chat-input').fill(text)
    await page.getByTestId('chat-send').click()
    await expect.poll(() => server.pending.has(text)).toBe(true)
    await page.getByTestId('nav-models').click()
    await page.getByTestId('delete-model').click()
    await expect(page.getByTestId('model-item')).toHaveCount(0)
    await page.getByTestId('nav-chat').click()
    server.release(text, true)
    await expect(page.locator('.message-row.assistant').last()).toContainText('这是删除配置前已经发出的请求的完整回复。')
    await expect(page.locator('.toast-red').filter({ hasText: '模型配置不存在' })).toHaveCount(0)
    const state = await page.evaluate(() => window.murasame.core.getBootstrap())
    expect(state.ok).toBe(true)
    if (!state.ok) throw new Error(state.error)
    expect(state.data.models).toEqual([])
    expect(state.data.conversations.some(conversation => conversation.messages.at(-1)?.text === '这是删除配置前已经发出的请求的完整回复。')).toBe(true)
    await page.screenshot({ path: test.info().outputPath('reply-delivered-after-model-removal.png') })
  } finally { await closeApp(app); await server.close() }
})
