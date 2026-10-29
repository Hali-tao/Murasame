import { expect, test, type Page } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeApp, configureTestModel, findMainPage, launchApp, startModelServer } from './helpers'

async function approveOnce(page: Page): Promise<void> {
  await page.getByTestId('approve-task').click()
  await page.getByRole('button', { name: '批准并继续', exact: true }).click()
}
for (const externalAddition of [false, true]) test(`[FR-17] 三步任务逐项批准${externalAddition ? '拦截外部新增文件' : '接受本任务新增文件并完成'}`, async () => {
  test.setTimeout(90_000)
  const root = mkdtempSync(join(tmpdir(), 'directory-checkpoint-ui-'))
  writeFileSync(join(root, 'input.txt'), 'synthetic source')
  const server = await startModelServer({ toolResponse: tool => tool === 'plan_task' ? {
    tool: 'filesystem', root, question: '', steps: [
      { id: 'inspect', title: '查看目录', detail: '读取原目录清单', expected: '', args: { action: 'list', path: '.' } },
      { id: 'a', dependsOn: ['inspect'], title: '创建第一份文件', detail: '创建a.txt', expected: '', args: { action: 'write', path: 'a.txt', content: 'first result' } },
      { id: 'b', dependsOn: ['a'], title: '创建第二份文件', detail: '创建b.txt', expected: '', args: { action: 'write', path: 'b.txt', content: 'second result' } }
    ]
  } : undefined })
  const app = await launchApp()
  try {
    const page = await findMainPage(app); await configureTestModel(page, server.url)
    const made = await page.evaluate(root => window.murasame.core.createTask('查看目录并创建两个文件', root), root)
    if (!made.ok) throw new Error(made.error)
    const task = async () => {
      const result = await page.evaluate(() => window.murasame.core.getBootstrap())
      if (!result.ok) throw new Error(result.error)
      return result.data.tasks.find(task => task.id === made.data.id)!
    }
    const workerCount = async () => (await task()).toolCalls.filter(call => call.agentRole === 'Worker' && (call.declared.args as { phase?: string }).phase === 'result').length
    await page.getByTestId('nav-tasks').click()
    for (let i = 0; i < 2; i++) {
      await approveOnce(page)
      await expect.poll(workerCount).toBe(i + 1)
      await expect(page.locator('.task-detail-titleline .pill')).toHaveText('等待批准')
    }
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('first result')
    if (externalAddition) writeFileSync(join(root, 'external.txt'), 'user-added synthetic file')
    await approveOnce(page)
    await expect.poll(async () => (await task()).status).toBe(externalAddition ? '失败' : '已完成')
    await expect(page.locator('.task-detail-titleline .pill')).toHaveText(externalAddition ? '失败' : '已完成')
    await page.screenshot({ path: test.info().outputPath(externalAddition ? 'external-change-blocked.png' : 'three-step-complete.png') })
    expect(await workerCount()).toBe(externalAddition ? 2 : 3)
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('first result')
    if (externalAddition) { expect(existsSync(join(root, 'b.txt'))).toBe(false); expect(readFileSync(join(root, 'external.txt'), 'utf8')).toBe('user-added synthetic file') }
    else expect(readFileSync(join(root, 'b.txt'), 'utf8')).toBe('second result')
  } finally { await closeApp(app); await server.close(); rmSync(root, { recursive: true, force: true }) }
})
