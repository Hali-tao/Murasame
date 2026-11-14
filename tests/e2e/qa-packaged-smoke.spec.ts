import { expect, test } from '@playwright/test'
import { _electron as electron } from '@playwright/test'
import { existsSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { closeApp, configureTestModel, findMainPage, launchApp, startModelServer, testUserData } from './helpers'

// 只有显式给出安装包可执行文件时才运行（打包形态验收）。
test.skip(!process.env.MURASAME_E2E_EXECUTABLE, '需要 MURASAME_E2E_EXECUTABLE 指向已打包应用')

test.describe('[PACKAGED] 安装包形态验收', () => {
  test('[PACKAGED-01] 打包应用可启动，页面齐全，真实模型对话与记忆可用', async () => {
    test.setTimeout(180_000)
    const server = await startModelServer()
    const app = await launchApp()
    try {
      expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(true)
      expect(await app.evaluate(({ app }) => app.getVersion())).toBe('0.9.0')
      const page = await findMainPage(app)
      for (const id of ['nav-overview', 'nav-chat', 'nav-screen', 'nav-autonomy', 'nav-tasks', 'nav-history', 'nav-memory', 'nav-tools', 'nav-models', 'nav-character', 'nav-settings']) {
        await page.getByTestId(id).click()
        await expect(page.getByTestId(id)).toBeVisible()
      }
      await configureTestModel(page, server.url, '打包验收服务')
      const conversationId = await page.evaluate(async () => {
        const created = await window.murasame.core.createConversation()
        if (!created.ok) throw new Error(created.error)
        return created.data.id
      })
      const reply = await page.evaluate(async ({ id }) => {
        const result = await window.murasame.core.sendMessage(id, '打包形态回环测试')
        if (!result.ok) throw new Error(result.error)
        return result.data
      }, { id: conversationId })
      expect(typeof reply).toBe('object')
      await page.getByTestId('nav-memory').click()
      await page.getByTestId('add-memory').click()
      await page.getByTestId('memory-category').fill('偏好')
      await page.getByTestId('memory-text').fill('打包形态下记忆可写入')
      await page.getByRole('button', { name: '添加记忆', exact: true }).click()
      await expect(page.getByText('打包形态下记忆可写入')).toBeVisible()
    } finally {
      await closeApp(app)
      await server.close()
    }
  })

  test('[PACKAGED-02] 打包资源包含真实模型与 speech-worker 入口，设置跨重启持久化', async () => {
    test.setTimeout(180_000)
    let app = await launchApp()
    const userData = testUserData(app)
    try {
      const resources = await app.evaluate(({ app }) => ({
        packaged: app.isPackaged,
        appPath: app.getAppPath(),
        resourcesPath: process.resourcesPath
      }))
      expect(resources.packaged).toBe(true)
      // 主进程 evaluate 里不能动态 import fs；在测试进程检查解包后的资源与 asar 清单。
      const models = resources.resourcesPath + '\\models'
      expect(existsSync(models + '\\whisper\\onnx\\encoder_model_quantized.onnx')).toBe(true)
      expect(existsSync(models + '\\kokoro\\onnx\\model_quantized.onnx')).toBe(true)
      expect(existsSync(models + '\\bge-small-zh-v1.5\\onnx\\model_quantized.onnx')).toBe(true)
      const require = createRequire(__filename)
      const { listPackage } = require('@electron/asar') as { listPackage: (asarPath: string) => string[] }
      const asarFiles = listPackage(resources.appPath)
      expect(asarFiles.some(file => file.includes('speech-worker'))).toBe(true)

      const page = await findMainPage(app)
      await page.evaluate(() => window.murasame.settings.update({ doNotDisturb: true }))
      const firstPid = app.process().pid ?? 0
      await app.close()
      // 打包进程的退出清理是异步的；必须确认旧进程真正退出（单实例锁释放）后再重启。
      let alive = true
      for (let attempt = 0; attempt < 40; attempt += 1) {
        try {
          process.kill(firstPid, 0)
        } catch {
          alive = false
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
      if (alive) spawnSync('taskkill', ['/PID', String(firstPid), '/T', '/F'], { windowsHide: true })
      // 打包进程退出后 Windows 可能仍持有 profile 句柄：有限重试启动，避免把环境竞争当成产品失败。
      const relaunchEnv = { ...process.env, MURASAME_USER_DATA: userData } as Record<string, string>
      delete relaunchEnv.ELECTRON_RUN_AS_NODE
      for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
          app = await electron.launch({
            executablePath: process.env.MURASAME_E2E_EXECUTABLE,
            args: [],
            cwd: process.cwd(),
            env: relaunchEnv
          })
          break
        } catch (error) {
          if (attempt === 3) throw error
          await new Promise((resolve) => setTimeout(resolve, 2000))
        }
      }
      const restarted = await findMainPage(app)
      expect((await restarted.evaluate(() => window.murasame.settings.get())).doNotDisturb).toBe(true)
    } finally {
      await closeApp(app).catch(() => undefined)
      rmSync(userData, { recursive: true, force: true })
    }
  })
})
