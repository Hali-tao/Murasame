import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listenHttp } from '../helpers/http-server'

const root = join(__dirname, '..', '..')
const userDataByApp = new WeakMap<ElectronApplication, string>()
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export async function launchApp(onboardingDone = true, prepare?: (userData: string) => void): Promise<ElectronApplication> {
  const userData = mkdtempSync(join(tmpdir(), 'murasame-e2e-'))
  // 首次引导默认会挡在前面，端到端用例直接从主控制台开始。
  writeFileSync(join(userData, 'murasame.json'), JSON.stringify({ settings: { onboardingDone } }))
  prepare?.(userData)
  const executablePath = process.env.MURASAME_E2E_EXECUTABLE
  // 宿主工具可能设置 ELECTRON_RUN_AS_NODE=1；带着它启动会让 Electron 以 Node 模式运行，
  // Chromium 的 --remote-debugging-port 会被拒绝，Playwright 直接判定启动失败。
  const env = { ...process.env, MURASAME_USER_DATA: userData } as Record<string, string>
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: executablePath ? [] : ['.'],
    cwd: root,
    env
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

export async function findMainPage(app: ElectronApplication, onboarding = false): Promise<Page> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    for (const page of app.windows()) {
      if (page.isClosed() || page.url().includes('/pet.html')) continue
      if (await page.getByTestId('nav-overview').count()) {
        // Normal launches start in the tray. Exercise the public show action
        // before driving the console; hidden DOM visibility is not an OS window.
        await page.evaluate(() => window.murasame.window.showMain())
        return page
      }
      if (onboarding && await page.getByRole('button', { name: '跳过引导，进入概览', exact: true }).count()) return page
    }
    await wait(100)
  }
  throw new Error('主控制台窗口未在预期时间内加载')
}

export async function findPetPage(app: ElectronApplication): Promise<Page> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const found = app.windows().find((page) => page.url().includes('/pet.html'))
    if (found) {
      // 满载整套运行时桌宠窗口容易被其它窗口遮挡；Chromium 会节流被遮挡渲染器，
      // 让动画/眨眼/命中采样在测试里长时间停摆。仅对测试窗口关闭后台节流并置前（不改产品行为）。
      await app.evaluate(({ BrowserWindow }) => {
        const petWindow = BrowserWindow.getAllWindows().find((item) => item.webContents.getURL().includes('/pet.html'))
        petWindow?.webContents.setBackgroundThrottling(false)
        petWindow?.moveTop()
      }).catch(() => undefined)
      await found.bringToFront().catch(() => undefined)
      return found
    }
    await wait(100)
  }
  throw new Error('桌宠窗口未在预期时间内创建')
}

export interface TestModelServer {
  url: string
  close(): Promise<void>
}

export async function startModelServer(options: { taskRoot?: string; onMessages?: (messages: Array<{ role: string; content: unknown }>) => void; toolResponse?: (tool: string, messages: Array<{ role: string; content: unknown }>) => unknown; streamChunkDelayMs?: number; onStreamChunk?: (index: number) => void } = {}): Promise<TestModelServer> {
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
      const payload = JSON.parse(raw) as { stream?: boolean; model?: string; messages?: Array<{role:string;content:unknown}>; tools?: Array<{function?:{name:string}}> }
      options.onMessages?.(payload.messages ?? [])
      if (payload.model !== 'test-model') {
        response.writeHead(404, { 'Content-Type': 'application/json' })
        response.end('{"error":"unknown model"}')
        return
      }
      const tool = payload.tools?.[0]?.function?.name
      const custom = tool ? options.toolResponse?.(tool, payload.messages ?? []) : undefined
      if (custom !== undefined) {
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', tool_calls: [{ type: 'function', function: { name: tool, arguments: JSON.stringify(custom) } }] } }] }))
        return
      }
      if (tool === 'plan_task' || tool === 'performance' || tool === 'remember') {
        const goal = String(payload.messages?.filter(item => item.role === 'user').at(-1)?.content ?? '').split('任务：').at(-1) ?? ''
        const folder = options.taskRoot ?? goal.replace(/^整理文件夹\s*/, '').trim()
        const value = tool === 'plan_task' ? { tool:'filesystem', root:folder, steps:[{id:'organize',tool:'filesystem',title:'整理文件',detail:'按类型移动并核验',expected:'文件内容保持一致',args:{action:'organize'},checks:[{kind:'file-content',path:'文档/example.txt',value:'e2e real file'}]}],question:'' } : tool === 'performance' ? { intent:'思考',relevance:0.3,consequence:0,coping:0.3,norm:0 } : { memories:[] }
        response.writeHead(200, { 'Content-Type':'application/json' })
        response.end(JSON.stringify({choices:[{message:{role:'assistant',tool_calls:[{type:'function',function:{name:tool,arguments:JSON.stringify(value)}}]}}]}))
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
          options.onStreamChunk?.(chunks.indexOf(chunk))
          response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`)
          await wait(options.streamChunkDelayMs ?? 90)
        }
        response.write('data: [DONE]\n\n')
        response.end()
      })()
    })
  })

  await listenHttp(server)
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
  targetName = '端到端测试服务'
): Promise<void> {
  // 应用不预置任何服务商，用例自己新建一条配置。
  await page.getByTestId('nav-models').click()
  await page.getByTestId('add-model').click()
  await page.getByTestId('model-config-name').fill(targetName)
  await page.getByTestId('model-provider').selectOption('OpenAI Compatible')
  await page.getByTestId('model-endpoint').fill(endpoint)
  await page.getByTestId('model-key').fill('test-key')
  await page.getByTestId('model-name').fill('test-model')
  await page.getByTestId('verify-model').click()
  await expect(page.getByText('验证成功，已经开始使用', { exact: false }).last()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('current-service-name')).toHaveText(targetName)
}
