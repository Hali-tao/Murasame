import { expect, test, type Page } from '@playwright/test'
import { createServer, type ServerResponse } from 'node:http'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { closeApp, configureTestModel, findMainPage, findPetPage, launchApp } from './helpers'
import { listenHttp } from '../helpers/http-server'

async function summaryServer(root: string) {
  const received: string[] = []; const pending: Array<() => void> = []; let slow = false
  const respond = (response: ServerResponse, tool: string | undefined, value: unknown): void => {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: tool ? { role: 'assistant', tool_calls: [{ type: 'function', function: { name: tool, arguments: JSON.stringify(value) } }] } : { role: 'assistant', content: '聊天仍可响应。' } }] }))
  }
  const server = createServer((request, response) => {
    let raw = ''; request.setEncoding('utf8'); request.on('data', chunk => { raw += chunk })
    request.on('end', () => {
      const payload = JSON.parse(raw) as { messages: Array<{ role: string; content: string }>; tools?: Array<{ function: { name: string } }> }
      const tool = payload.tools?.[0]?.function.name
      if (tool === 'plan_task') {
        const goal = payload.messages.filter(message => message.role === 'user').at(-1)?.content ?? ''
        const outputPath = goal.includes('cancel.md') ? 'cancel.md' : goal.includes('hidden.md') ? 'hidden.md' : 'summary.md'
        respond(response, tool, { tool: 'filesystem', root, steps: [], question: '', workflow: { kind: 'summarize-files', sources: ['source.md'], instruction: '概括已确认预算，保留不确定事项', outputPath } }); return
      }
      if (tool === 'grounded_summary') {
        received.push(raw)
        const input = JSON.parse(payload.messages.filter(message => message.role === 'user').at(-1)!.content) as { sources: Array<{ sourceId: string; lines: Array<{ line: number; text: string }> }> }
        const first = input.sources[0]
        const reply = (): void => respond(response, tool, { title: '真实来源摘要', sections: [{ text: '资料记录预算已经确认。', citations: [{ sourceId: first.sourceId, fromLine: first.lines[0].line, toLine: first.lines[0].line, quote: first.lines[0].text }] }], limitations: ['日期仍需确认。'] })
        if (slow) pending.push(reply); else reply()
        return
      }
      if (tool === 'performance') { respond(response, tool, { intent: '思考', relevance: 0.3, consequence: 0, coping: 0.3, norm: 0 }); return }
      if (tool === 'remember') { respond(response, tool, { memories: [] }); return }
      respond(response, undefined, null)
    })
  })
  await listenHttp(server)
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('fixture server failed')
  return { url: `http://127.0.0.1:${address.port}/v1`, received, setSlow: (value: boolean) => { slow = value }, release: () => pending.splice(0).forEach(reply => reply()), close: () => new Promise<void>((resolve, reject) => { server.closeAllConnections(); server.close(error => error ? reject(error) : resolve()) }) }
}
async function createSummary(page: Page, root: string, output: string) {
  await page.getByTestId('nav-tasks').click(); await page.getByTestId('new-task').click()
  await page.getByTestId('task-title-input').fill(`请总结 "${root}" 内 source.md，保存到 ${output}`)
  await page.getByRole('button', { name: '创建并开始', exact: true }).click()
  await expect(page.getByTestId('task-title-input')).toHaveCount(0)
  await expect(page.locator('.task-detail-titleline .pill')).toHaveText('等待批准')
}
async function approveStage(page: Page) {
  await page.getByTestId('approve-task').click()
  await page.getByRole('dialog').getByRole('button', { name: '批准并继续' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

test('real source is sent only after A; reviewed exact draft is saved only after B', async () => {
  const info = test.info()
  test.setTimeout(90000)
  const root = info.outputPath('source-data'); mkdirSync(root, { recursive: true })
  const sentinel = `实际读取标记-${randomUUID()}`; writeFileSync(join(root, 'source.md'), `确认预算十万元。\n${sentinel}\n日期待定。`)
  const server = await summaryServer(root); const app = await launchApp()
  try {
    const page = await findMainPage(app); await configureTestModel(page, server.url, '摘要验收模型')
    await createSummary(page, root, 'summary.md')
    expect(server.received).toHaveLength(0); expect(existsSync(join(root, 'summary.md'))).toBe(false)
    await page.getByTestId('approve-task').click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('table', { name: /来源文件/ })).toContainText('source.md')
    await expect(dialog.getByText(server.url, { exact: true })).toBeVisible()
    await dialog.getByRole('combobox').selectOption('task')
    await dialog.screenshot({ path: info.outputPath('summary-source-approval.png') })
    await dialog.getByRole('button', { name: '批准并继续' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.locator('.result-card')).toContainText('草稿已生成', { timeout: 15000 })
    expect(server.received).toHaveLength(1); expect(server.received[0]).toContain(sentinel)
    expect(server.received[0]).not.toContain(root.replaceAll('\\', '\\\\'))
    expect(existsSync(join(root, 'summary.md'))).toBe(false)
    const pet = await findPetPage(app)
    await expect(pet.getByRole('button', { name: '审阅草稿', exact: true })).toBeVisible()
    await expect(pet.getByRole('button', { name: '允许', exact: true })).toHaveCount(0)
    await pet.getByRole('button', { name: '审阅草稿', exact: true }).click()
    expect(existsSync(join(root, 'summary.md'))).toBe(false)
    await page.getByTestId('approve-task').click()
    await expect(dialog.getByRole('combobox')).toHaveValue('once')
    const markdown = await dialog.getByLabel('将保存的完整摘要').textContent()
    expect(markdown).toContain('确认预算十万元。'); expect(markdown).toContain('source.md')
    await dialog.getByText('Markdown 预览', { exact: true }).click()
    const preview = dialog.getByRole('region', { name: '摘要 Markdown 预览' })
    await expect(preview.getByRole('heading', { name: '真实来源摘要', exact: true })).toBeVisible()
    await expect(dialog.getByLabel('将保存的完整摘要')).toHaveText(markdown!)
    expect(existsSync(join(root, 'summary.md'))).toBe(false)
    expect(server.received).toHaveLength(1)
    await dialog.screenshot({ path: info.outputPath('summary-draft-approval.png') })
    await dialog.getByRole('button', { name: '批准并继续' }).click()
    await expect(page.locator('.task-detail-titleline .pill')).toHaveText('已完成')
    expect(readFileSync(join(root, 'summary.md'), 'utf8')).toBe(markdown)
    const hash = createHash('sha256').update(readFileSync(join(root, 'summary.md'))).digest('hex')
    await expect(page.locator('.artifact-row button')).toHaveText(join(root, 'summary.md'))
    // Keep the test's Explorer window from interrupting the user's desktop; verify the real UI→IPC→file-owner/existence checks up to the OS reveal boundary.
    await app.evaluate(({ shell }) => { shell.showItemInFolder = path => { (globalThis as typeof globalThis & { summaryRevealed?: string }).summaryRevealed = path } })
    await page.locator('.artifact-row button').click()
    await expect.poll(() => app.evaluate(() => (globalThis as typeof globalThis & { summaryRevealed?: string }).summaryRevealed)).toBe(join(root, 'summary.md'))
    writeFileSync(info.outputPath('summary-verification.json'), JSON.stringify({ modelRequests: server.received.length, sha256: hash, actualSourceRead: server.received[0].includes(sentinel), reviewedBytesMatch: true, artifactRevealReachedOsBoundary: true }, null, 2))
    await page.screenshot({ path: info.outputPath('summary-verified.png'), fullPage: true })
  } finally { await closeApp(app); await server.close() }
})

test('a slow real summary permits chat, survives hiding, and cancellation discards late output', async () => {
  const info = test.info()
  test.setTimeout(120000)
  const root = info.outputPath('source-data'); mkdirSync(root, { recursive: true }); writeFileSync(join(root, 'source.md'), '确认预算十万元。\n慢任务资料。')
  const server = await summaryServer(root); server.setSlow(true); const app = await launchApp()
  try {
    const page = await findMainPage(app); await configureTestModel(page, server.url)
    await createSummary(page, root, 'hidden.md'); await approveStage(page)
    await expect.poll(() => server.received.length).toBe(1)
    await page.getByTestId('nav-chat').click(); await page.getByLabel('新建会话', { exact: true }).click()
    await page.getByTestId('chat-input').fill('你好，今天心情不错。'); await page.getByTestId('chat-send').click()
    await expect(page.getByText('聊天仍可响应。', { exact: false }).last()).toBeVisible({ timeout: 10000 })
    await page.getByTestId('hide-to-tray').click(); server.release()
    await page.evaluate(() => window.murasame.window.showMain())
    await page.getByTestId('nav-tasks').click()
    await expect(page.locator('.result-card')).toContainText('草稿已生成')
    expect(existsSync(join(root, 'hidden.md'))).toBe(false)
    await approveStage(page); await expect(page.locator('.task-detail-titleline .pill')).toHaveText('已完成')
    expect(readFileSync(join(root, 'hidden.md'), 'utf8')).toContain('确认预算十万元。')
    await createSummary(page, root, 'cancel.md'); await approveStage(page)
    await expect.poll(() => server.received.length).toBe(2)
    await page.getByTestId('cancel-task').click()
    await page.getByRole('dialog').getByRole('button', { name: /取消|停止/ }).last().click()
    await expect(page.locator('.task-detail-titleline .pill')).toHaveText('已取消')
    server.release()
    await expect(page.getByTestId('approve-task')).toHaveCount(0)
    expect(existsSync(join(root, 'cancel.md'))).toBe(false)
  } finally { server.release(); await closeApp(app); await server.close() }
})
