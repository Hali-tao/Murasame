import { expect, test } from '@playwright/test'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { IPC } from '../../src/shared/ipc'
import {
  closeApp,
  configureTestModel,
  findMainPage,
  launchApp,
  startModelServer,
  testUserData
} from './helpers'

const root = join(__dirname, '..', '..')
const electronBinary = process.env.MURASAME_E2E_EXECUTABLE || join(root, 'node_modules', 'electron', 'dist', 'electron.exe')

test('history clearing, memory editing and model switching are end-to-end usable', async () => {
  test.setTimeout(90_000)
  const server = await startModelServer()
  const app = await launchApp()
  try {
    const page = await findMainPage(app)
    await expect(page.getByTestId('nav-overview')).toBeVisible()

    await page.getByTestId('nav-chat').click()
    await page.getByLabel('新建会话', { exact: true }).click()
    await page.getByTestId('nav-history').click()
    await expect(page.getByTestId('history-item').first()).toBeVisible()
    const historyBefore = await page.getByTestId('history-item').count()
    await page.getByTestId('clear-history').click()
    await page.getByRole('dialog').getByRole('button', { name: '按范围清除' }).click()
    await expect.poll(() => page.getByTestId('history-item').count()).toBeLessThan(historyBefore)

    await page.getByTestId('nav-memory').click()
    await page.getByTestId('add-memory').click()
    const memoryDialog = page.getByRole('dialog')
    await memoryDialog.getByTestId('memory-category').fill('偏好')
    await memoryDialog.getByTestId('memory-text').fill('E2E 临时记忆')
    await memoryDialog.getByRole('button', { name: '添加记忆' }).click()

    const memoryCard = page.getByTestId('memory-card').filter({ hasText: 'E2E 临时记忆' })
    await expect(memoryCard).toBeVisible()
    await memoryCard.getByRole('button', { name: '编辑' }).click()
    await page.getByRole('dialog').getByTestId('memory-text').fill('E2E 记忆已编辑')
    await page.getByRole('dialog').getByRole('button', { name: '保存更正' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByTestId('memory-card').getByText('E2E 记忆已编辑', { exact: true })).toBeVisible()

    const editedCard = page.getByTestId('memory-card').filter({ hasText: 'E2E 记忆已编辑' })
    await editedCard.getByRole('button', { name: '删除' }).click()
    await page.getByRole('dialog').getByRole('button', { name: '删除记忆' }).click()
    await expect(page.getByText('E2E 记忆已编辑', { exact: true })).toHaveCount(0)

    // Progress values are controlled at the main-process event boundary. The
    // actual service indexing/cancellation is covered by the SQLite regressions.
    await app.evaluate(({ BrowserWindow }, channel) => {
      for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, { state: 'rebuilding', completed: 3, total: 10, message: '正在后台整理记忆，对话可以继续。' })
    }, IPC.core.memoryIndexStatus)
    await expect(page.getByRole('progressbar', { name: '记忆整理进度' })).toHaveAttribute('aria-valuenow', '3')
    await expect(page.getByText('正在后台整理记忆，对话可以继续。')).toBeVisible()
    await page.screenshot({ path: test.info().outputPath('memory-index-progress.png') })
    await app.evaluate(({ BrowserWindow }, channel) => {
      for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, { state: 'failed', completed: 3, total: 10, message: '整理暂时中断，已有内容仍保留。' })
    }, IPC.core.memoryIndexStatus)
    await expect(page.getByText('整理暂时中断', { exact: true })).toBeVisible()

    await configureTestModel(page, server.url, '本地 Qwen · 隐私模式')
  } finally {
    await closeApp(app)
    await server.close()
  }
})

test('a second launch exits and the existing instance remains available', async () => {
  const app = await launchApp()
  try {
    const page = await findMainPage(app)
    await expect(page.getByTestId('nav-overview')).toBeVisible()

    // 宿主环境可能带 ELECTRON_RUN_AS_NODE=1（例如 CI/代理工具）；带着它启动第二个
    // 实例会变成 Node 模式，退出码非 0，测不到真正的单实例行为。
    const secondEnv: NodeJS.ProcessEnv = { ...process.env, MURASAME_USER_DATA: testUserData(app) }
    delete secondEnv.ELECTRON_RUN_AS_NODE
    const second = spawn(electronBinary, process.env.MURASAME_E2E_EXECUTABLE ? [] : [root], {
      cwd: root,
      stdio: 'ignore',
      env: secondEnv
    })
    const exitCode = await Promise.race([
      new Promise<number | null>((resolve) => second.once('exit', (code) => resolve(code))),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 15_000))
    ])
    if (exitCode === 'timeout') second.kill()
    expect(exitCode).toBe(0)

    await expect.poll(async () => app.evaluate(({ BrowserWindow }) => {
      const main = BrowserWindow.getAllWindows().find((window) => window.getTitle().includes('AI 桌面伙伴'))
      return Boolean(main?.isVisible())
    })).toBeTruthy()
  } finally {
    await closeApp(app)
  }
})

test('the console hides to the tray and can be restored', async () => {
  const app = await launchApp()
  try {
    const page = await findMainPage(app)
    await page.getByTestId('hide-to-tray').click()
    await expect.poll(async () => app.evaluate(({ BrowserWindow }) => {
      const main = BrowserWindow.getAllWindows().find((window) => window.getTitle().includes('AI 桌面伙伴'))
      return main?.isVisible()
    })).toBeFalsy()

    await page.evaluate(async () => window.murasame.window.showMain())
    await expect.poll(async () => app.evaluate(({ BrowserWindow }) => {
      const main = BrowserWindow.getAllWindows().find((window) => window.getTitle().includes('AI 桌面伙伴'))
      return main?.isVisible()
    })).toBeTruthy()
  } finally {
    await closeApp(app)
  }
})
