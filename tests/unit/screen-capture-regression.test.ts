import { beforeEach, expect, it, vi } from 'vitest'
const f = vi.hoisted(() => ({
  settings: { screenCaptureMode: 'window', permissions: { screen: true }, outboundImages: true, screenWatchEnabled: true, screenWatchSeconds: 15, doNotDisturb: false, petVisible: true },
  visible: true, revision: 0, locked: false,
  ocr: vi.fn(), selectRegion: vi.fn(), foreground: vi.fn(), sources: vi.fn(), describe: vi.fn(), crop: vi.fn(), restore: vi.fn()
}))
vi.mock('../../src/main/core/region-selector', () => ({ selectScreenRegion: f.selectRegion }))
vi.mock('electron', () => ({ desktopCapturer: { getSources: f.sources }, screen: { getAllDisplays: () => [{ id: 7, bounds: { x: -1920, y: 0, width: 1920, height: 1080 } }], dipToScreenRect: (_: unknown, b: unknown) => b } }))
vi.mock('../../src/main/settings', () => ({ getSettings: () => f.settings }))
vi.mock('../../src/main/windows', () => ({ getMainVisibilityRevision: () => f.revision, getMainWindow: () => ({ isVisible: () => f.visible, hide: () => { f.visible = false }, showInactive: () => { f.restore(); f.visible = true }, isDestroyed: () => false }), getPetWindow: () => null }))
vi.mock('../../src/main/local/uia', () => ({ readForegroundAsync: f.foreground }))
vi.mock('../../src/main/local/screen-ocr', () => ({ recognizeScreenText: f.ocr }))
vi.mock('../../src/shared/feature-matrix', () => ({ featureState: () => ({ available: true }) }))
import { captureScreen } from '../../src/main/core/screen-capture'
import { ScreenService } from '../../src/main/core/services/screen-service'
import type { ModelService } from '../../src/main/core/services/model-service'
const facts = { title: 'test', processName: 'fixture', windowId: '1', processId: 10, passwordField: false, sensitiveScanComplete: true, displayAffinity: 0, tree: '', selectedText: '', bounds: { x: -1800, y: 100, width: 400, height: 300 } }
const models = { list: () => [{ default: true }], analyzeOcrText: f.describe } as unknown as ModelService
const run = (continuous = false) => captureScreen(new ScreenService(), models, { continuous, locked: () => f.locked, signal: new AbortController().signal })
beforeEach(() => {
  vi.clearAllMocks(); f.visible = true; f.revision = 0; f.locked = false
  Object.assign(f.settings, { screenCaptureMode: 'window', outboundImages: true, screenWatchEnabled: true, doNotDisturb: false }); f.settings.permissions.screen = true
  f.foreground.mockResolvedValue(facts)
  f.crop.mockReturnValue({ toPNG: () => Buffer.from('fixture') })
  f.sources.mockResolvedValue([{ id: 'window:99:0', thumbnail: {} }, { id: 'window:1:0', thumbnail: { isEmpty: () => false, getSize: () => ({ width: 400, height: 300 }), toPNG: () => Buffer.from('fixture'), crop: f.crop } }])
  f.selectRegion.mockResolvedValue({ toPNG: () => Buffer.from('cropped-only'), getSize: () => ({ width: 120, height: 80 }) })
  f.ocr.mockResolvedValue({ text: '中文识别结果', engine: 'ppocrv5', detail: '本地识别' })
  f.describe.mockResolvedValue('这是模型返回的分析。')
})
it('region OCR and model analysis use only the confirmed crop, never foreground text', async () => {
  f.settings.screenCaptureMode = 'region'
  f.selectRegion.mockResolvedValue({ toPNG: () => Buffer.from('cropped-only'), getSize: () => ({ width: 120, height: 80 }) })
  const result = await run()
  expect(f.foreground).not.toHaveBeenCalled()
  expect(f.sources).not.toHaveBeenCalled()
  expect(f.describe.mock.calls[0][0]).toBe('中文识别结果')
  expect(result.ok && result.data.summary).toBe('这是模型返回的分析。')
  expect(result.ok && result.data.bullets).toEqual([])
  expect(result.ok && result.data.resolution).toBe('120 × 80')
  expect(result.ok && result.data.previewDataUrl).toBe(`data:image/png;base64,${Buffer.from('cropped-only').toString('base64')}`)
})
it('cancelling a region neither analyzes nor consumes the failure fuse', async () => {
  f.settings.screenCaptureMode = 'region'; f.selectRegion.mockResolvedValue(null)
  const result = await run()
  expect(result.ok && result.data.cancelled).toBe(true)
  expect(f.describe).not.toHaveBeenCalled()
})
it('continuous observation never opens an interactive selector', async () => {
  f.settings.screenCaptureMode = 'region'
  await run(true)
  expect(f.selectRegion).not.toHaveBeenCalled()
  expect(f.foreground).not.toHaveBeenCalled()
})
it('revocation after selection prevents OCR and model dispatch', async () => {
  f.settings.screenCaptureMode = 'region'
  f.selectRegion.mockImplementation(async () => { f.settings.permissions.screen = false; return { toPNG: () => Buffer.from('no') } })
  await run()
  expect(f.describe).not.toHaveBeenCalled()
})

