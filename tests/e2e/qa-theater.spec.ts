import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { closeApp, configureTestModel, findMainPage, findPetPage, launchApp, startModelServer } from './helpers'
import { IPC } from '../../src/shared/ipc'

/**
 * F-04 桌面小剧场（任务幕最小切片）：
 * 任务进入终态后，桌宠脚边演一句真实结果；可跳过；勿扰时不演。
 */
test('[F-04-THEATER-05] 任务取消后桌宠演出任务幕，点「跳过」立即收起；勿扰时不演', async () => {
  test.setTimeout(180_000)
  const root = mkdtempSync(join(tmpdir(), 'qa-theater-'))
  writeFileSync(join(root, 'example.txt'), 'theater fixture')
  const server = await startModelServer({ taskRoot: root })
  const app = await launchApp()
  try {
    const main = await findMainPage(app)
    const pet = await findPetPage(app)
    await configureTestModel(main, server.url)
    await main.evaluate(() => window.murasame.pet.show())

    await main.getByTestId('nav-tasks').click()
    await main.getByTestId('new-task').click()
    await main.getByTestId('task-title-input').fill(`整理文件夹 ${root}`)
    await main.getByRole('button', { name: '创建并开始', exact: true }).click()
    await expect(main.locator('.task-detail-titleline .pill')).toHaveText(/等待批准|待确认/, { timeout: 20_000 })
    await main.getByTestId('cancel-task').click()
    const dialog = main.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: '取消任务', exact: true }).click()
    await expect(main.locator('.task-detail-titleline .pill')).toHaveText('已取消', { timeout: 20_000 })

    const scene = pet.getByTestId('pet-theater')
    await expect(scene).toBeVisible({ timeout: 10_000 })
    await expect(scene).toContainText('任务')
    await expect(scene).toContainText('已取消')
    await pet.getByTestId('pet-theater-skip').click()
    await expect(pet.getByTestId('pet-theater')).toHaveCount(0)

    // 设置里关闭「桌面小剧场」：任务终态不再演；恢复后继续演。
    await main.getByTestId('nav-settings').click()
    const theaterSwitch = main.getByRole('switch', { name: '桌面小剧场' })
    await expect(theaterSwitch).toHaveAttribute('aria-checked', 'true')
    await theaterSwitch.click()
    await expect(theaterSwitch).toHaveAttribute('aria-checked', 'false')
    await main.getByTestId('nav-tasks').click()
    await main.getByTestId('new-task').click()
    await main.getByTestId('task-title-input').fill(`整理文件夹 ${root}`)
    await main.getByRole('button', { name: '创建并开始', exact: true }).click()
    await expect(main.locator('.task-detail-titleline .pill')).toHaveText(/等待批准|待确认/, { timeout: 20_000 })
    await main.getByTestId('cancel-task').click()
    await main.getByRole('dialog').getByRole('button', { name: '取消任务', exact: true }).click()
    await expect(main.locator('.task-detail-titleline .pill')).toHaveText('已取消', { timeout: 20_000 })
    await pet.waitForTimeout(1500)
    await expect(pet.getByTestId('pet-theater')).toHaveCount(0)

    // 角色页的恢复入口（设计里恢复入口在角色页，而不是设置页）。
    await main.getByTestId('nav-character').click()
    const restoreSwitch = main.getByRole('switch', { name: '桌面小剧场' })
    await expect(restoreSwitch).toHaveAttribute('aria-checked', 'false')
    await restoreSwitch.click()
    await expect(restoreSwitch).toHaveAttribute('aria-checked', 'true')
    await main.getByTestId('nav-tasks').click()
    await main.getByTestId('new-task').click()
    await main.getByTestId('task-title-input').fill(`整理文件夹 ${root}`)
    await main.getByRole('button', { name: '创建并开始', exact: true }).click()
    await expect(main.locator('.task-detail-titleline .pill')).toHaveText(/等待批准|待确认/, { timeout: 20_000 })
    await main.getByTestId('cancel-task').click()
    await main.getByRole('dialog').getByRole('button', { name: '取消任务', exact: true }).click()
    await expect(main.locator('.task-detail-titleline .pill')).toHaveText('已取消', { timeout: 20_000 })
    await expect(pet.getByTestId('pet-theater')).toBeVisible({ timeout: 10_000 })
    // 「查看」：打开控制台任务页并聚焦到这一幕对应的任务。
    await pet.getByTestId('pet-theater-view').click()
    await expect(main).toHaveURL(/\/tasks\?focus=/, { timeout: 10_000 })
    await expect(main.getByTestId('nav-tasks')).toHaveAttribute('aria-current', 'page')
    // 控制台打开的是这一幕对应的任务：标题是任务名，URL focus 与详情里的任务 id 一致。
    await expect(main.locator('.task-detail-card h2')).toContainText('整理文件夹')
    const focusTaskId = await main.evaluate(() => {
      const hash = window.location.hash
      const query = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : ''
      return new URLSearchParams(query).get('focus')
    })
    await expect(main.locator('.mono-id')).toHaveText(focusTaskId ?? '')
    await expect(pet.getByTestId('pet-theater')).toHaveCount(0)

    // 勿扰：同一流程再来一次，不演。
    await main.evaluate(() => window.murasame.settings.update({ doNotDisturb: true }))
    await main.getByTestId('new-task').click()
    await main.getByTestId('task-title-input').fill(`整理文件夹 ${root}`)
    await main.getByRole('button', { name: '创建并开始', exact: true }).click()
    await expect(main.locator('.task-detail-titleline .pill')).toHaveText(/等待批准|待确认/, { timeout: 20_000 })
    await main.getByTestId('cancel-task').click()
    await main.getByRole('dialog').getByRole('button', { name: '取消任务', exact: true }).click()
    await expect(main.locator('.task-detail-titleline .pill')).toHaveText('已取消', { timeout: 20_000 })
    await pet.waitForTimeout(1500)
    await expect(pet.getByTestId('pet-theater')).toHaveCount(0)

    // 「今天不再演」：解除勿扰 → 新任务终态 → 出现小剧场 → 点「今天不再演」收起；
    // 之后再发生终态事件，当天不再自动演。
    await main.evaluate(() => window.murasame.settings.update({ doNotDisturb: false }))
    await main.getByTestId('new-task').click()
    await main.getByTestId('task-title-input').fill(`整理文件夹 ${root}`)
    await main.getByRole('button', { name: '创建并开始', exact: true }).click()
    await expect(main.locator('.task-detail-titleline .pill')).toHaveText(/等待批准|待确认/, { timeout: 20_000 })
    await main.getByTestId('cancel-task').click()
    await main.getByRole('dialog').getByRole('button', { name: '取消任务', exact: true }).click()
    await expect(main.locator('.task-detail-titleline .pill')).toHaveText('已取消', { timeout: 20_000 })
    await expect(pet.getByTestId('pet-theater')).toBeVisible({ timeout: 10_000 })
    await pet.getByTestId('pet-theater-mute-today').click()
    await expect(pet.getByTestId('pet-theater')).toHaveCount(0)

    await main.getByTestId('new-task').click()
    await main.getByTestId('task-title-input').fill(`整理文件夹 ${root}`)
    await main.getByRole('button', { name: '创建并开始', exact: true }).click()
    await expect(main.locator('.task-detail-titleline .pill')).toHaveText(/等待批准|待确认/, { timeout: 20_000 })
    await main.getByTestId('cancel-task').click()
    await main.getByRole('dialog').getByRole('button', { name: '取消任务', exact: true }).click()
    await expect(main.locator('.task-detail-titleline .pill')).toHaveText('已取消', { timeout: 20_000 })
    await pet.waitForTimeout(1500)
    await expect(pet.getByTestId('pet-theater')).toHaveCount(0)
  } finally {
    await closeApp(app)
    await server.close()
    rmSync(root, { recursive: true, force: true })
  }
})


