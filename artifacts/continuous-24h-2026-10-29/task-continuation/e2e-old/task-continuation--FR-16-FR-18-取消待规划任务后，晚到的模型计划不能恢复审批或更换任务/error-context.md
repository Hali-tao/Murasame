# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: task-continuation.spec.ts >> [FR-16/FR-18] 取消待规划任务后，晚到的模型计划不能恢复审批或更换任务
- Location: tests\e2e\task-continuation.spec.ts:8:5

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: false
Received: true
```

# Test source

```ts
  1  | import { createServer, type ServerResponse } from 'node:http'
  2  | import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
  3  | import { tmpdir } from 'node:os'
  4  | import { join } from 'node:path'
  5  | import { expect, test } from '@playwright/test'
  6  | import { closeApp, configureTestModel, findMainPage, launchApp, startModelServer } from './helpers'
  7  |
  8  | test('[FR-16/FR-18] 取消待规划任务后，晚到的模型计划不能恢复审批或更换任务', async () => {
  9  |   test.setTimeout(90_000)
  10 |   const root = mkdtempSync(join(tmpdir(), 'task-continuation-ui-'))
  11 |   const upstream = await startModelServer()
  12 |   let pending: ServerResponse | undefined
  13 |   function reply(response: ServerResponse, later: boolean): void {
  14 |     const value = { tool: 'filesystem', root, question: later ? '' : '请补充目标', steps: [{ id: 'write', title: later ? '晚到的新计划' : '原计划', detail: '创建合成文件', expected: '', args: { action: 'write', path: 'late.txt', content: 'synthetic output' }, checks: [{ kind: 'file-content', path: 'late.txt', value: 'synthetic output' }] }] }
  15 |     response.writeHead(200, { 'content-type': 'application/json' })
  16 |     response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', tool_calls: [{ type: 'function', function: { name: 'plan_task', arguments: JSON.stringify(value) } }] } }] }))
  17 |   }
  18 |   const server = createServer((request, response) => {
  19 |     let raw = ''; request.setEncoding('utf8'); request.on('data', (part: string) => { raw += part })
  20 |     request.on('end', () => {
  21 |       void (async () => {
  22 |         const payload = JSON.parse(raw) as { tools?: Array<{ function?: { name: string } }>; messages?: Array<{ role: string; content: unknown }> }
  23 |         const goal = String(payload.messages?.filter(message => message.role === 'user').at(-1)?.content ?? '')
  24 |         if (payload.tools?.[0]?.function?.name === 'plan_task' && goal.includes('TASK_CONTINUE_TEST')) {
  25 |           if (goal.includes('CONTINUE_LATE')) { pending = response; return }
  26 |           reply(response, false); return
  27 |         }
  28 |         const result = await fetch(`${upstream.url}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer test-key' }, body: raw })
  29 |         response.writeHead(result.status, { 'content-type': result.headers.get('content-type') ?? 'application/json' }); response.end(Buffer.from(await result.arrayBuffer()))
  30 |       })().catch(() => { if (!response.writableEnded) { response.writeHead(500); response.end('controlled server failure') } })
  31 |     })
  32 |   })
  33 |   await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  34 |   const address = server.address(); if (!address || typeof address === 'string') throw new Error('No test server')
  35 |   const app = await launchApp()
  36 |   try {
  37 |     const page = await findMainPage(app)
  38 |     await configureTestModel(page, `http://127.0.0.1:${address.port}/v1`)
  39 |     const created = await page.evaluate(root => window.murasame.core.createTask('创建任务 TASK_CONTINUE_TEST', root), root)
  40 |     if (!created.ok) throw new Error(created.error)
  41 |     await page.getByTestId('nav-tasks').click()
  42 |     await expect(page.locator('.task-detail-titleline .pill')).toHaveText('待确认')
  43 |     const continuation = page.evaluate(id => window.murasame.core.continueTask(id, 'CONTINUE_LATE 写入新文件'), created.data.id)
  44 |     await expect.poll(() => Boolean(pending)).toBe(true)
  45 |     await page.getByTestId('cancel-task').click()
  46 |     await page.getByRole('dialog').getByRole('button', { name: '取消任务', exact: true }).click()
  47 |     await expect(page.locator('.task-detail-titleline .pill')).toHaveText('已取消')
  48 |     reply(pending!, true); pending = undefined
  49 |     const returned = await continuation
  50 |     const after = await page.evaluate(() => window.murasame.core.getBootstrap())
  51 |     if (!after.ok) throw new Error(after.error)
  52 |     const task = after.data.tasks.find(task => task.id === created.data.id)
  53 |     await page.screenshot({ path: test.info().outputPath('cancelled-after-late-plan.png') })
> 54 |     expect(returned.ok).toBe(false)
     |                         ^ Error: expect(received).toBe(expected) // Object.is equality
  55 |     expect(task?.status).toBe('已取消'); expect(task?.title).toBe(created.data.title)
  56 |     await expect(page.locator('.task-detail-titleline .pill')).toHaveText('已取消')
  57 |     await expect(page.getByTestId('approve-task')).toHaveCount(0)
  58 |     expect(readdirSync(root)).toEqual([])
  59 |   } finally {
  60 |     pending?.destroy(); server.closeAllConnections()
  61 |     await closeApp(app)
  62 |     await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  63 |     await upstream.close(); rmSync(root, { recursive: true, force: true })
  64 |   }
  65 | })
  66 |
```
