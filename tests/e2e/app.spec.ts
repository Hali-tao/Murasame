import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { closeApp, configureTestModel, findMainPage, findPetPage, launchApp, startModelServer } from './helpers'

test('first launch leads through model verification to a real first conversation', async () => {
  test.setTimeout(90_000)
  const server = await startModelServer()
  const app = await launchApp(false)
  try {
    const page = await findMainPage(app, true)
    for (let step = 0; step < 3; step++) await page.getByRole('button', { name: '下一步', exact: true }).click()
    await page.getByRole('button', { name: '配置模型并开始聊天', exact: true }).click()
    await expect(page).toHaveURL(/models\?setup=1/)
    await configureTestModel(page, server.url)
    await page.getByRole('button', { name: '开始第一次对话', exact: true }).click()
    await page.getByTestId('chat-input').fill('你好，请先自我介绍')
    await page.getByTestId('chat-send').click()
    await expect(page.getByText('这是来自测试模型的真实流式回复。', { exact: false }).last()).toBeVisible()
    const settings = await page.evaluate(() => window.murasame.settings.get())
    expect(settings.permissions.screen).toBe(false)
    expect(settings.permissions.microphone).toBe(false)
  } finally { await closeApp(app); await server.close() }
})

test('console starts and all ten pages are reachable', async () => {
  test.setTimeout(90_000)
  const testInfo = test.info()
  const input = testInfo.outputPath('organize-input')
  const server = await startModelServer({ taskRoot: input })
  const app = await launchApp()
  try {
    const page = await findMainPage(app)
    await expect(page.getByTestId('nav-overview')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('01-overview.png'), fullPage: true })

  const pages = [
    ['nav-overview', '概览'],
    ['nav-chat', '交流'],
    ['nav-screen', '屏幕辅助'],
    ['nav-tasks', '任务'],
    ['nav-history', '历史'],
    ['nav-memory', '长期记忆'],
    ['nav-tools', '工具与插件'],
    ['nav-models', '模型服务'],
    ['nav-character', '角色设置'],
    ['nav-settings', '运行与隐私']
  ]

  for (const [testId, title] of pages) {
    await page.getByTestId(testId).click()
    await expect(page.locator('.topbar h1')).toHaveText(title)
  }

    await configureTestModel(page, server.url)
    await page.getByTestId('nav-chat').click()
    await page.getByLabel('新建会话', { exact: true }).click()
    await page.getByTestId('chat-input').fill('请帮我分析编码错误')
    await page.getByTestId('chat-send').click()
    await expect(page.getByText('这是来自测试模型的真实流式回复。', { exact: false }).last()).toBeVisible({ timeout: 10_000 })

    await page.getByTestId('nav-tasks').click()
    mkdirSync(input, { recursive: true })
    writeFileSync(join(input, 'example.txt'), 'e2e real file')
    await page.getByTestId('new-task').click()
    await page.getByTestId('task-title-input').fill(`整理文件夹 "${input}"`)
    await page.getByRole('button', { name: '创建并开始', exact: true }).click()
    await expect(page.getByTestId('task-item')).toHaveCount(1)
    await page.getByTestId('approve-task').click()
    const approvalDialog = page.getByRole('dialog')
    await expect(approvalDialog.getByTestId('approval-details')).toBeVisible()
    await expect(approvalDialog.getByRole('table')).toContainText('example.txt')
    await expect(approvalDialog.getByRole('table')).toContainText('文档')
    await approvalDialog.getByRole('combobox').selectOption('task')
    await approvalDialog.getByRole('button', { name: '拒绝', exact: true }).click()
    await expect(page.locator('.task-detail-titleline .pill')).toHaveText('待确认')
    expect(readFileSync(join(input, 'example.txt'), 'utf8')).toBe('e2e real file')
    await page.getByTestId('resume-task').click()
    await expect(page.locator('.task-detail-titleline .pill')).toHaveText('等待批准')
    await page.getByTestId('approve-task').click()
    await expect(approvalDialog.getByRole('combobox')).toHaveValue('once')
    await approvalDialog.screenshot({ path: testInfo.outputPath('task-readable-approval.png'), animations: 'disabled' })
    await page.getByRole('button', { name: '批准并继续' }).click()
    await expect(page.locator('.task-detail-titleline .pill')).toHaveText('已完成', { timeout: 15000 })
    expect(readFileSync(join(input, '文档', 'example.txt'), 'utf8')).toBe('e2e real file')
    await page.getByRole('combobox', { name: '筛选任务' }).selectOption('已中断')
    await expect(page.getByText('这个分类里还没有任务', { exact: true })).toBeVisible()
    await expect(page.locator('.task-detail-card .task-actions')).toHaveCount(0)
    await page.getByRole('combobox', { name: '筛选任务' }).selectOption('全部任务')

    await page.screenshot({ path: testInfo.outputPath('02-tasks.png'), fullPage: true })
  } finally {
    await closeApp(app)
    await server.close()
  }
})

