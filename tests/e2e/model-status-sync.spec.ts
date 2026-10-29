import { expect, test } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { closeApp, configureTestModel, findMainPage, launchApp, startModelServer } from './helpers'

test('[FR-25] verified service status survives a completed chat and renderer reload', async () => {
  const server = await startModelServer(), app = await launchApp()
  const snapshots: unknown[] = []
  try {
    const page = await findMainPage(app)
    await configureTestModel(page, server.url)
    const snapshot = async (stage: string) => {
      const result = await page.evaluate(() => window.murasame.core.getBootstrap())
      if (!result.ok) throw new Error(result.error)
      snapshots.push({ stage, models: result.data.models, label: await page.locator('.service-pill').innerText() })
      return result.data.models
    }
    expect((await snapshot('verified')).find(model => model.default)?.status).toBe('在线')
    await page.getByTestId('nav-chat').click()
    await page.getByLabel('新建会话', { exact: true }).click()
    await page.getByTestId('chat-input').fill('你好，请解释一下变量是什么')
    await page.getByTestId('chat-send').click()
    await expect(page.locator('.message-row.assistant').last()).toContainText('真实流式回复')
    expect((await snapshot('after-chat')).find(model => model.default)?.status).toBe('在线')
    await page.reload()
    await expect(page.getByTestId('nav-chat')).toBeVisible()
    expect((await snapshot('reloaded')).find(model => model.default)?.status).toBe('在线')
    await expect(page.locator('.service-pill')).toHaveText('模型服务在线')
    await page.screenshot({ path: test.info().outputPath('verified-status-after-reload.png') })
  } finally {
    writeFileSync(test.info().outputPath('status-snapshots.json'), JSON.stringify(snapshots, null, 2))
    await closeApp(app); await server.close()
  }
})

test('[FR-25] real chat failure and recovery update the current service without reloading', async () => {
  const upstream = await startModelServer()
  let fail = false
  const server = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8'); request.on('data', chunk => { body += chunk })
    request.on('end', () => {
      if (fail) { response.writeHead(503); response.end('controlled service outage'); return }
      void fetch(`${upstream.url}/chat/completions`, { method: 'POST', headers: { authorization: 'Bearer test-key', 'content-type': 'application/json' }, body })
        .then(async result => { response.writeHead(result.status, { 'content-type': result.headers.get('content-type') ?? 'application/json' }); response.end(Buffer.from(await result.arrayBuffer())) })
        .catch(() => { response.writeHead(500); response.end('fixture proxy failure') })
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No local listener')
  const app = await launchApp()
  try {
    const page = await findMainPage(app)
    await configureTestModel(page, `http://127.0.0.1:${address.port}/v1`)
    await page.getByTestId('nav-chat').click()
    await page.getByLabel('新建会话', { exact: true }).click()
    fail = true
    await page.getByTestId('chat-input').fill('你好，解释一下变量是什么')
    await page.getByTestId('chat-send').click()
    await expect(page.locator('.toast-red').filter({ hasText: '503' })).toBeVisible()
    const offline = await page.evaluate(() => window.murasame.core.getBootstrap())
    if (!offline.ok) throw new Error(offline.error)
    expect(offline.data.models.find(model => model.default)?.status).toBe('离线')
    await expect(page.locator('.service-pill')).toHaveText('模型服务离线')
    await page.getByTestId('nav-models').click()
    await expect(page.getByTestId('model-item')).toContainText('离线')
    await expect(page.locator('.current-service-banner')).toContainText('当前服务离线')
    await expect(page.locator('.use-result')).toContainText('最近请求未成功')
    await expect(page.locator('.use-result')).not.toContainText('验证未通过')
    await expect(page.locator('.use-result')).not.toContainText('连接测试返回了内容')
    await page.screenshot({ path: test.info().outputPath('service-offline-without-reload.png') })
    fail = false
    await page.getByTestId('nav-chat').click()
    await page.getByTestId('chat-input').fill('你好，请再解释一下变量')
    await page.getByTestId('chat-send').click()
    await expect(page.locator('.message-row.assistant').last()).toContainText('真实流式回复')
    await expect(page.locator('.service-pill')).toHaveText('模型服务在线')
    await page.getByTestId('nav-models').click()
    await expect(page.getByTestId('model-item')).toContainText('验证成功')
    await expect(page.getByTestId('model-item')).toContainText('正在使用')
    await expect(page.locator('.use-result')).not.toContainText('最近请求未成功')
    await page.screenshot({ path: test.info().outputPath('service-recovers-without-reload.png') })
  } finally {
    await closeApp(app)
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
    await upstream.close()
  }
})
