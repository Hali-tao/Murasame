# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: task-directory-checkpoints.spec.ts >> [FR-17] 三步任务逐项批准接受本任务新增文件并完成
- Location: tests\e2e\task-directory-checkpoints.spec.ts:11:51

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: "已完成"
Received: "失败"

Call Log:
- Timeout 5000ms exceeded while waiting on the predicate
```

# Test source

```ts
  1  | import { expect, test, type Page } from '@playwright/test'
  2  | import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
  3  | import { tmpdir } from 'node:os'
  4  | import { join } from 'node:path'
  5  | import { closeApp, configureTestModel, findMainPage, launchApp, startModelServer } from './helpers'
  6  |
  7  | async function approveOnce(page: Page): Promise<void> {
  8  |   await page.getByTestId('approve-task').click()
  9  |   await page.getByRole('button', { name: '批准并继续', exact: true }).click()
  10 | }
  11 | for (const externalAddition of [false, true]) test(`[FR-17] 三步任务逐项批准${externalAddition ? '拦截外部新增文件' : '接受本任务新增文件并完成'}`, async () => {
  12 |   test.setTimeout(90_000)
  13 |   const root = mkdtempSync(join(tmpdir(), 'directory-checkpoint-ui-'))
  14 |   writeFileSync(join(root, 'input.txt'), 'synthetic source')
  15 |   const server = await startModelServer({ toolResponse: tool => tool === 'plan_task' ? {
  16 |     tool: 'filesystem', root, question: '', steps: [
  17 |       { id: 'inspect', title: '查看目录', detail: '读取原目录清单', expected: '', args: { action: 'list', path: '.' } },
  18 |       { id: 'a', dependsOn: ['inspect'], title: '创建第一份文件', detail: '创建a.txt', expected: '', args: { action: 'write', path: 'a.txt', content: 'first result' } },
  19 |       { id: 'b', dependsOn: ['a'], title: '创建第二份文件', detail: '创建b.txt', expected: '', args: { action: 'write', path: 'b.txt', content: 'second result' } }
  20 |     ]
  21 |   } : undefined })
  22 |   const app = await launchApp()
  23 |   try {
  24 |     const page = await findMainPage(app); await configureTestModel(page, server.url)
  25 |     const made = await page.evaluate(root => window.murasame.core.createTask('查看目录并创建两个文件', root), root)
  26 |     if (!made.ok) throw new Error(made.error)
  27 |     const task = async () => {
  28 |       const result = await page.evaluate(() => window.murasame.core.getBootstrap())
  29 |       if (!result.ok) throw new Error(result.error)
  30 |       return result.data.tasks.find(task => task.id === made.data.id)!
  31 |     }
  32 |     const workerCount = async () => (await task()).toolCalls.filter(call => call.agentRole === 'Worker' && (call.declared.args as { phase?: string }).phase === 'result').length
  33 |     await page.getByTestId('nav-tasks').click()
  34 |     for (let i = 0; i < 2; i++) {
  35 |       await approveOnce(page)
  36 |       await expect.poll(workerCount).toBe(i + 1)
  37 |       await expect(page.locator('.task-detail-titleline .pill')).toHaveText('等待批准')
  38 |     }
  39 |     expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('first result')
  40 |     if (externalAddition) writeFileSync(join(root, 'external.txt'), 'user-added synthetic file')
  41 |     await approveOnce(page)
> 42 |     await expect.poll(async () => (await task()).status).toBe(externalAddition ? '失败' : '已完成')
     |                                                          ^ Error: expect(received).toBe(expected) // Object.is equality
  43 |     await expect(page.locator('.task-detail-titleline .pill')).toHaveText(externalAddition ? '失败' : '已完成')
  44 |     await page.screenshot({ path: test.info().outputPath(externalAddition ? 'external-change-blocked.png' : 'three-step-complete.png') })
  45 |     expect(await workerCount()).toBe(externalAddition ? 2 : 3)
  46 |     expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('first result')
  47 |     if (externalAddition) { expect(existsSync(join(root, 'b.txt'))).toBe(false); expect(readFileSync(join(root, 'external.txt'), 'utf8')).toBe('user-added synthetic file') }
  48 |     else expect(readFileSync(join(root, 'b.txt'), 'utf8')).toBe('second result')
  49 |   } finally { await closeApp(app); await server.close(); rmSync(root, { recursive: true, force: true }) }
  50 | })
  51 |
```
