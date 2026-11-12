import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { closeApp, configureTestModel, findMainPage, launchApp, startModelServer } from './helpers'
import { startControlledModelServer } from './qa-helpers'

test('[QA-E2E-06] 任务创建→取消→再创建循环 3 轮：状态一致、不重复执行、文件不被移动', async () => {
  test.setTimeout(240_000)
  const root = mkdtempSync(join(tmpdir(), 'qa-task-loop-'))
  writeFileSync(join(root, 'example.txt'), 'qa task loop file')
  const server = await startModelServer({ taskRoot: root })
  const app = await launchApp()
  try {
    const page = await findMainPage(app)
    await configureTestModel(page, server.url)
    await page.getByTestId('nav-tasks').click()
    const title = `整理文件夹 ${root}`
    const pill = page.locator('.task-detail-titleline .pill')

    for (let round = 0; round < 3; round += 1) {
      await page.getByTestId('new-task').click()
      await page.getByTestId('task-title-input').fill(title)
      await page.getByRole('button', { name: '创建并开始', exact: true }).click()
      await expect(page.getByTestId('task-item')).toHaveCount(round + 1)
      await expect(pill).toHaveText(/等待批准|待确认/, { timeout: 20_000 })
      await expect(page.getByTestId('cancel-task')).toBeEnabled()
      await page.getByTestId('cancel-task').click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      await dialog.getByRole('button', { name: '取消任务', exact: true }).click()
      await expect(pill).toHaveText('已取消', { timeout: 20_000 })
      await expect(page.getByRole('dialog')).toHaveCount(0)
    }

    const state = await page.evaluate(() => window.murasame.core.getBootstrap())
    if (!state.ok) throw new Error(state.error)
    expect(state.data.tasks).toHaveLength(3)
    expect(new Set(state.data.tasks.map((task) => task.id)).size).toBe(3)
    expect(state.data.tasks.every((task) => task.status === '已取消')).toBe(true)
    await expect(page.getByTestId('task-item')).toHaveCount(3)
    // 取消的 3 个任务都没有真正执行：源文件还在原位、内容不变。
    expect(readdirSync(root)).toEqual(['example.txt'])
    expect(readFileSync(join(root, 'example.txt'), 'utf8')).toBe('qa task loop file')
    await expect(page.locator('.toast-red')).toHaveCount(0)
    await page.screenshot({ path: test.info().outputPath('task-create-cancel-loop.png') })
  } finally {
    await closeApp(app)
    await server.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('[QA-E2E-07] 审批对话框三连点「批准并继续」只执行一次且不刷错误提示', async () => {
  test.setTimeout(240_000)
  const root = mkdtempSync(join(tmpdir(), 'qa-task-approve-'))
  writeFileSync(join(root, 'example.txt'), 'e2e real file')
  const server = await startModelServer({ taskRoot: root })
  const app = await launchApp()
  try {
    const page = await findMainPage(app)
    await configureTestModel(page, server.url)
    await page.getByTestId('nav-tasks').click()
    await page.getByTestId('new-task').click()
    await page.getByTestId('task-title-input').fill(`整理文件夹 ${root}`)
    await page.getByRole('button', { name: '创建并开始', exact: true }).click()
    await expect(page.locator('.task-detail-titleline .pill')).toHaveText('等待批准', { timeout: 20_000 })
    await page.getByTestId('approve-task').click()
    await expect(page.getByRole('dialog')).toBeVisible()

    // 同一帧内连点三次「批准并继续」，模拟用户手抖双击/三击。
    const approveButton = page.getByRole('dialog').getByRole('button', { name: '批准并继续', exact: true })
    await approveButton.evaluate((element) => {
      const button = element as HTMLButtonElement
      button.click()
      button.click()
      button.click()
    })

    await expect(page.locator('.task-detail-titleline .pill')).toHaveText('已完成', { timeout: 40_000 })
    // 只执行一次：文件只被移动一次，内容没有被重复操作破坏。
    expect(existsSync(join(root, 'example.txt'))).toBe(false)
    expect(existsSync(join(root, '文档', 'example.txt'))).toBe(true)
    expect(readFileSync(join(root, '文档', 'example.txt'), 'utf8')).toBe('e2e real file')
    const state = await page.evaluate(() => window.murasame.core.getBootstrap())
    if (!state.ok) throw new Error(state.error)
    const task = state.data.tasks[0]
    expect(state.data.tasks).toHaveLength(1)
    expect(task.status).toBe('已完成')
    expect(task.artifacts).toHaveLength(1)
    const approvalCalls = task.toolCalls.filter((call) => call.toolId === 'approval')
    expect(approvalCalls).toHaveLength(1)
    // 连点不应产生「当前没有待批准的操作」这类红字提示。
    const redToasts = await page.locator('.toast-red').allInnerTexts()
    test.info().annotations.push({ type: 'approval-triple-click-toasts', description: JSON.stringify(redToasts) })
    await expect(page.locator('.toast-red'), `连点批准后不应出现错误提示，实际：${JSON.stringify(redToasts)}`).toHaveCount(0)
    await page.screenshot({ path: test.info().outputPath('approval-triple-click.png') })
  } finally {
    await closeApp(app)
    await server.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('[QA-E2E-08] 清除全部记忆与进行中的对话并发：回复完整、记忆清空且不崩溃', async () => {
  test.setTimeout(180_000)
  const server = await startControlledModelServer()
  const app = await launchApp()
  try {
    const page = await findMainPage(app)
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await configureTestModel(page, server.url)
    await page.evaluate(async () => {
      for (let index = 0; index < 3; index += 1) {
        const result = await window.murasame.core.addMemory('偏好', `QA 并发记忆 ${index}`)
        if (!result.ok) throw new Error(result.error)
      }
    })
    await page.getByTestId('nav-memory').click()
    await expect(page.getByTestId('memory-card')).toHaveCount(3)

    await page.getByTestId('nav-chat').click()
    await page.getByLabel('新建会话', { exact: true }).click()
    const marker = 'QA-STREAM-MEMORY-CLEAR'
    await page.getByTestId('chat-input').fill(marker)
    await page.getByTestId('chat-send').click()
    await server.waitHeld(marker)
    server.writeChunk(marker, '记忆清除前已经收到内容，')

    // 对话仍在流式进行中，切到记忆页清空全部记忆。
    await page.getByTestId('nav-memory').click()
    await page.getByRole('button', { name: '清空…', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: '清空全部记忆', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByTestId('memory-card')).toHaveCount(0, { timeout: 10_000 })

    // 释放流式回复：对话要拿到完整内容，应用不崩溃。
    await server.finishStream(marker, ['记忆清除后仍然完整收到回复。'])
    await page.getByTestId('nav-chat').click()
    const fullReply = '记忆清除前已经收到内容，记忆清除后仍然完整收到回复。'
    await expect(page.locator('.message-row.assistant').filter({ hasText: fullReply })).toHaveCount(1, { timeout: 20_000 })

    const state = await page.evaluate(() => window.murasame.core.getBootstrap())
    if (!state.ok) throw new Error(state.error)
    expect(state.data.memories).toEqual([])
    const conversation = state.data.conversations.find((item) => item.messages.some((message) => message.text === marker))
    expect(conversation).toBeTruthy()
    expect(conversation!.messages.filter((message) => message.role === 'user').map((message) => message.text)).toEqual([marker])
    expect(conversation!.messages.filter((message) => message.role === 'assistant').at(-1)?.text).toContain(fullReply)
    // 清空后不会被进行中的提取重新写回未确认内容。
    await page.waitForTimeout(1_500)
    const after = await page.evaluate(() => window.murasame.core.getBootstrap())
    if (!after.ok) throw new Error(after.error)
    expect(after.data.memories).toEqual([])
    await expect(page.locator('.toast-red')).toHaveCount(0)
    expect(pageErrors).toEqual([])
    await page.screenshot({ path: test.info().outputPath('clear-memory-during-stream.png') })
  } finally {
    await closeApp(app)
    await server.close()
  }
})

test('[QA-E2E-09] 记忆列表快速增删改 5 条：前端列表与持久化状态一致', async () => {
  test.setTimeout(180_000)
  const app = await launchApp()
  try {
    const page = await findMainPage(app)
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.getByTestId('nav-memory').click()

    for (let index = 0; index < 5; index += 1) {
      await page.getByTestId('add-memory').click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      await dialog.getByTestId('memory-category').fill('偏好')
      await dialog.getByTestId('memory-text').fill(`QA 快速记忆 ${index}`)
      await dialog.getByRole('button', { name: '添加记忆', exact: true }).click()
      await expect(page.getByRole('dialog')).toHaveCount(0)
    }
    await expect(page.getByTestId('memory-card')).toHaveCount(5)

    // 同一条记忆连续修订 3 次，不应出现重复卡片。
    const edited = page.getByTestId('memory-card').filter({ hasText: 'QA 快速记忆 4' })
    for (let round = 1; round <= 3; round += 1) {
      await edited.getByRole('button', { name: '编辑' }).click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      await dialog.getByTestId('memory-text').fill(`QA 快速记忆 4 · 第 ${round} 次修订`)
      await dialog.getByRole('button', { name: '保存更正', exact: true }).click()
      await expect(page.getByRole('dialog')).toHaveCount(0)
    }
    await expect(page.getByTestId('memory-card')).toHaveCount(5)
    await expect(page.getByTestId('memory-card').filter({ hasText: '第 3 次修订' })).toHaveCount(1)

    // 连续删除 3 条，剩余列表和持久化数据一致。
    for (let index = 0; index < 3; index += 1) {
      const card = page.getByTestId('memory-card').filter({ hasText: `QA 快速记忆 ${index}` })
      await card.getByRole('button', { name: '删除' }).click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      await dialog.getByRole('button', { name: '删除记忆', exact: true }).click()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(page.getByTestId('memory-card').filter({ hasText: `QA 快速记忆 ${index}` })).toHaveCount(0)
    }
    await expect(page.getByTestId('memory-card')).toHaveCount(2)

    const state = await page.evaluate(() => window.murasame.core.getBootstrap())
    if (!state.ok) throw new Error(state.error)
    expect(state.data.memories).toHaveLength(2)
    expect(new Set(state.data.memories.map((memory) => memory.text))).toEqual(new Set([
      'QA 快速记忆 3',
      'QA 快速记忆 4 · 第 3 次修订'
    ]))
    const cards = await page.getByTestId('memory-card').allInnerTexts()
    expect(cards.some((text) => text.includes('QA 快速记忆 3'))).toBe(true)
    expect(cards.some((text) => text.includes('第 3 次修订'))).toBe(true)
    await expect(page.locator('.toast-red')).toHaveCount(0)
    expect(pageErrors).toEqual([])
    await page.screenshot({ path: test.info().outputPath('memory-rapid-crud.png') })
  } finally {
    await closeApp(app)
  }
})
