import { expect, test } from '@playwright/test'
import { closeApp, findMainPage, findPetPage, launchApp } from './helpers'

/**
 * 官方形象网格桌宠：加载、持续动画、眨眼，以及现有 Live2D 预设不受影响。
 *
 * 说明：Playwright Electron 启动在本机曾因 `--remote-debugging-port=0` 被 Electron 拒绝而失败，
 * 与用例本身无关；本用例在能正常启动的环境执行。
 */
test('official mesh pet loads, animates, blinks and keeps Live2D presets intact', async () => {
  test.setTimeout(180_000)
  const app = await launchApp()
  try {
    const main = await findMainPage(app)
    await main.evaluate(() => window.murasame.settings.update({ petPreset: 'nailong', speakReplies: false }))
    const pet = await findPetPage(app)
    // 满载整套运行时桌宠窗口可能被遮挡，WebGL 读回需要前台合成；先置前再断言。
    await pet.bringToFront()
    const host = pet.locator('[data-model-id="nailong"][data-live2d-state="ready"]')
    await expect(host).toBeVisible({ timeout: 60_000 })
    await expect(pet.locator('.mesh-pet-host canvas')).toBeVisible({ timeout: 60_000 })
    await expect(host).toHaveAttribute('data-motion-group', 'Idle')

    // 连续两帧 alpha 有变化，说明网格在动，而不是一张静态图。
    const diff = await pet.evaluate(async () => {
      const canvas = document.querySelector('.mesh-pet-host canvas') as HTMLCanvasElement | null
      if (!canvas) return -1
      const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
      if (!gl) return -1
      const width = gl.drawingBufferWidth
      const height = gl.drawingBufferHeight
      const first = new Uint8Array(width * height * 4)
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, first)
      await new Promise(resolve => setTimeout(resolve, 900))
      const second = new Uint8Array(width * height * 4)
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, second)
      let sum = 0
      let count = 0
      for (let offset = 0; offset < first.length; offset += 4) {
        if (first[offset + 3] > 8 || second[offset + 3] > 8) {
          sum += Math.abs(first[offset + 3] - second[offset + 3])
          count += 1
        }
      }
      return count ? sum / count : 0
    })
    expect(diff).toBeGreaterThan(2)

    // 眨眼由 data-blink 暴露两端状态；一个周期最长约 25 秒。
    await expect.poll(async () => host.getAttribute('data-blink'), { timeout: 30_000, intervals: [250] }).toBe('1')
    await expect.poll(async () => host.getAttribute('data-blink'), { timeout: 5_000, intervals: [100] }).toBe('0')

    await pet.screenshot({ path: test.info().outputPath('mesh-pet-nailong.png') })

    // 切回现有 Live2D 预设，确认没有破坏原来的形象。
    await main.evaluate(() => window.murasame.settings.update({ petPreset: 'tororo' }))
    await expect(pet.locator('[data-model-id="tororo"][data-live2d-state="ready"]')).toBeVisible({ timeout: 30_000 })
  } finally {
    await closeApp(app)
  }
})
