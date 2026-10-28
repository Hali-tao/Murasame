import { desktopCapturer } from 'electron'
import { randomUUID } from 'node:crypto'
import { writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { captureAllowed, watchDecision, type WindowFacts } from '../local/screen-policy'
import { readForegroundAsync } from '../local/uia'
import { recognizeImageAsync } from '../local/ocr'
import { getSettings } from '../settings'
import { getMainWindow, getPetWindow, getMainVisibilityRevision } from '../windows'
import { featureState } from '../../shared/feature-matrix'
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
    return { enabled: s.screenWatchEnabled, intervalSeconds: s.screenWatchSeconds, hidden: selfHidden ? !visibleMain : !main?.isVisible(), doNotDisturb: s.doNotDisturb, locked: input.locked(), authorized: s.permissions.screen, failures: service.failures }
  }
  const guard = (send = false): void => {
    if (input.signal.aborted) { policyStopped = true; input.signal.throwIfAborted() }
    const s = getSettings()
    if (!s.permissions.screen || input.locked()) { policyStopped = true; throw new Error('屏幕授权已撤销或系统已锁定，采集已停止') }
    if (getMainVisibilityRevision() !== visibilityRevision) { policyStopped = true; throw new Error('用户已改变窗口显示状态，采集已停止') }
    if (input.continuous) { const decision = watchDecision(watch()); if (!decision.run) { policyStopped = true; throw new Error(decision.reason) } }
    if (send && !s.outboundImages) { policyStopped = true; throw new Error('图片外发授权已撤销，没有发送画面') }
  }
  let facts: WindowFacts = { title: '', processName: '', passwordField: false, displayAffinity: 0, tree: '', selectedText: '', sensitiveScanComplete: false }
  let captureError = ''; let image: string; let ocrText: string; let modelSummary = ''; let generateMs = 0; let waitMs = 0; let resolution = ''
  const started = Date.now()
  try {
    guard()
    selfHidden = true
    if (visibleMain) main?.hide()
    if (visiblePet) pet?.hide()
    await new Promise(resolve => setTimeout(resolve, 160))
    guard()
    facts = await readForegroundAsync(undefined, input.signal)
    guard()
    const decision = captureAllowed({ authorized: true, revoked: false, window: facts })
    if (!decision.capture) throw new Error(decision.reason)
    if (!facts.bounds) throw new Error('无法确定目标窗口范围，没有改为采集整个屏幕')
    if (!facts.windowId || ![facts.bounds.width, facts.bounds.height].every(value => Number.isFinite(value) && value >= 40 && value <= 16384)) throw new Error('无法确定目标窗口身份或尺寸，没有改为整屏采集')
    const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: Math.round(facts.bounds.width), height: Math.round(facts.bounds.height) } })
    guard()
    const full = sources.find(source => source.id.split(':')[0] === 'window' && source.id.split(':')[1] === facts.windowId)?.thumbnail
    if (!full || full.isEmpty()) throw new Error('未找到可采集的目标窗口，没有改为整屏采集')
    const current = await readForegroundAsync(undefined, input.signal)
    guard()
    if (!captureAllowed({ authorized: true, revoked: false, window: current }).capture || current.windowId !== facts.windowId || current.processId !== facts.processId || current.title !== facts.title || current.processName !== facts.processName || JSON.stringify(current.bounds) !== JSON.stringify(facts.bounds)) throw new Error('采集过程中前台窗口发生变化，请重试')
    const png = full.toPNG()
    const size = full.getSize()
    resolution = `${size.width} × ${size.height}`
    image = png.toString('base64')
    const shot = join(tmpdir(), `murasame-ocr-${randomUUID()}.png`)
    try {
      await writeFile(shot, png, { flag: 'wx' })
      ocrText = await recognizeImageAsync(shot, undefined, input.signal).catch(() => '')
      guard()
    } finally { await rm(shot, { force: true }) }
  } catch (error) {
    captureError = error instanceof Error ? error.message : '无法采集目标窗口'
    image = ''; ocrText = ''
  } finally {
    if (visibleMain && !input.locked() && getMainVisibilityRevision() === visibilityRevision && !main?.isDestroyed()) main?.showInactive()
    if (visiblePet && !input.locked() && getSettings().petVisible && !pet?.isDestroyed()) pet?.showInactive()
    selfHidden = false
  }
  const captureMs = Date.now() - started
  const model = models.list().find(item => item.default)
  const vision = featureState(model?.capabilities, 'screen')
  let visionError = !vision.available ? '当前模型不支持图像' : !getSettings().outboundImages ? '未授权将截图发给模型' : ''
  if (image && vision.available && getSettings().outboundImages) {
    const begin = Date.now()
    try {
      guard(true)
      modelSummary = await models.describeImage(image, `${facts.title}\n${ocrText}`.slice(0, 2000), { signal: input.signal, beforeSend: () => guard(true), onDispatch: (elapsed) => { waitMs += elapsed } })
      guard(true)
    } catch (error) { visionError = error instanceof Error ? error.message : '看图模型未返回结果'; modelSummary = '' }
    generateMs = Math.max(0, Date.now() - begin - waitMs)
  }
  const live = getSettings()
  return service.analyze({ authorized: live.permissions.screen, revoked: !live.permissions.screen || input.signal.aborted, window: facts, elements: [], ocrText, imageCaptured: Boolean(image), resolution, visionAvailable: Boolean(modelSummary), visionError, captureError, captureSkipped: policyStopped, watch: watch(), supplemented: false, timings: { captureMs, waitMs, generateMs }, modelSummary })
}
