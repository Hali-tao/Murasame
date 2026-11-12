import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { closeApp, configureTestModel, findMainPage, findPetPage, launchApp, startModelServer } from './helpers'

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
  } finally {
    await closeApp(app)
    await server.close()
    rmSync(root, { recursive: true, force: true })
  }
})
