# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: local-memory.spec.ts >> [FR-14] 真实离线BGE在Electron中召回独立偏好并进入实际对话请求
- Location: tests\e2e\local-memory.spec.ts:7:5

# Error details

```
Error: 主控制台窗口未在预期时间内加载
```

# Test source

```ts
  1   | import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test'
  2   | import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
  3   | import { createServer } from 'node:http'
  4   | import { tmpdir } from 'node:os'
  5   | import { join } from 'node:path'
  6   |
  7   | const root = join(__dirname, '..', '..')
  8   | const userDataByApp = new WeakMap<ElectronApplication, string>()
  9   | const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
  10  |
  11  | export async function launchApp(onboardingDone = true, prepare?: (userData: string) => void): Promise<ElectronApplication> {
  12  |   const userData = mkdtempSync(join(tmpdir(), 'murasame-e2e-'))
  13  |   // 首次引导默认会挡在前面，端到端用例直接从主控制台开始。
  14  |   writeFileSync(join(userData, 'murasame.json'), JSON.stringify({ settings: { onboardingDone } }))
  15  |   prepare?.(userData)
  16  |   const executablePath = process.env.MURASAME_E2E_EXECUTABLE
  17  |   const app = await electron.launch({
  18  |     ...(executablePath ? { executablePath } : {}),
  19  |     args: executablePath ? [] : ['.'],
  20  |     cwd: root,
  21  |     env: { ...process.env, MURASAME_USER_DATA: userData } as Record<string, string>
  22  |   })
  23  |   userDataByApp.set(app, userData)
  24  |   return app
  25  | }
  26  |
  27  | export async function closeApp(app: ElectronApplication): Promise<void> {
  28  |   await app.close()
  29  |   const userData = userDataByApp.get(app)
  30  |   if (userData) rmSync(userData, { recursive: true, force: true })
  31  | }
  32  |
  33  | export function testUserData(app: ElectronApplication): string {
  34  |   const userData = userDataByApp.get(app)
  35  |   if (!userData) throw new Error('测试应用没有关联的 userData 目录')
  36  |   return userData
  37  | }
  38  |
  39  | export async function findMainPage(app: ElectronApplication, onboarding = false): Promise<Page> {
  40  |   for (let attempt = 0; attempt < 100; attempt += 1) {
  41  |     for (const page of app.windows()) {
  42  |       if (page.isClosed() || page.url().includes('/pet.html')) continue
  43  |       if (await page.getByTestId('nav-overview').count()) {
  44  |         // Normal launches start in the tray. Exercise the public show action
  45  |         // before driving the console; hidden DOM visibility is not an OS window.
  46  |         await page.evaluate(() => window.murasame.window.showMain())
  47  |         return page
  48  |       }
  49  |       if (onboarding && await page.getByRole('button', { name: '跳过', exact: true }).count()) return page
  50  |     }
  51  |     await wait(100)
  52  |   }
> 53  |   throw new Error('主控制台窗口未在预期时间内加载')
      |         ^ Error: 主控制台窗口未在预期时间内加载
  54  | }
  55  |
  56  | export async function findPetPage(app: ElectronApplication): Promise<Page> {
  57  |   for (let attempt = 0; attempt < 100; attempt += 1) {
  58  |     const found = app.windows().find((page) => page.url().includes('/pet.html'))
  59  |     if (found) return found
  60  |     await wait(100)
  61  |   }
  62  |   throw new Error('桌宠窗口未在预期时间内创建')
  63  | }
  64  |
  65  | export interface TestModelServer {
  66  |   url: string
  67  |   close(): Promise<void>
  68  | }
  69  |
  70  | export async function startModelServer(options: { taskRoot?: string; onMessages?: (messages: Array<{ role: string; content: unknown }>) => void; toolResponse?: (tool: string, messages: Array<{ role: string; content: unknown }>) => unknown } = {}): Promise<TestModelServer> {
  71  |   const server = createServer((request, response) => {
  72  |     if (request.method !== 'POST' || !request.url?.endsWith('/chat/completions')) {
  73  |       response.writeHead(404, { 'Content-Type': 'application/json' })
  74  |       response.end('{"error":"not found"}')
  75  |       return
  76  |     }
  77  |     if (request.headers.authorization !== 'Bearer test-key') {
  78  |       response.writeHead(401, { 'Content-Type': 'application/json' })
  79  |       response.end('{"error":"invalid key"}')
  80  |       return
  81  |     }
  82  |
  83  |     let raw = ''
  84  |     request.setEncoding('utf8')
  85  |     request.on('data', (chunk: string) => { raw += chunk })
  86  |     request.on('end', () => {
  87  |       const payload = JSON.parse(raw) as { stream?: boolean; model?: string; messages?: Array<{role:string;content:unknown}>; tools?: Array<{function?:{name:string}}> }
  88  |       options.onMessages?.(payload.messages ?? [])
  89  |       if (payload.model !== 'test-model') {
  90  |         response.writeHead(404, { 'Content-Type': 'application/json' })
  91  |         response.end('{"error":"unknown model"}')
  92  |         return
  93  |       }
  94  |       const tool = payload.tools?.[0]?.function?.name
  95  |       const custom = tool ? options.toolResponse?.(tool, payload.messages ?? []) : undefined
  96  |       if (custom !== undefined) {
  97  |         response.writeHead(200, { 'Content-Type': 'application/json' })
  98  |         response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', tool_calls: [{ type: 'function', function: { name: tool, arguments: JSON.stringify(custom) } }] } }] }))
  99  |         return
  100 |       }
  101 |       if (tool === 'plan_task' || tool === 'performance' || tool === 'remember') {
  102 |         const goal = String(payload.messages?.filter(item => item.role === 'user').at(-1)?.content ?? '').split('任务：').at(-1) ?? ''
  103 |         const folder = options.taskRoot ?? goal.replace(/^整理文件夹\s*/, '').trim()
  104 |         const value = tool === 'plan_task' ? { tool:'filesystem', root:folder, steps:[{id:'organize',tool:'filesystem',title:'整理文件',detail:'按类型移动并核验',expected:'文件内容保持一致',args:{action:'organize'},checks:[{kind:'file-content',path:'文档/example.txt',value:'e2e real file'}]}],question:'' } : tool === 'performance' ? { intent:'思考',relevance:0.3,consequence:0,coping:0.3,norm:0 } : { memories:[] }
  105 |         response.writeHead(200, { 'Content-Type':'application/json' })
  106 |         response.end(JSON.stringify({choices:[{message:{role:'assistant',tool_calls:[{type:'function',function:{name:tool,arguments:JSON.stringify(value)}}]}}]}))
  107 |         return
  108 |       }
  109 |       if (!payload.stream) {
  110 |         response.writeHead(200, { 'Content-Type': 'application/json' })
  111 |         response.end(JSON.stringify({
  112 |           id: 'test-completion',
  113 |           object: 'chat.completion',
  114 |           choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }]
  115 |         }))
  116 |         return
  117 |       }
  118 |
  119 |       response.writeHead(200, {
  120 |         'Content-Type': 'text/event-stream; charset=utf-8',
  121 |         'Cache-Control': 'no-cache',
  122 |         Connection: 'keep-alive'
  123 |       })
  124 |       const chunks = ['这是来自', '测试模型的', '真实流式回复。']
  125 |       void (async () => {
  126 |         for (const chunk of chunks) {
  127 |           response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`)
  128 |           await wait(90)
  129 |         }
  130 |         response.write('data: [DONE]\n\n')
  131 |         response.end()
  132 |       })()
  133 |     })
  134 |   })
  135 |
  136 |   await new Promise<void>((resolve, reject) => {
  137 |     server.once('error', reject)
  138 |     server.listen(0, '127.0.0.1', () => resolve())
  139 |   })
  140 |   const address = server.address()
  141 |   if (!address || typeof address === 'string') throw new Error('测试模型服务启动失败')
  142 |   return {
  143 |     url: `http://127.0.0.1:${address.port}/v1`,
  144 |     close: () => new Promise<void>((resolve, reject) => {
  145 |       server.close((error) => error ? reject(error) : resolve())
  146 |     })
  147 |   }
  148 | }
  149 |
  150 | export async function configureTestModel(
  151 |   page: Page,
  152 |   endpoint: string,
  153 |   targetName = '端到端测试服务'
```
