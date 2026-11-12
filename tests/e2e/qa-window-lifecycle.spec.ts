import { expect, test } from '@playwright/test'
import { closeApp, findMainPage, launchApp } from './helpers'

/** 窗口/托盘/快捷键/模型异常的生命周期边界。 */
async function mainWindowState(app: Parameters<typeof closeApp>[0]) {
  return app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((item) => !item.webContents.getURL().includes('/pet.html'))
    return window ? { visible: window.isVisible(), minimized: window.isMinimized(), bounds: window.getBounds() } : null
  })
}

test.describe('[QA-WINLIFE-00] 窗口与托盘生命周期', () => {
  test('[QA-WINLIFE-01] 隐藏到托盘/恢复显示重复 10 次状态一致', async () => {
    const app = await launchApp()
    try {
      const page = await findMainPage(app)
      await page.evaluate(() => window.murasame.window.showMain())
      expect((await mainWindowState(app))?.visible).toBe(true)
      for (let index = 0; index < 10; index += 1) {
        await page.evaluate(() => window.murasame.window.hideMain())
        await expect.poll(async () => (await mainWindowState(app))?.visible).toBe(false)
        await page.evaluate(() => window.murasame.window.showMain())
        await expect.poll(async () => (await mainWindowState(app))?.visible).toBe(true)
      }
      // 控制台仍可正常交互。
      await page.getByTestId('nav-overview').click()
      await expect(page.getByTestId('nav-overview')).toBeVisible()
    } finally {
      await closeApp(app)
    }
  })

  test('[QA-WINLIFE-02] 开启最小化到托盘后，最小化主窗口会隐藏到托盘', async () => {
    const app = await launchApp()
    try {
      const page = await findMainPage(app)
      await page.evaluate(async () => {
        const settings = await window.murasame.settings.get()
        await window.murasame.settings.update({ minimizeToTray: true, closeBehavior: 'tray' } as never)
        return settings
      })
      await app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows().find((item) => !item.webContents.getURL().includes('/pet.html'))
        window?.minimize()
      })
      await expect.poll(async () => (await mainWindowState(app))?.visible, { timeout: 10_000 }).toBe(false)
      await page.evaluate(() => window.murasame.window.showMain())
      await expect.poll(async () => (await mainWindowState(app))?.visible).toBe(true)
    } finally {
      await closeApp(app)
    }
  })

  test('[QA-WINLIFE-03] 主窗口不能缩小到最小尺寸以下', async () => {
    const app = await launchApp()
    try {
      const page = await findMainPage(app)
      await app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows().find((item) => !item.webContents.getURL().includes('/pet.html'))
        window?.setSize(600, 300)
      })
      const bounds = (await mainWindowState(app))?.bounds
      expect(bounds).toBeTruthy()
      expect(bounds!.width).toBeGreaterThanOrEqual(1180)
      expect(bounds!.height).toBeGreaterThanOrEqual(740)
      // 布局仍可用。
      await expect(page.getByTestId('nav-overview')).toBeVisible()
    } finally {
      await closeApp(app)
    }
  })

  test('[QA-WINLIFE-04] 非法快捷键不会写入设置，应用不崩溃', async () => {
    const app = await launchApp()
    try {
      const page = await findMainPage(app)
      const previous = await page.evaluate(() => window.murasame.settings.get().then((settings) => settings.petHotkey))
      const outcome = await page.evaluate(async () => {
        try {
          const next = await window.murasame.settings.update({ petHotkey: 'Definitely-Not-A-Key' })
          return { resolved: true, hotkey: next.petHotkey }
        } catch (error) {
          return { resolved: false, error: String(error).slice(0, 120) }
        }
      })
      // 要么被校验拒绝，要么注册失败后保留旧值；两种都不能写入不可用快捷键。
      if (outcome.resolved) expect(outcome.hotkey).toBe(previous)
      const current = await page.evaluate(() => window.murasame.settings.get().then((settings) => settings.petHotkey))
      expect(current).toBe(previous)
      await page.getByTestId('nav-memory').click()
      await expect(page.getByTestId('nav-memory')).toBeVisible()
    } finally {
      await closeApp(app)
    }
  })

  test('[QA-WINLIFE-05] 桌宠快速显示/隐藏 20 次后状态一致', async () => {
    const app = await launchApp()
    try {
      const page = await findMainPage(app)
      const result = await page.evaluate(async () => {
        const states = []
        for (let index = 0; index < 20; index += 1) {
          const state = await window.murasame.pet.toggle()
          states.push(state.visible)
        }
        const finalState = await window.murasame.pet.getState()
        return { states, finalState }
      })
      expect(result.states.every((visible) => typeof visible === 'boolean')).toBe(true)
      // 偶数次 toggle 回到初始可见状态。
      expect(result.finalState.visible).toBe(true)
      const actualVisible = await app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows().find((item) => item.webContents.getURL().includes('/pet.html'))
        return window?.isVisible() ?? null
      })
      expect(actualVisible).toBe(true)
    } finally {
      await closeApp(app)
    }
  })

  test('[QA-WINLIFE-06] 模型验证失败（不可达地址）返回中文错误且应用不崩溃', async () => {
    test.setTimeout(120_000)
    const app = await launchApp()
    try {
      const page = await findMainPage(app)
      const result = await page.evaluate(async () => {
        const draft = await window.murasame.core.createModel()
        if (!draft.ok) return { stage: 'create', error: draft.error }
        const saved = await window.murasame.core.saveModel(draft.data.id, {
          name: '不可达地址测试',
          provider: 'openai',
          endpoint: 'http://127.0.0.1:9/v1',
          key: 'sk-qa-unreachable',
          model: 'gpt-4o-mini',
          caps: ['chat']
        })
        if (!saved.ok) return { stage: 'save', error: saved.error }
        const verified = await window.murasame.core.verifyModel(draft.data.id)
        return { stage: 'verify', ok: verified.ok, error: verified.ok ? '' : verified.error }
      })
      expect(result.stage).toBe('verify')
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/[\u4e00-\u9fff]/)
      // 失败后应用仍可交互，不发生未捕获异常导致的崩溃。
      await page.getByTestId('nav-overview').click()
      await expect(page.getByTestId('nav-overview')).toBeVisible()
      expect(await app.evaluate(({ app }) => app.isReady())).toBe(true)
    } finally {
      await closeApp(app)
    }
  })
})
