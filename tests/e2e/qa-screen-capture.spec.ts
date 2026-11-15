import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { expect, test } from '@playwright/test'
import type { ScreenAnalysis } from '../../src/shared/types'
import { closeApp, findMainPage, launchApp } from './helpers'
import { listenHttp } from '../helpers/http-server'

interface CapturedRequest {
  hasImage: boolean
  tool: string
}

/** 视觉模型桩：图像探测返回「蓝色」，工具探测返回 get_color，其余 OK；记录真实图像请求。 */
async function startVisionServer() {
  const requests: CapturedRequest[] = []
  const server = createServer((request, response) => {
    let raw = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => { raw += chunk })
    request.on('end', () => {
      const payload = JSON.parse(raw) as {
        stream?: boolean
        messages?: Array<{ role: string; content: unknown }>
        tools?: Array<{ function?: { name?: string } }>
      }
      const tool = payload.tools?.[0]?.function?.name ?? ''
      const hasImage = JSON.stringify(payload.messages ?? []).includes('image_url')
      requests.push({ hasImage, tool })
      if (hasImage) {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '蓝色' } }] }))
        return
      }
      if (tool) {
        const args = tool === 'get_color' ? { color: '蓝色' } : {}
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', tool_calls: [{ type: 'function', function: { name: tool, arguments: JSON.stringify(args) } }] } }] }))
        return
      }
      if (payload.stream) {
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'OK' } }] })}\n\ndata: [DONE]\n\n`)
        return
      }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'OK' } }] }))
    })
  })
  await listenHttp(server)
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No vision listener')
  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    requests,
    imageRequests: () => requests.filter((item) => item.hasImage).length,
    async close() {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
  }
}

function captureFailed(analysis: ScreenAnalysis): boolean {
  return !analysis.image && /无法|未找到|没有找到|未采集|窗口|权限/.test(`${analysis.summary} ${analysis.refusal}`)
}

test.describe('[FULL-QA] 屏幕采集与外发同意边界', () => {
  test('[SCREEN-05] 采集不可用/未授权外发都不向模型发送图像；采集可用时授权后才发送', async () => {
    test.setTimeout(180_000)
    const server = await startVisionServer()
    const app = await launchApp()
    // 采集会隐藏自身窗口并读取系统前台窗口；开一个真实 Notepad 作为可采集前台窗口。
    const notepad = spawn('notepad.exe', [], { detached: true, stdio: 'ignore' })
    notepad.unref()
    const notepadPid = notepad.pid ?? 0
    await new Promise((resolve) => setTimeout(resolve, 1500))
    try {
      const page = await findMainPage(app)
      await page.evaluate(async ({ url }) => {
        const created = await window.murasame.core.createModel()
        if (!created.ok) throw new Error(created.error)
        const saved = await window.murasame.core.saveModel(created.data.id, {
          name: '视觉边界测试', provider: 'openai', endpoint: url, key: 'test-key', model: 'test-model', caps: ['chat', 'vision']
        })
        if (!saved.ok) throw new Error(saved.error)
        const verified = await window.murasame.core.verifyModel(created.data.id)
        if (!verified.ok) throw new Error(verified.error)
        const enabled = await window.murasame.core.setDefaultModel(created.data.id)
        if (!enabled.ok) throw new Error(enabled.error)
        await window.murasame.settings.update({ permissions: { screen: true, microphone: false, accessibility: false }, outboundImages: false })
      }, { url: server.url })

      const visionVerified = await page.evaluate(async () => {
        const state = await window.murasame.core.getBootstrap()
        const model = state.ok ? state.data.models.find((item) => item.default) : undefined
        return Boolean(model?.capabilities.some((capability) => capability.id === 'vision.image-input' && capability.status === 'verified'))
      })
      expect(visionVerified).toBe(true)
      const imageRequestsAfterProbe = server.imageRequests()

      const denied = await page.evaluate(() => window.murasame.core.analyzeScreen())
      expect(denied.ok).toBe(true)
      const deniedAnalysis = denied.ok ? denied.data : null
      expect(deniedAnalysis).toBeTruthy()
      if (captureFailed(deniedAnalysis!)) {
        test.info().annotations.push({ type: 'capture-unavailable', description: deniedAnalysis!.summary || deniedAnalysis!.refusal })
        expect(`${deniedAnalysis!.summary}${deniedAnalysis!.refusal}`).toMatch(/[\u4e00-\u9fff]/)
        // 降级路径也绝不能把图像发给模型，且页面继续可用。
        expect(server.imageRequests()).toBe(imageRequestsAfterProbe)
        await page.getByTestId('nav-memory').click()
        await expect(page.getByTestId('nav-memory')).toBeVisible()
        return
      }
      expect(deniedAnalysis!.image).toBe('captured')
      expect(`${deniedAnalysis!.summary} ${deniedAnalysis!.refusal}`).toContain('未授权')
      expect(server.imageRequests()).toBe(imageRequestsAfterProbe)

      await page.evaluate(() => window.murasame.settings.update({ outboundImages: true }))
      const allowed = await page.evaluate(() => window.murasame.core.analyzeScreen())
      expect(allowed.ok).toBe(true)
      const allowedAnalysis = allowed.ok ? allowed.data : null
      if (captureFailed(allowedAnalysis!)) return
      expect(server.imageRequests()).toBe(imageRequestsAfterProbe + 1)
      expect(allowedAnalysis!.confidence).toBe('模型')
      expect(allowedAnalysis!.summary).toBe('蓝色')
    } finally {
      await closeApp(app)
      await server.close()
      if (notepadPid) spawnSync('taskkill', ['/PID', String(notepadPid), '/T', '/F'], { windowsHide: true })
    }
  })
})
