import { expect, test, type ElectronApplication } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeApp, configureTestModel, findMainPage, launchApp, startModelServer } from './helpers'

async function selectDirectory(app: ElectronApplication, path: string | null): Promise<void> {
  // Only replace the final OS dialog; renderer, preload, IPC and directory checks stay real.
  await app.evaluate(({ dialog }, selected) => {
    dialog.showOpenDialog = (async (...args: unknown[]) => {
      const options = args.at(-1) as { properties: string[] }
      if (!options.properties.includes('openDirectory')) throw new Error('Must request a directory')
      return { canceled: selected === null, filePaths: selected ? [selected] : [] }
    }) as typeof dialog.showOpenDialog
  }, path)
}

test('[FR-16] 新任务选择目录经真实 IPC 审批后整理文件，取消选择保留先前范围', async () => {
  test.setTimeout(90_000)
  const root = mkdtempSync(join(tmpdir(), 'directory-ui-'))
  writeFileSync(join(root, 'example.txt'), 'e2e real file')
  const server = await startModelServer({ taskRoot: root })
  const app = await launchApp()
  try {
    const page = await findMainPage(app)
    await configureTestModel(page, server.url)
    await page.getByTestId('nav-tasks').click()
    await page.getByTestId('new-task').click()
    await page.getByTestId('task-title-input').fill('按类型整理资料')
    await selectDirectory(app, null)
    await page.getByTestId('pick-task-directory').click()
    await expect(page.getByLabel('已选择的工作目录')).toHaveValue('')
    await expect(page.getByTestId('task-item')).toHaveCount(0)
    await selectDirectory(app, root)
    await page.getByTestId('pick-task-directory').click()
    await expect(page.getByLabel('已选择的工作目录')).toHaveValue(root)
    await selectDirectory(app, null)
    await page.getByTestId('pick-task-directory').click()
    await expect(page.getByLabel('已选择的工作目录')).toHaveValue(root)
    await page.screenshot({ path: test.info().outputPath('chosen-directory.png') })
    await page.getByRole('button', { name: '创建并开始' }).click()
    await expect(page.getByTestId('task-item')).toHaveCount(1)
    await expect(page.locator('.task-meta-grid')).toContainText(root)
    await expect(page.getByTestId('approve-task')).toBeVisible()
    expect(existsSync(join(root, 'example.txt'))).toBe(true)
    expect(existsSync(join(root, '文档/example.txt'))).toBe(false)
    await page.getByTestId('approve-task').click()
    await expect(page.getByRole('dialog')).toContainText(root)
    await page.getByRole('button', { name: '批准并继续' }).click()
    await expect(page.locator('.task-detail-titleline .pill')).toHaveText('已完成', { timeout: 20_000 })
    expect(readFileSync(join(root, '文档/example.txt'), 'utf8')).toBe('e2e real file')
    await page.screenshot({ path: test.info().outputPath('directory-task-complete.png') })
  } finally { await closeApp(app); await server.close(); rmSync(root, { recursive: true, force: true }) }
})

test('[FR-18] 模型建议目录保持待确认，实际选择后才进入敏感操作审批', async () => {
  test.setTimeout(90_000)
  const root = mkdtempSync(join(tmpdir(), 'directory-confirm-'))
  writeFileSync(join(root, 'example.txt'), 'e2e real file')
  const server = await startModelServer({ taskRoot: root })
  const app = await launchApp()
  try {
    const page = await findMainPage(app)
    await configureTestModel(page, server.url)
    await page.getByTestId('nav-tasks').click()
    await page.getByTestId('new-task').click()
    await page.getByTestId('task-title-input').fill('按类型整理下载文件夹')
    await page.getByRole('button', { name: '创建并开始' }).click()
    await expect(page.locator('.task-detail-titleline .pill')).toHaveText('待确认')
    await expect(page.getByTestId('approve-task')).toHaveCount(0)
    await selectDirectory(app, null)
    await page.getByTestId('pick-continue-directory').click()
    await expect(page.getByTestId('pick-continue-directory')).toBeEnabled()
    await expect(page.locator('.task-detail-titleline .pill')).toHaveText('待确认')
    await selectDirectory(app, root)
    await page.getByTestId('pick-continue-directory').click()
    await expect(page.getByTestId('approve-task')).toBeVisible()
    await expect(page.locator('.task-meta-grid')).toContainText(root)
    expect(existsSync(join(root, '文档/example.txt'))).toBe(false)
    await page.getByTestId('approve-task').click()
    await page.getByRole('button', { name: '批准并继续' }).click()
    await expect(page.locator('.task-detail-titleline .pill')).toHaveText('已完成', { timeout: 20_000 })
    expect(readFileSync(join(root, '文档/example.txt'), 'utf8')).toBe('e2e real file')
    await expect(page.getByTestId('task-item')).toHaveCount(1)
  } finally { await closeApp(app); await server.close(); rmSync(root, { recursive: true, force: true }) }
})
