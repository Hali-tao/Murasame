import { expect, test } from '@playwright/test'
import { IPC } from '../../src/shared/ipc'
import { closeApp, findMainPage, findPetPage, launchApp } from './helpers'

async function addMemory(page: import('@playwright/test').Page, text: string): Promise<void> {
  await page.getByTestId('add-memory').click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByTestId('memory-category').fill('偏好')
  await dialog.getByTestId('memory-text').fill(text)
  await dialog.getByRole('button', { name: '添加记忆', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

test('[QA-E2E-10] 连发多条通知不刷屏、相同通知合并、过期通知自动消失', async () => {
  test.setTimeout(180_000)
  const app = await launchApp()
  try {
    const page = await findMainPage(app)
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.getByTestId('nav-memory').click()

    // 连续触发多条不同的例行操作通知。
    await addMemory(page, 'QA 通知记忆 A')
    const edited = page.getByTestId('memory-card').filter({ hasText: 'QA 通知记忆 A' })
    await edited.getByRole('button', { name: '编辑' }).click()
    await page.getByRole('dialog').getByTestId('memory-text').fill('QA 通知记忆 A 已修订')
    await page.getByRole('dialog').getByRole('button', { name: '保存更正', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await addMemory(page, 'QA 通知记忆 B')
    const removed = page.getByTestId('memory-card').filter({ hasText: 'QA 通知记忆 B' })
    await removed.getByRole('button', { name: '删除' }).click()
    await page.getByRole('dialog').getByRole('button', { name: '删除记忆', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.getByRole('button', { name: '清空…', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '清空全部记忆', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)

    // 例行通知最多保留最近 2 条，不能堆满一屏。
    const toastCount = await page.locator('.toast').count()
    expect(toastCount).toBeGreaterThan(0)
    expect(toastCount).toBeLessThanOrEqual(2)
    const stack = page.getByRole('region', { name: '操作提示' })
    await expect(stack).toBeVisible()

    // 例行通知 5 秒后自动消失（留出 IPC 与渲染调度余量）。
    const expireStartedAt = Date.now()
    await expect(page.locator('.toast')).toHaveCount(0, { timeout: 10_000 })
    const expireElapsed = Date.now() - expireStartedAt
    expect(expireElapsed).toBeLessThan(9_000)

    // 相同通知在存活期内合并成一条并显示重复次数，而不是刷屏。
    for (let index = 0; index < 3; index += 1) await addMemory(page, `QA 合并通知 ${index}`)
    const merged = page.locator('.toast').filter({ hasText: '已添加记忆条目' })
    await expect(merged).toHaveCount(1)
    await expect(merged).toContainText('重复 3 次')
    await expect(page.locator('.toast')).toHaveCount(1)
    await expect(page.locator('.toast')).toHaveCount(0, { timeout: 10_000 })

    await expect(page.locator('.toast-red')).toHaveCount(0)
    expect(pageErrors).toEqual([])
    await page.screenshot({ path: test.info().outputPath('notification-burst-and-merge.png') })
  } finally {
    await closeApp(app)
  }
})

test('[QA-E2E-13] 全局快捷键反复切换只保留一个注册，重复触发只打开一个对话面板', async () => {
  test.setTimeout(180_000)
  const app = await launchApp()
  try {
    const page = await findMainPage(app)
    const pet = await findPetPage(app)
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    const initial = (await page.evaluate(() => window.murasame.settings.get())).petHotkey
    const alternate = 'Ctrl+Alt+Shift+F12'
    const accelerators = [initial, alternate]
    const registeredState = async (): Promise<boolean[]> => app.evaluate(({ globalShortcut }, list) => list.map((accelerator) => globalShortcut.isRegistered(accelerator)), accelerators)

    // 反反复复切换快捷键：每一次都只允许有一个组合注册成功，不能泄漏旧注册。
    for (let round = 0; round < 4; round += 1) {
      const wanted = round % 2 === 0 ? alternate : initial
      await page.evaluate((accelerator) => window.murasame.settings.update({ petHotkey: accelerator }), wanted)
      const status = await page.evaluate(() => window.murasame.app.hotkey())
      const settings = await page.evaluate(() => window.murasame.settings.get())
      const registered = await registeredState()
      const active = accelerators.filter((_, index) => registered[index])
      expect(active.length).toBeLessThanOrEqual(1)
      // 注册失败时会回退到旧值；无论成功回退，设置里的值必须与真实注册状态一致。
      expect(settings.petHotkey).toBe(active.length ? active[0] : initial)
      if (active.length) expect(status).toContain(active[0])
      else expect(status).toContain('注册失败')
    }

    // 重复设置同一个快捷键是幂等的，不会重复注册或崩溃。
    const current = (await page.evaluate(() => window.murasame.settings.get())).petHotkey
    for (let round = 0; round < 3; round += 1) {
      await page.evaluate((accelerator) => window.murasame.settings.update({ petHotkey: accelerator }), current)
    }
    const finalRegistered = await registeredState()
    expect(finalRegistered.filter(Boolean).length).toBeLessThanOrEqual(1)
    await expect.poll(() => page.evaluate(() => window.murasame.app.hotkey()), { timeout: 10_000 }).toContain(current)

    // 快捷键回调的最终一段是向桌宠窗口发送 focusChat；重复触发不能堆出多个面板。
    await app.evaluate(({ BrowserWindow }, channel) => {
      const petWindow = BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'Murasame Pet')
      for (let index = 0; index < 5; index += 1) petWindow?.webContents.send(channel)
    }, IPC.pet.focusChat)
    await expect(pet.getByTestId('pet-chat')).toHaveCount(1, { timeout: 15_000 })
    await expect(pet.getByRole('textbox', { name: '对桌宠说' })).toBeVisible()
    const titles = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((window) => window.getTitle()))
    expect(titles.filter((title) => title === 'Murasame Pet')).toHaveLength(1)
    expect(titles.filter((title) => title.includes('AI 桌面伙伴'))).toHaveLength(1)
    expect(pageErrors).toEqual([])
    await page.screenshot({ path: test.info().outputPath('hotkey-repeat-trigger.png') })
  } finally {
    await closeApp(app)
  }
})