test('[F-04-THEATER-06] 见闻幕：桌宠显示「见闻」标签，「查看」打开自主活动页', async () => {
  const app = await launchApp()
  try {
    const main = await findMainPage(app)
    const pet = await findPetPage(app)
    await main.evaluate(() => window.murasame.pet.show())
    // 真实见闻幕由主进程在自主活动完成时投递；隔离桌面依赖 Docker，这里直接投递同一 IPC 事件验证桌宠侧行为。
    await app.evaluate(({ BrowserWindow }, payload) => {
      const petWindow = BrowserWindow.getAllWindows().find((item) => item.webContents.getURL().includes('/pet.html'))
      petWindow?.webContents.send(payload.channel, payload.scene)
    }, {
      channel: IPC.pet.theater,
      scene: {
        id: 'observation-qa-1',
        kind: 'observation',
        taskId: 'activity-qa-1',
        status: '已完成',
        title: '浏览测试',
        line: '刚在隔离桌面里看了一会儿：浏览测试。共有 1 条观察记录。',
        intent: '思考',
        viewPath: '/autonomy',
        createdAt: new Date().toISOString()
      }
    })
    const scene = pet.getByTestId('pet-theater')
    await expect(scene).toBeVisible({ timeout: 10_000 })
    await expect(scene).toContainText('见闻')
    await expect(scene).toContainText('1 条观察记录')
    await pet.getByTestId('pet-theater-view').click()
    await expect(main).toHaveURL(/\/autonomy/, { timeout: 10_000 })
    await expect(pet.getByTestId('pet-theater')).toHaveCount(0)
  } finally {
    await closeApp(app)
  }
})


test('[F-04-THEATER-07] 超长任务名不会撑爆小剧场气泡，跳过按钮仍在窗口内', async () => {
  test.setTimeout(120_000)
  const root = mkdtempSync(join(tmpdir(), 'qa-theater-long-'))
  writeFileSync(join(root, 'example.txt'), 'long title fixture')
  const server = await startModelServer({ taskRoot: root })
  const app = await launchApp()
  try {
    const main = await findMainPage(app)
    const pet = await findPetPage(app)
    await configureTestModel(main, server.url)
    await main.evaluate(() => window.murasame.pet.show())
    const longTitle = `整理文件夹 ${root} ${'超长任务描述'.repeat(80)}`
    expect(longTitle.length).toBeGreaterThan(300)
    await main.getByTestId('nav-tasks').click()
    await main.getByTestId('new-task').click()
    await main.getByTestId('task-title-input').fill(longTitle)
    await main.getByRole('button', { name: '创建并开始', exact: true }).click()
    await expect(main.locator('.task-detail-titleline .pill')).toHaveText(/等待批准|待确认/, { timeout: 20_000 })
    await main.getByTestId('cancel-task').click()
    await main.getByRole('dialog').getByRole('button', { name: '取消任务', exact: true }).click()
    await expect(main.locator('.task-detail-titleline .pill')).toHaveText('已取消', { timeout: 20_000 })
    const scene = pet.getByTestId('pet-theater')
    await expect(scene).toBeVisible({ timeout: 10_000 })
    const rendered = await scene.innerText()
    // 气泡只展示有界摘要，不把 300+ 字任务名原样塞进桌宠窗口。
    expect(rendered.length).toBeLessThan(300)
    await expect(pet.getByTestId('pet-theater-skip')).toBeInViewport()
  } finally {
    await closeApp(app)
    await server.close()
    rmSync(root, { recursive: true, force: true })
  }
})
