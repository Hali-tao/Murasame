import { expect, test, type ElectronApplication } from '@playwright/test'
import { closeApp, findMainPage, findPetPage, launchApp } from './helpers'

const PET_TITLE = 'Murasame Pet'
const MAIN_TITLE_PART = 'AI 桌面伙伴'

async function petVisible(app: ElectronApplication): Promise<boolean> {
  return app.evaluate(({ BrowserWindow }, title) => {
    const window = BrowserWindow.getAllWindows().find((item) => item.getTitle() === title)
    return Boolean(window?.isVisible())
  }, PET_TITLE)
}

async function mainVisible(app: ElectronApplication): Promise<boolean> {
  return app.evaluate(({ BrowserWindow }, part) => {
    const window = BrowserWindow.getAllWindows().find((item) => item.getTitle().includes(part))
    return Boolean(window?.isVisible())
  }, MAIN_TITLE_PART)
}

interface WindowBox { x: number; y: number; width: number; height: number }

async function petBounds(app: ElectronApplication): Promise<WindowBox | null> {
  return app.evaluate(({ BrowserWindow }, title) => {
    const window = BrowserWindow.getAllWindows().find((item) => item.getTitle() === title)
    return window ? window.getBounds() : null
  }, PET_TITLE)
}

function withinAnyDisplay(bounds: WindowBox, areas: WindowBox[], tolerance = 2): boolean {
  return areas.some((area) =>
    bounds.x >= area.x - tolerance &&
    bounds.y >= area.y - tolerance &&
    bounds.x + bounds.width <= area.x + area.width + tolerance &&
    bounds.y + bounds.height <= area.y + area.height + tolerance
  )
}

test('[QA-E2E-01] 快速切换形象预设 20 次不崩溃且控制台与桌宠最终状态一致', async () => {
  test.setTimeout(240_000)
  const app = await launchApp()
  try {
    const page = await findMainPage(app)
    const pet = await findPetPage(app)
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(`console: ${error.message}`))
    pet.on('pageerror', (error) => pageErrors.push(`pet: ${error.message}`))
    await expect(pet.locator('.live2d-pet-host')).toHaveAttribute('data-live2d-state', 'ready', { timeout: 30_000 })
    await page.getByTestId('nav-character').click()

    // 默认形象是 tororo，从其它形象开始，保证 20 次点击每次都真的触发一次「更换形象」。
    const sequence = ['naiwa', 'nailong', 'whale-girl', 'tororo']
    const startedAt = Date.now()
    for (let index = 0; index < 20; index += 1) {
      const presetId = sequence[index % sequence.length]
      await page.getByTestId(`pet-preset-${presetId}`).click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await page.getByRole('dialog').getByRole('button', { name: '确认更换', exact: true }).click()
      // 让下一轮从稳定状态开始；这仍是连续切换，只是不等桌宠模型加载完成。
      await expect(page.getByRole('dialog')).toHaveCount(0)
    }
    const elapsed = Date.now() - startedAt
    const finalPreset = sequence[19 % sequence.length]

    const settings = await page.evaluate(() => window.murasame.settings.get())
    expect(settings.petPreset).toBe(finalPreset)
    await expect(page.getByTestId(`pet-preset-${finalPreset}`)).toHaveAttribute('aria-pressed', 'true')
    // 最终一致：桌宠窗口必须真的换到最后一个形象并加载成功。
    await expect(pet.locator(`.live2d-pet-host[data-model-id="${finalPreset}"][data-live2d-state="ready"]`)).toBeVisible({ timeout: 60_000 })

    // 两个窗口都没有崩掉或重复创建；控制台仍可正常导航。
    const titles = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((window) => window.getTitle()))
    expect(titles.filter((title) => title === PET_TITLE)).toHaveLength(1)
    expect(titles.filter((title) => title.includes(MAIN_TITLE_PART))).toHaveLength(1)
    expect(pet.isClosed()).toBe(false)
    await page.getByTestId('nav-overview').click()
    await expect(page.locator('.topbar h1')).toHaveText('概览')
    expect(pageErrors).toEqual([])
    await test.info().attach('preset-switch-20', {
      body: JSON.stringify({ elapsedMs: elapsed, finalPreset, pageErrors }),
      contentType: 'application/json'
    })
  } finally {
    await closeApp(app)
  }
})

test('[QA-E2E-02] 快速隐藏/显示桌宠 15 次与快速开关控制台 10 次后窗口状态一致', async () => {
  test.setTimeout(180_000)
  const app = await launchApp()
  try {
    const page = await findMainPage(app)
    const pet = await findPetPage(app)
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(`console: ${error.message}`))
    pet.on('pageerror', (error) => pageErrors.push(`pet: ${error.message}`))
    await expect(pet.locator('.live2d-pet-host')).toHaveAttribute('data-live2d-state', 'ready', { timeout: 30_000 })

    let visible = await petVisible(app)
    expect(visible).toBe(true)
    for (let index = 0; index < 15; index += 1) {
      const wanted = !visible
      await page.getByRole('button', { name: wanted ? '显示桌宠' : '隐藏桌宠', exact: true }).click()
      await expect.poll(() => petVisible(app), { timeout: 10_000 }).toBe(wanted)
      visible = wanted
    }
    // 初始可见，15 次（奇数次）切换后应为隐藏。
    expect(visible).toBe(false)
    await page.getByRole('button', { name: '显示桌宠', exact: true }).click()
    await expect.poll(() => petVisible(app), { timeout: 10_000 }).toBe(true)

    // 快速隐藏到托盘再显示控制台，重复 10 次。
    for (let index = 0; index < 10; index += 1) {
      await page.getByTestId('hide-to-tray').click()
      await expect.poll(() => mainVisible(app), { timeout: 10_000 }).toBe(false)
      await page.evaluate(() => window.murasame.window.showMain())
      await expect.poll(() => mainVisible(app), { timeout: 10_000 }).toBe(true)
    }

    expect(await mainVisible(app)).toBe(true)
    expect(await petVisible(app)).toBe(true)
    const titles = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((window) => window.getTitle()))
    expect(titles.filter((title) => title === PET_TITLE)).toHaveLength(1)
    expect(titles.filter((title) => title.includes(MAIN_TITLE_PART))).toHaveLength(1)
    await page.getByTestId('nav-overview').click()
    await expect(page.locator('.topbar h1')).toHaveText('概览')

    // 桌宠窗口仍可交互：键盘唤起对话面板。
    await pet.locator('.pet-character').focus()
    await pet.locator('.pet-character').press('Enter')
    await expect(pet.getByTestId('pet-chat')).toBeVisible()
    expect(pageErrors).toEqual([])
  } finally {
    await closeApp(app)
  }
})

