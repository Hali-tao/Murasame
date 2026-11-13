import { test, expect } from '@playwright/test'
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { launchApp, closeApp, findMainPage } from './helpers'

/**
 * 开发态（非打包）下把本机 build/bundled-models 里的真实 whisper/kokoro 复制进隔离 userData。
 * 打包验收（MURASAME_E2E_EXECUTABLE）使用应用自带模型，不需要复制。
 */
function prepareSpeechModels(userData: string): void {
  if (process.env.MURASAME_E2E_EXECUTABLE) return
  const bundled = resolve('build/bundled-models')
  for (const id of ['whisper', 'kokoro']) {
    const source = join(bundled, id)
    if (!existsSync(source)) continue
    const target = join(userData, 'models', id)
    mkdirSync(target, { recursive: true })
    cpSync(source, target, { recursive: true, force: true })
  }
}

test.describe('real local speech responsiveness', () => {
  test.skip(process.env.MURASAME_E2E_SPEECH !== '1', 'Requires packaged offline speech models and Chinese phonemizer')
  // Playwright 要求第一个参数是解构的 fixtures 对象；这里只用到 TestInfo，故留空对象。
  // eslint-disable-next-line no-empty-pattern
  test('cold and warm speech preserve control responses and actual audio', async ({}, info) => {
    test.setTimeout(90_000)
    const app = await launchApp(true, prepareSpeechModels)
    try {
      const page = await findMainPage(app)
      const measurements = []
      for (const phase of ['cold', 'warm']) {
        const metrics = await page.evaluate(async () => {
          const responses: number[] = []
          let finished = false
          const pings = (async () => {
            while (!finished) {
              const at = performance.now()
              await window.murasame.settings.get()
              responses.push(performance.now() - at)
              await new Promise(resolve => setTimeout(resolve, 50))
            }
          })()
          const started = performance.now()
          try {
            const spoken = await window.murasame.voice.speak('你好，这是本地语音响应测试。')
            return { elapsed: performance.now() - started, responses, played: spoken.played, message: spoken.message, sampleRate: spoken.sampleRate, sampleCount: spoken.samples.length, peak: spoken.samples.reduce((max, sample) => Math.max(max, Math.abs(sample)), 0) }
          } finally { finished = true; await pings }
        })
        measurements.push({ phase, ...metrics, maxResponse: Math.max(...metrics.responses) })
      }
      await info.attach('speech-response.json', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' })
      for (const measurement of measurements) {
        expect(measurement.played, measurement.message).toBe(true)
        expect(measurement.sampleRate).toBe(24000)
        expect(measurement.sampleCount).toBeGreaterThan(24000)
        expect(measurement.peak).toBeGreaterThan(0.01)
        expect(measurement.responses.length).toBeGreaterThan(5)
        expect(measurement.maxResponse, `${measurement.phase} control responsiveness`).toBeLessThan(500)
      }
    } finally { await closeApp(app) }
  })
  test('speech process failure preserves text fallback and the next request recovers', async () => {
    test.setTimeout(90_000)
    const app = await launchApp(true, prepareSpeechModels)
    try {
      const page = await findMainPage(app)
      const pending = page.evaluate(() => window.murasame.voice.speak('这是一条进程异常测试。'))
      await expect.poll(() => app.evaluate(({ app }) => app.getAppMetrics().filter(item => item.name === 'Murasame Local Speech').length), { timeout: 30_000 }).toBe(1)
      await app.evaluate(({ app }) => {
        const worker = app.getAppMetrics().find(item => item.name === 'Murasame Local Speech')
        if (!worker) throw new Error('No owned speech process')
        process.kill(worker.pid)
      })
      expect((await pending).played).toBe(false)
      const recovered = await page.evaluate(() => window.murasame.voice.speak('恢复之后可以继续朗读。'))
      expect(recovered.played, recovered.message).toBe(true)
      expect(recovered.samples.length).toBeGreaterThan(24000)
    } finally { await closeApp(app) }
  })
})
