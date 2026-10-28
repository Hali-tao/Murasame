import { beforeEach, describe, expect, it, vi } from 'vitest'
const f = vi.hoisted(() => ({
  settings: { permissions: { screen: true }, outboundImages: true, screenWatchEnabled: true, screenWatchSeconds: 15, doNotDisturb: false, petVisible: true },
  visible: true, revision: 0, locked: false,
  foreground: vi.fn(), sources: vi.fn(), describe: vi.fn(), crop: vi.fn(), restore: vi.fn()
}))
vi.mock('electron', () => ({ desktopCapturer: { getSources: f.sources }, screen: { getAllDisplays: () => [{ id: 7, bounds: { x: -1920, y: 0, width: 1920, height: 1080 } }], dipToScreenRect: (_: unknown, b: unknown) => b } }))
vi.mock('../../src/main/settings', () => ({ getSettings: () => f.settings }))
vi.mock('../../src/main/windows', () => ({ getMainVisibilityRevision: () => f.revision, getMainWindow: () => ({ isVisible: () => f.visible, hide: () => { f.visible = false }, showInactive: () => { f.restore(); f.visible = true }, isDestroyed: () => false }), getPetWindow: () => null }))
vi.mock('../../src/main/local/uia', () => ({ readForegroundAsync: f.foreground }))
vi.mock('../../src/main/local/ocr', () => ({ recognizeImageAsync: async () => '' }))
vi.mock('../../src/shared/feature-matrix', () => ({ featureState: () => ({ available: true }) }))
import { captureScreen } from '../../src/main/core/screen-capture'
import { ScreenService } from '../../src/main/core/services/screen-service'
import type { ModelService } from '../../src/main/core/services/model-service'
const facts = { title: 'test', processName: 'fixture', windowId: '1', processId: 10, passwordField: false, sensitiveScanComplete: true, displayAffinity: 0, tree: '', selectedText: '', bounds: { x: -1800, y: 100, width: 400, height: 300 } }
const models = { list: () => [{ default: true }], describeImage: f.describe } as unknown as ModelService
const run = (continuous = false) => captureScreen(new ScreenService(), models, { continuous, locked: () => f.locked, signal: new AbortController().signal })
beforeEach(() => {
  vi.clearAllMocks(); f.visible = true; f.revision = 0; f.locked = false
  Object.assign(f.settings, { outboundImages: true, screenWatchEnabled: true, doNotDisturb: false }); f.settings.permissions.screen = true
  f.foreground.mockResolvedValue(facts)
  f.crop.mockReturnValue({ toPNG: () => Buffer.from('fixture') })
  f.sources.mockResolvedValue([{ id: 'window:99:0', thumbnail: {} }, { id: 'window:1:0', thumbnail: { isEmpty: () => false, getSize: () => ({ width: 400, height: 300 }), toPNG: () => Buffer.from('fixture'), crop: f.crop } }])
  f.describe.mockResolvedValue('看到了图表。')
})
describe('live capture boundaries', () => {
  it('never captures during a hidden continuous watch', async () => {
    f.visible = false
    const result = await run(true)
    expect(result.ok && result.data.refusal).toContain('隐藏')
    expect(f.foreground).not.toHaveBeenCalled(); expect(f.sources).not.toHaveBeenCalled()
  })
  it('rechecks lock after foreground discovery', async () => {
    f.foreground.mockImplementation(async () => { f.locked = true; return facts })
    await run()
    expect(f.sources).not.toHaveBeenCalled(); expect(f.restore).not.toHaveBeenCalled()
  })
  it('unknown target bounds never fall back to a full screen', async () => {
    f.foreground.mockResolvedValue({ ...facts, bounds: undefined })
    await run()
    expect(f.sources).not.toHaveBeenCalled(); expect(f.describe).not.toHaveBeenCalled()
  })
  it('matches native window identity even on a negative-coordinate monitor', async () => {
    const result = await run()
    expect(f.sources).toHaveBeenCalledWith({ types: ['window'], thumbnailSize: { width: 400, height: 300 } })
    expect(f.crop).not.toHaveBeenCalled()
    expect(result.ok && result.data.summary).toBe('看到了图表。')
    expect(result.ok && result.data.resolution).toBe('400 × 300')
  })
  it('rejects same title/bounds on a different native window', async () => {
    f.foreground.mockResolvedValueOnce(facts).mockResolvedValueOnce({ ...facts, windowId: '2' })
    const result = await run()
    expect(result.ok && result.data.refusal).toContain('变化')
    expect(f.crop).not.toHaveBeenCalled(); expect(f.describe).not.toHaveBeenCalled()
  })
  it('checks permission again when queued model work is about to send', async () => {
    f.describe.mockImplementation(async (_image, _hint, control) => { f.settings.outboundImages = false; control.beforeSend(); return 'should not send' })
    const result = await run()
    expect(result.ok && result.data.summary).toContain('撤销')
    expect(result.ok && result.data.summary).not.toContain('should not send')
  })
  it('does not restore a window explicitly hidden by the user during capture', async () => {
    f.sources.mockImplementation(async () => { f.revision++; throw new Error('fixture stop') })
    await run()
    expect(f.restore).not.toHaveBeenCalled()
  })
})

it('a user hide invalidates the capture before screenshot and does not consume the failure fuse', async () => {
  f.foreground.mockImplementation(async () => { f.revision++; return facts })
  const service = new ScreenService()
  const result = await captureScreen(service, models, { continuous: true, locked: () => false, signal: new AbortController().signal })
  expect(f.sources).not.toHaveBeenCalled()
  expect(result.ok && result.data.refusal).toContain('显示状态')
  expect(service.failures).toBe(0)
})
