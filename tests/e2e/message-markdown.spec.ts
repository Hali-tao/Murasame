import { createServer } from 'node:http'
import { expect, test } from '@playwright/test'
import { closeApp, configureTestModel, findMainPage, findPetPage, launchApp, startModelServer } from './helpers'
import { listenHttp } from '../helpers/http-server'

test('[FR-01] [FR-02] Markdown streams, persists into history and pet chat, and copies exact code', async () => {
  test.setTimeout(90_000)
  const prefix = '# 格式验收\n\n**重点** 与 *强调*\n\n- 第一项\n- 第二项\n\n[示例链接](https://example.com/docs)\n\n| 项目 | 值 |\n| --- | --- |\n| 答案 | 42 |\n\n~~~js\n  const answer ='
  const suffix = ' 42;\n\tconsole.log(answer);  \n~~~\n\n<script>window.markdownExecuted = true</script>\n\n![外部图片](https://example.com/track.png)' + String.raw`

渲染方程：
\[
L_o(x,\omega_o)=L_e(x,\omega_o)+\int_{\Omega}f_r(x,\omega_i,\omega_o)L_i(x,\omega_i)\cos\theta_i\,d\omega_i
\]

行内公式 \(E=mc^2\)。`
  const complete = prefix + suffix
  const code = '  const answer = 42;\n\tconsole.log(answer);  '
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const upstream = await startModelServer()
  const server = createServer((request, response) => {
    let raw = ''
    request.setEncoding('utf8'); request.on('data', chunk => { raw += chunk })
    request.on('end', () => {
      void (async () => {
        const body = raw ? JSON.parse(raw) as { stream?: boolean; messages?: Array<{ role: string; content: unknown }> } : {}
        if (body.stream && body.messages?.some(message => message.role === 'user' && JSON.stringify(message.content).includes('Markdown 格式验收'))) {
          response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
          const send = (content: string): void => { response.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`) }
          send(prefix); await gate; send(suffix); response.end('data: [DONE]\n\n')
        } else {
          const result = await fetch(new URL(request.url || '/', upstream.url), { method: request.method, headers: { 'content-type': 'application/json', authorization: request.headers.authorization || '' }, ...(raw ? { body: raw } : {}) })
          response.writeHead(result.status, { 'Content-Type': result.headers.get('content-type') || 'application/json' }); response.end(await result.text())
        }
      })().catch(() => { if (!response.writableEnded) { response.writeHead(500); response.end('fixture error') } })
    })
  })
  await listenHttp(server)
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No fixture listener')
  const app = await launchApp()
  try {
    const page = await findMainPage(app)
    await configureTestModel(page, `http://127.0.0.1:${address.port}/v1`)
    await page.getByTestId('nav-chat').click()
    await page.getByLabel('新建会话', { exact: true }).click()
    await page.getByTestId('chat-input').fill('请给出 Markdown 格式验收')
    await page.getByTestId('chat-send').click()
    const stream = page.locator('.message-markdown[data-streaming="true"]')
    await expect(stream.getByRole('heading', { name: '格式验收' })).toBeVisible()
    await expect(stream.locator('.markdown-code-block code')).toHaveText('  const answer =')
    await expect(stream.getByRole('link')).toHaveCount(0)
    await stream.getByRole('button', { name: '复制代码' }).click()
    await expect(stream.getByRole('status')).toHaveText('已复制当前片段')
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe('  const answer =')
    const pet = await findPetPage(app)
    await pet.locator('.pet-character').click({ button: 'right' })
    await pet.getByRole('button', { name: '打开对话', exact: true }).click()
    await expect(pet.locator('.pet-chat .message-markdown[data-streaming="true"] pre code')).toHaveText('  const answer =')
    release()
    await expect(page.locator('.message-markdown[data-streaming="true"]')).toHaveCount(0)
    for (const surface of [page.locator('.message-row.assistant').last(), pet.locator('.pet-chat-line.assistant').last()]) {
      await expect(surface.getByRole('heading', { name: '格式验收' })).toBeVisible()
      await expect(surface.getByRole('table')).toContainText('答案')
      await expect(surface.locator('.katex')).toHaveCount(2)
      await expect(surface.locator('.katex-display')).toBeVisible()
      await expect(surface.locator('.katex-error')).toHaveCount(0)
      await expect(surface.locator('.message-markdown img, .message-markdown script')).toHaveCount(0)
      await surface.getByRole('button', { name: '复制代码' }).click()
      await expect(surface.getByRole('status')).toHaveText('已复制')
      expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(code)
    }
    await pet.screenshot({ path: test.info().outputPath('pet-markdown.png') })
    await expect(page.locator('.chat-messages').getByRole('button', { name: '查看原文' })).toHaveCount(0)
    await page.locator('.message-row.user').last().getByRole('button', { name: '复制消息' }).click()
    await expect(page.locator('.message-row.user').last().locator('.message-copy-feedback')).toHaveText('已复制')
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe('请给出 Markdown 格式验收')
    await page.locator('.message-row.assistant').last().getByRole('button', { name: '复制回复' }).click()
    await expect(page.locator('.message-row.assistant').last().locator('.message-copy-feedback')).toHaveText('已复制')
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(complete)
    await page.getByTestId('nav-history').click()
    const history = page.locator('.history-messages .message-row.assistant').last()
    await expect(history.getByRole('heading', { name: '格式验收' })).toBeVisible()
    await expect(history.locator('.katex')).toHaveCount(2)
    expect(await page.evaluate(async () => { await document.fonts.ready; return document.fonts.check('16px KaTeX_Main') })).toBe(true)
    await expect(history.getByRole('link', { name: '示例链接' })).toHaveAttribute('href', 'https://example.com/docs')
    await history.getByRole('button', { name: '复制代码' }).click()
    await expect(history.getByRole('status')).toHaveText('已复制')
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(code)
    await expect(history.getByRole('button', { name: '查看原文' })).toHaveCount(0)
    await history.getByRole('button', { name: '复制回复' }).click()
    await expect(history.locator('.message-copy-feedback')).toHaveText('已复制')
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(complete)
    await page.screenshot({ path: test.info().outputPath('history-markdown-source.png') })
  } finally {
    release(); await closeApp(app)
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    await upstream.close()
  }
})