test('pet window is created and can be hidden or restored through IPC', async () => {
  const testInfo = test.info()
  const app = await launchApp()
  try {
    const page = await findMainPage(app)
    await expect(page.getByTestId('nav-overview')).toBeVisible()
    const petPage = await findPetPage(app)
    const pageErrors: string[] = []
    petPage.on('pageerror', (error) => pageErrors.push(error.message))

    await expect.poll(async () => app.evaluate(async ({ BrowserWindow }) => {
      const windows = BrowserWindow.getAllWindows()
      return windows.some((window) => window.getTitle() === 'Murasame Pet')
    })).toBeTruthy()

    await expect(petPage.locator('.live2d-pet-host[data-live2d-state="ready"]')).toBeVisible({ timeout: 20_000 })
    await petPage.evaluate(() => {
      document.body.style.background = '#e8e2d9'
    })
    await petPage.screenshot({ path: testInfo.outputPath('03-pet-live2d.png') })
    await petPage.evaluate(() => {
      document.body.style.background = 'transparent'
    })
    await petPage.locator('.pet-character').focus()
    await petPage.locator('.pet-character').press('Enter')
    await expect(petPage.getByTestId('pet-chat')).toBeVisible()
    await expect(petPage.getByRole('textbox', { name: '对桌宠说' })).toBeVisible()
    expect(pageErrors).toEqual([])
    await page.getByRole('button', { name: '隐藏桌宠' }).click()
    await expect.poll(async () => app.evaluate(async ({ BrowserWindow }) => {
      const pet = BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'Murasame Pet')
      return pet?.isVisible()
    })).toBeFalsy()

    await page.getByRole('button', { name: '显示桌宠' }).click()
    await expect.poll(async () => app.evaluate(async ({ BrowserWindow }) => {
      const pet = BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'Murasame Pet')
      return pet?.isVisible()
    })).toBeTruthy()

    await page.evaluate(async () => window.murasame.pet.setScale(0.9))
    const scaleLabel = petPage.locator('.pet-controls span')
    await expect(scaleLabel).toHaveText('90%')
    const enlarge = petPage.getByRole('button', { name: '放大桌宠' })
    await enlarge.focus()
    await expect(petPage.locator('.pet-controls')).toHaveCSS('opacity', '1')
    await enlarge.press('Enter')
    await expect(scaleLabel).toHaveText('100%')
    await page.evaluate(async () => window.murasame.pet.setScale(1.4))
    await expect(scaleLabel).toHaveText('140%')
    const fit = await petPage.evaluate(() => {
      const character = document.querySelector('.pet-character')!.getBoundingClientRect()
      return character.left >= 0 && character.top >= 0 && character.right <= innerWidth && character.bottom <= innerHeight
    })
    expect(fit).toBe(true)
    await petPage.screenshot({ path: testInfo.outputPath('pet-140-percent.png') })
  } finally {
    await closeApp(app)
  }
})

test('character page switches between the four bundled pet presets', async () => {
  const testInfo = test.info()
  const app = await launchApp()
  try {
    const page = await findMainPage(app)
    const petPage = await findPetPage(app)
    await page.getByTestId('nav-character').click()
    await page.screenshot({ path: testInfo.outputPath('character-presets.png'), fullPage: true })

    for (const id of ['whale-girl', 'naiwa', 'nailong', 'tororo']) {
      await page.getByTestId(`pet-preset-${id}`).click()
      await page.getByRole('button', { name: '确认更换', exact: true }).click()
      await expect(
        petPage.locator(`.live2d-pet-host[data-model-id="${id}"][data-live2d-state="ready"]`)
      ).toBeVisible({ timeout: 30_000 })
      await petPage.evaluate(() => { document.body.style.background = '#e8e2d9' })
      await petPage.screenshot({ path: testInfo.outputPath(`preset-${id}.png`) })
      await petPage.evaluate(() => { document.body.style.background = 'transparent' })
    }
  } finally {
    await closeApp(app)
  }
})
