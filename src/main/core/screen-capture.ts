import { selectScreenRegion } from './region-selector'
import { type WindowFacts } from '../local/screen-policy'
import { recognizeScreenText } from '../local/screen-ocr'
import { getSettings } from '../settings'
import { getMainWindow, getPetWindow, getMainVisibilityRevision } from '../windows'
import type { ScreenService } from './services/screen-service'
import type { ModelService } from './services/model-service'

export async function captureScreen(service: ScreenService, models: ModelService, input: { continuous: boolean; locked: () => boolean; signal: AbortSignal }) {
  const main = getMainWindow(); const pet = getPetWindow()
  const visibleMain = Boolean(main?.isVisible()); const visiblePet = Boolean(pet?.isVisible())
  const visibilityRevision = getMainVisibilityRevision()
  let selfHidden = false
  let policyStopped = false
  const watch = () => {
    const s = getSettings()
    return { enabled: false, intervalSeconds: s.screenWatchSeconds, hidden: selfHidden ? !visibleMain : !main?.isVisible(), doNotDisturb: s.doNotDisturb, locked: input.locked(), authorized: s.permissions.screen, failures: service.failures }
  }
  const guard = (): void => {
    if (input.signal.aborted) { policyStopped = true; input.signal.throwIfAborted() }
    const s = getSettings()
    if (!s.permissions.screen || input.locked()) { policyStopped = true; throw new Error('屏幕授权已撤销或系统已锁定，采集已停止') }
    if (getMainVisibilityRevision() !== visibilityRevision) { policyStopped = true; throw new Error('用户已改变窗口显示状态，采集已停止') }
    if (input.continuous) { policyStopped = true; throw new Error('已停用持续观察，请手动框选区域') }
  }
  let facts: WindowFacts = { title: '', processName: '', passwordField: false, displayAffinity: 0, tree: '', selectedText: '', sensitiveScanComplete: false }
  let captureError = ''; let image: string; let ocrText: string; let modelSummary = ''; let generateMs = 0; let waitMs = 0; let resolution = ''
  const started = Date.now()
  let ocrEngine: 'ppocrv5' | 'windows' | 'unavailable' = 'unavailable'
  let ocrDetail = ''
  try {
    guard()
    selfHidden = true
    if (visibleMain) main?.hide()
    if (visiblePet) pet?.hide()
    await new Promise(resolve => setTimeout(resolve, 160))
    guard()
    const full = await selectScreenRegion(input.signal, guard)
    guard()
    if (!full) return { ok: true as const, data: { cancelled: true, title: '', confidence: '未采集', summary: '', bullets: [], action: '', sourceWindow: '', resolution: '', capturedAt: '', continuous: false } }
    // Never include window text outside the confirmed crop.
    facts = { title: '手动框选区域', processName: '屏幕区域', passwordField: false, displayAffinity: 0, tree: '', selectedText: '', sensitiveScanComplete: false }
    const png = full.toPNG()
    const size = full.getSize()
    resolution = `${size.width} × ${size.height}`
    image = png.toString('base64')
    try {
      const recognized = await recognizeScreenText(png, input.signal)
      ocrText = recognized.text; ocrEngine = recognized.engine; ocrDetail = recognized.detail
    } catch { ocrText = ''; ocrDetail = '本机文字识别未完成，可检查 OCR 模型或重新框选。' }
    guard()
  } catch (error) {
    captureError = error instanceof Error ? error.message : '无法采集选中区域'
    image = ''; ocrText = ''
  } finally {
    if (visibleMain && !input.locked() && getMainVisibilityRevision() === visibilityRevision && !main?.isDestroyed()) main?.showInactive()
    if (visiblePet && !input.locked() && getSettings().petVisible && !pet?.isDestroyed()) pet?.showInactive()
    selfHidden = false
  }
  const captureMs = Date.now() - started
  let analysisError = !ocrText.trim() ? (ocrEngine === 'unavailable' ? '本机文字识别未完成，请检查 OCR 模型后重试。' : '未识别到文字，请重新框选包含清晰文字的区域。') : ''
  if (ocrText.trim() && !captureError) {
    const begin = Date.now()
    try {
      guard()
      modelSummary = await models.analyzeOcrText(ocrText, { signal: input.signal, beforeSend: guard, onDispatch: (elapsed) => { waitMs += elapsed } })
      guard()
    } catch (error) { analysisError = error instanceof Error ? error.message : '文字分析请求失败，请重试。'; modelSummary = '' }
    generateMs = Math.max(0, Date.now() - begin - waitMs)
  }
  const live = getSettings()
  const result = await service.analyze({ userSelectedRegion: Boolean(image), authorized: live.permissions.screen, revoked: !live.permissions.screen || input.signal.aborted, window: facts, elements: [], ocrText, imageCaptured: Boolean(image), resolution, textAnalysis: { response: modelSummary, error: analysisError }, visionAvailable: false, visionError: '', captureError, captureSkipped: policyStopped, watch: watch(), supplemented: false, timings: { captureMs, waitMs, generateMs }, modelSummary })
  if (result.ok && image && live.permissions.screen && !input.signal.aborted && !input.locked() && !policyStopped) {
    result.data.ocrEngine = ocrEngine
    result.data.ocrDetail = ocrDetail
    result.data.previewDataUrl = `data:image/png;base64,${image}`
    result.data.resolution = resolution
    result.data.capturedAt ||= new Date(started).toISOString()
  }
  return result
}
