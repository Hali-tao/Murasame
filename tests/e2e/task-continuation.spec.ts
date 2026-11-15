import { createServer, type ServerResponse } from 'node:http'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { closeApp, configureTestModel, findMainPage, launchApp, startModelServer } from './helpers'
import { listenHttp } from '../helpers/http-server'

test('[FR-16/FR-18] 取消待规划任务后，晚到的模型计划不能恢复审批或更换任务', async () => {
  test.setTimeout(90_000)
  const root = mkdtempSync(join(tmpdir(), 'task-continuation-ui-'))
  const upstream = await startModelServer()
  let pending: ServerResponse | undefined
  function reply(response: ServerResponse, later: boolean): void {
    const value = { tool: 'filesystem', root, question: later ? '' : '请补充目标', steps: [{ id: 'write', title: later ? '晚到的新计划' : '原计划', detail: '创建合成文件', expected: '', args: { action: 'write', path: 'late.txt', content: 'synthetic output' }, checks: [{ kind: 'file-content', path: 'late.txt', value: 'synthetic output' }] }] }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', tool_calls: [{ type: 'function', function: { name: 'plan_task', arguments: JSON.stringify(value) } }] } }] }))
  }
  const server = createServer((request, response) => {
    let raw = ''; request.setEncoding('utf8'); request.on('data', (part: string) => { raw += part })
    request.on('end', () => {
      void (async () => {
        const payload = JSON.parse(raw) as { tools?: Array<{ function?: { name: string } }>; messages?: Array<{ role: string; content: unknown }> }
        const goal = String(payload.messages?.filter(message => message.role === 'user').at(-1)?.content ?? '')
        if (payload.tools?.[0]?.function?.name === 'plan_task' && goal.includes('TASK_CONTINUE_TEST')) {
          if (goal.includes('CONTINUE_LATE')) { pending = response; return }
          reply(response, false); return
        }
        const result = await fetch(`${upstream.url}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer test-key' }, body: raw })
        response.writeHead(result.status, { 'content-type': result.headers.get('content-type') ?? 'application/json' }); response.end(Buffer.from(await result.arrayBuffer()))
      })().catch(() => { if (!response.writableEnded) { response.writeHead(500); response.end('controlled server failure') } })
    })
  })
  await listenHttp(server)
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No test server')
  const app = await launchApp()
  try {
    const page = await findMainPage(app)
    await configureTestModel(page, `http://127.0.0.1:${address.port}/v1`)
    const created = await page.evaluate(root => window.murasame.core.createTask('创建任务 TASK_CONTINUE_TEST', root), root)
    if (!created.ok) throw new Error(created.error)
    await page.getByTestId('nav-tasks').click()
    await expect(page.locator('.task-detail-titleline .pill')).toHaveText('待确认')
    const continuation = page.evaluate(id => window.murasame.core.continueTask(id, 'CONTINUE_LATE 写入新文件'), created.data.id)
    await expect.poll(() => Boolean(pending)).toBe(true)
    await page.getByTestId('cancel-task').click()
    await page.getByRole('dialog').getByRole('button', { name: '取消任务', exact: true }).click()
    await expect(page.locator('.task-detail-titleline .pill')).toHaveText('已取消')
    reply(pending!, true); pending = undefined
    const returned = await continuation
    const after = await page.evaluate(() => window.murasame.core.getBootstrap())
    if (!after.ok) throw new Error(after.error)
    const task = after.data.tasks.find(task => task.id === created.data.id)
    await page.screenshot({ path: test.info().outputPath('cancelled-after-late-plan.png') })
    expect(returned.ok).toBe(false)
    expect(task?.status).toBe('已取消'); expect(task?.title).toBe(created.data.title)
    await expect(page.locator('.task-detail-titleline .pill')).toHaveText('已取消')
    await expect(page.getByTestId('approve-task')).toHaveCount(0)
    expect(readdirSync(root)).toEqual([])
  } finally {
    pending?.destroy(); server.closeAllConnections()
    await closeApp(app)
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    await upstream.close(); rmSync(root, { recursive: true, force: true })
  }
})
