import { expect, test } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'
import { closeApp, findMainPage, findPetPage, launchApp } from './helpers'

/**
 * 崩溃恢复回归：渲染进程崩溃后窗口必须自动重新加载，而不是永久空白。
 * Playwright 的 page 在崩溃后不可用，所以恢复检测走主进程 webContents.executeJavaScript。
 */
async function windowState(app: ElectronApplication, target: 'pet' | 'main'): Promise<{
  exists: boolean
  crashed: boolean | null
  ready?: string
  hasApi?: boolean
  bodyLength?: number
  recoveryError?: string
}> {
  return app.evaluate(async ({ BrowserWindow }, which) => {
    const window = BrowserWindow.getAllWindows().find((item) => {
      const url = item.webContents.getURL()
      return which === 'pet' ? url.includes('pet.html') : !url.includes('pet.html')
    })
    if (!window) return { exists: false, crashed: null }
    const contents = window.webContents
    const crashed = contents.isCrashed()
    if (crashed) return { exists: true, crashed }
    try {
      const ready = await contents.executeJavaScript('document.readyState')
      const hasApi = await contents.executeJavaScript('Boolean(window.murasame)')
      const bodyLength = await contents.executeJavaScript('document.body ? document.body.innerText.length : 0')
      return { exists: true, crashed, ready, hasApi, bodyLength }
    } catch (error) {
      return { exists: true, crashed, recoveryError: String(error).slice(0, 120) }
    }
  }, target)
}

async function crashRenderer(app: ElectronApplication, target: 'pet' | 'main'): Promise<void> {
  await app.evaluate(({ BrowserWindow }, which) => {
    const window = BrowserWindow.getAllWindows().find((item) => {
      const url = item.webContents.getURL()
      return which === 'pet' ? url.includes('pet.html') : !url.includes('pet.html')
    })
    if (!window) throw new Error(`找不到目标窗口：${which}`)
    window.webContents.forcefullyCrashRenderer()
  }, target)
}

async function waitRecovered(app: ElectronApplication, target: 'pet' | 'main', timeoutMs = 20_000): Promise<void> {
  const started = Date.now()
  const states: unknown[] = []
  // 渲染进程崩溃的瞬间，Playwright 与 Electron 的连接会短暂处于不可求值状态；
  // 此时直接 app.evaluate 会挂起。先等恢复窗口，再带超时竞速轮询。
  await new Promise((resolve) => setTimeout(resolve, 1500))
  while (Date.now() - started < timeoutMs) {
    const state = await Promise.race([
      windowState(app, target),
      new Promise<'TIMEOUT'>((resolve) => setTimeout(() => resolve('TIMEOUT'), 4000))
    ])
    if (state !== 'TIMEOUT') {
      states.push({ at: Date.now() - started, ...state })
      if (state.exists && state.crashed === false && state.ready === 'complete' && state.hasApi) return
    }
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
  throw new Error(`${target} 窗口未在 ${timeoutMs}ms 内恢复：${JSON.stringify(states.slice(-6))}`)
}

test.describe('[QA-CRASH-10] 渲染进程崩溃恢复', () => {
  test('[QA-CRASH-08] 桌宠与控制台渲染进程崩溃后都自动重新加载', async () => {
    test.setTimeout(90_000)
    const app = await launchApp()
    try {
      await findMainPage(app)
      await findPetPage(app)

      for (const target of ['pet', 'main'] as const) {
        await crashRenderer(app, target)
        await waitRecovered(app, target)
        // 主进程在两次崩溃后仍必须保持就绪。
        expect(await app.evaluate(({ app }) => app.isReady())).toBe(true)
      }

      // 恢复后的控制台仍可继续交互（重新挂载了完整页面，而不只是空壳）。
      const recoveredMain = await windowState(app, 'main')
      expect(recoveredMain.bodyLength ?? 0).toBeGreaterThan(10)
    } finally {
      await closeApp(app)
    }
  })
})