test('[QA-E2E-11] 桌宠拖拽到屏幕四角不越界且拖拽结束后仍可交互', async () => {
  test.setTimeout(120_000)
  const app = await launchApp()
  try {
    const page = await findMainPage(app)
    const pet = await findPetPage(app)
    const pageErrors: string[] = []
    pet.on('pageerror', (error) => pageErrors.push(error.message))
    await expect(pet.locator('.live2d-pet-host')).toHaveAttribute('data-live2d-state', 'ready', { timeout: 30_000 })

    const areas = await app.evaluate(({ screen }) => screen.getAllDisplays().map((display) => display.workArea))
    expect(areas.length).toBeGreaterThan(0)
    const initial = await petBounds(app)
    expect(initial).not.toBeNull()
    // 走真实拖拽 IPC：以角色中心为抓取点，分别拖向四个极端方向。
    await page.evaluate(({ x, y, width, height }) => window.murasame.pet.beginDrag(x + width / 2, y + height / 2), initial!)
    const corners = [
      { x: -100_000, y: -100_000 },
      { x: 100_000, y: -100_000 },
      { x: 100_000, y: 100_000 },
      { x: -100_000, y: 100_000 }
    ]
    const observed: WindowBox[] = []
    for (const corner of corners) {
      await page.evaluate(({ x, y }) => window.murasame.pet.dragMove(x, y), corner)
      const bounds = await petBounds(app)
      expect(bounds).not.toBeNull()
      expect(withinAnyDisplay(bounds!, areas)).toBe(true)
      observed.push(bounds!)
    }
    await page.evaluate(() => window.murasame.pet.endDrag())

    const reset = await page.evaluate(() => window.murasame.pet.resetPosition())
    expect(reset.visible).toBe(true)
    expect(withinAnyDisplay({ x: reset.x, y: reset.y, width: 1, height: 1 }, areas)).toBe(true)
    const resetBounds = await petBounds(app)
    expect(resetBounds).not.toBeNull()
    expect(withinAnyDisplay(resetBounds!, areas)).toBe(true)

    // 拖拽结束后单击一次，桌宠仍然响应且没有报错。
    await pet.locator('.pet-character').click()
    expect(pet.isClosed()).toBe(false)
    expect(await petVisible(app)).toBe(true)
    expect(pageErrors).toEqual([])
    await test.info().attach('pet-drag-corners', { body: JSON.stringify(observed), contentType: 'application/json' })
  } finally {
    await closeApp(app)
  }
})

test('[QA-E2E-12] 桌宠连点 10 次不刷屏且面板保持唯一', async () => {
  test.setTimeout(120_000)
  const app = await launchApp()
  try {
    const page = await findMainPage(app)
    const pet = await findPetPage(app)
    const pageErrors: string[] = []
    pet.on('pageerror', (error) => pageErrors.push(error.message))
    await expect(pet.locator('.live2d-pet-host')).toHaveAttribute('data-live2d-state', 'ready', { timeout: 30_000 })

    const character = pet.locator('.pet-character')
    for (let index = 0; index < 10; index += 1) await character.click()

    // 连点不应堆出多个气泡、菜单或对话面板。
    expect(await pet.locator('.pet-bubble').count()).toBeLessThanOrEqual(1)
    expect(await pet.locator('.pet-menu').count()).toBe(0)
    expect(await pet.getByTestId('pet-chat').count()).toBe(0)
    expect(await pet.locator('.pet-activity-stack').count()).toBe(0)

    // 打开对话后继续连点，面板仍然只有一个，输入框没有被刷掉。
    await character.focus()
    await character.press('Enter')
    await expect(pet.getByTestId('pet-chat')).toBeVisible()
    const logs = pet.getByTestId('pet-chat-log')
    const before = await logs.locator('.pet-chat-line').count()
    for (let index = 0; index < 5; index += 1) await character.click()
    await expect(pet.getByTestId('pet-chat')).toHaveCount(1)
    expect(await logs.locator('.pet-chat-line').count()).toBe(before)
    await expect(pet.getByRole('textbox', { name: '对桌宠说' })).toBeVisible()
    expect(await pet.locator('.pet-bubble').count()).toBeLessThanOrEqual(1)
    expect(pet.isClosed()).toBe(false)

    const titles = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((window) => window.getTitle()))
    expect(titles.filter((title) => title === PET_TITLE)).toHaveLength(1)
    // 控制台没有被桌宠连点拖慢，仍能正常切换页面。
    await page.getByTestId('nav-overview').click()
    await expect(page.locator('.topbar h1')).toHaveText('概览')
    expect(pageErrors).toEqual([])
  } finally {
    await closeApp(app)
  }
})