it('old window settings still require an explicitly selected crop', async () => {
  f.settings.screenCaptureMode = 'window'
  const result = await run()
  expect(f.selectRegion).toHaveBeenCalledOnce()
  expect(f.sources).not.toHaveBeenCalled()
  expect(f.foreground).not.toHaveBeenCalled()
  expect(result.ok && result.data.resolution).toBe('120 × 80')
  expect(result.ok && result.data.previewDataUrl).toBe(`data:image/png;base64,${Buffer.from('cropped-only').toString('base64')}`)
})
it('rejects locked capture without opening a selector', async () => {
  f.locked = true
  await run()
  expect(f.selectRegion).not.toHaveBeenCalled()
  expect(f.describe).not.toHaveBeenCalled()
})
it('checks permission when queued model work is about to send', async () => {
  f.describe.mockImplementation(async (_text, control) => { f.settings.permissions.screen = false; control.beforeSend(); return 'should not send' })
  const result = await run()
  expect(result.ok && result.data.summary).toContain('授权')
  expect(result.ok && result.data.summary).not.toContain('should not send')
})
it('a user hide invalidates selection without restoring the hidden window', async () => {
  f.selectRegion.mockImplementation(async () => { f.revision++; return { toPNG: () => Buffer.from('no') } })
  const service = new ScreenService()
  await captureScreen(service, models, { continuous: false, locked: () => false, signal: new AbortController().signal })
  expect(f.describe).not.toHaveBeenCalled()
  expect(f.restore).not.toHaveBeenCalled()
  expect(service.failures).toBe(0)
})

it('analyzes OCR text even when screenshot outbound is disabled', async () => {
  f.settings.outboundImages = false
  const result = await run()
  expect(f.describe).toHaveBeenCalledOnce()
  expect(result.ok && result.data.summary).toBe('这是模型返回的分析。')
})
it('empty OCR never sends a model request and retains preview', async () => {
  f.ocr.mockResolvedValue({ text: '', engine: 'windows', detail: '' })
  const result = await run()
  expect(f.describe).not.toHaveBeenCalled()
  expect(result.ok && result.data.summary).toContain('未识别到文字')
  expect(result.ok && result.data.previewDataUrl).toMatch(/^data:image/)
})
it('API failure never substitutes rule-based analysis for a model reply', async () => {
  f.ocr.mockResolvedValue({ text: 'TypeError: test.js:12 failure', engine: 'ppocrv5', detail: '' })
  f.describe.mockRejectedValue(new Error('受控 API 错误'))
  const result = await run()
  expect(result.ok && result.data.summary).toBe('受控 API 错误')
  expect(result.ok && result.data.needsTaskConfirm).toBe(false)
})
