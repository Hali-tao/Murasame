# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: task-directory.spec.ts >> [FR-18] 模型建议目录保持待确认，实际选择后才进入敏感操作审批
- Location: tests\e2e\task-directory.spec.ts:56:5

# Error details

```
Error: expect(locator).toHaveText(expected) failed

Locator:  getByTestId('current-service-name')
Expected: "端到端测试服务"
Received: "新的模型配置端到端测试服务"
Timeout:  5000ms

Call log:
  - Expect "toHaveText" getByTestId('current-service-name') with timeout 5000ms
  - waiting for getByTestId('current-service-name')
    14 × locator resolved to <strong data-testid="current-service-name">新的模型配置端到端测试服务</strong>
       - unexpected value "新的模型配置端到端测试服务"

```

```yaml
- strong: 新的模型配置端到端测试服务
```

# Test source

```ts
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
  154 | ): Promise<void> {
  155 |   // 应用不预置任何服务商，用例自己新建一条配置。
  156 |   await page.getByTestId('nav-models').click()
  157 |   await page.getByTestId('add-model').click()
  158 |   await page.getByTestId('model-config-name').fill(targetName)
  159 |   await page.getByTestId('model-provider').selectOption('OpenAI Compatible')
  160 |   await page.getByTestId('model-endpoint').fill(endpoint)
  161 |   await page.getByTestId('model-key').fill('test-key')
  162 |   await page.getByTestId('model-name').fill('test-model')
  163 |   await page.getByTestId('verify-model').click()
  164 |   await expect(page.getByText('验证成功，已经开始使用', { exact: false }).last()).toBeVisible({ timeout: 15_000 })
> 165 |   await expect(page.getByTestId('current-service-name')).toHaveText(targetName)
      |                                                          ^ Error: expect(locator).toHaveText(expected) failed
  166 | }
  167 |
```
