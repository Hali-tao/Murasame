import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = join(__dirname, '..', '..')
const userDataByApp = new WeakMap<ElectronApplication, string>()
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export async function launchApp(): Promise<ElectronApplication> {
  const userData = mkdtempSync(join(tmpdir(), 'murasame-e2e-'))
  const app = await electron.launch({
    args: ['.'],
    cwd: root,
    env: { ...process.env, MURASAME_USER_DATA: userData } as Record<string, string>
  })
  userDataByApp.set(app, userData)
  return app
}

export async function closeApp(app: ElectronApplication): Promise<void> {
  await app.close()
  const userData = userDataByApp.get(app)
  if (userData) rmSync(userData, { recursive: true, force: true })
}

export function testUserData(app: ElectronApplication): string {
  const userData = userDataByApp.get(app)
  if (!userData) throw new Error('测试应用没有关联的 userData 目录')
  return userData
}

export async function findMainPage(app: ElectronApplication): Promise<Page> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    for (const page of app.windows()) {
      if (page.isClosed() || page.url().includes('/pet.html')) continue
      if (await page.getByTestId('nav-overview').count()) return page
    }
    await wait(100)
  }
  throw new Error('主控制台窗口未在预期时间内加载')
}

export async function findPetPage(app: ElectronApplication): Promise<Page> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const found = app.windows().find((page) => page.url().includes('/pet.html'))
    if (found) return found
    await wait(100)
  }
  throw new Error('桌宠窗口未在预期时间内创建')
}

export interface TestModelServer {
  url: string
  close(): Promise<void>
}

export async function startModelServer(): Promise<TestModelServer> {
  const server = createServer((request, response) => {
    if (request.method !== 'POST' || !request.url?.endsWith('/chat/completions')) {
      response.writeHead(404, { 'Content-Type': 'application/json' })
      response.end('{"error":"not found"}')
      return
    }
    if (request.headers.authorization !== 'Bearer test-key') {
      response.writeHead(401, { 'Content-Type': 'application/json' })
      response.end('{"error":"invalid key"}')
      return
    }

    let raw = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => { raw += chunk })
    request.on('end', () => {
      const payload = JSON.parse(raw) as { stream?: boolean; model?: string }
      if (payload.model !== 'test-model') {
        response.writeHead(404, { 'Content-Type': 'application/json' })
        response.end('{"error":"unknown model"}')
        return
      }
      if (!payload.stream) {
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({
          id: 'test-completion',
          object: 'chat.completion',
          choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }]
        }))
        return
      }

      response.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      })
      const chunks = ['这是来自', '测试模型的', '真实流式回复。']
      void (async () => {
        for (const chunk of chunks) {
          response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`)
          await wait(90)
        }
        response.write('data: [DONE]\n\n')
        response.end()
      })()
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('测试模型服务启动失败')
  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    })
  }
}

export async function configureTestModel(
  page: Page,
  endpoint: string,
  targetName = 'OpenAI · 主模型'
): Promise<void> {
  await page.getByTestId('nav-models').click()
  await page.getByTestId('model-item').filter({ hasText: targetName }).click()
  await page.getByTestId('model-provider').selectOption('OpenAI Compatible')
  await page.getByTestId('model-endpoint').fill(endpoint)
  await page.getByTestId('model-key').fill('test-key')
  await page.getByTestId('model-name').fill('test-model')
  await page.getByTestId('verify-model').click()
  await expect(page.getByText('连接验证成功', { exact: false }).last()).toBeVisible({ timeout: 10_000 })
  await page.getByTestId('set-default-model').click()
  await expect(page.getByTestId('current-service-name')).toHaveText(targetName)
}
