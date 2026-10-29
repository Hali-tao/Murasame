import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { AppError } from '../shared/errors'
import { NotImplementedError } from './core/errors'
import { IPC } from '../shared/ipc'
import {
  characterImportSchema,
  characterSchema,
  deleteConversationSchema,
  idSchema,
  ignoreMouseSchema,
  petChatSchema,
  memoryAddSchema,
  memoryDeleteSchema,
  memoryUpdateSchema,
  modelSaveSchema,
  modelVerifySchema,
  petPositionSchema,
  petScaleSchema,
  sendMessageSchema,
  settingsPatchSchema,
  taskCreateSchema,
  toolToggleSchema
} from '../shared/schemas'
import { MurasameCore as DesktopCore } from './core/murasame-core'
import type { AutonomyState } from './core/services/autonomy-service'
import type {
  AppInfo,
  AppSettings,
  BootstrapData,
  CharacterProfile,
  Conversation,
  DeleteScope,
  MemoryEntry,
  ModelInput,
  ModelProfile,
  Result,
  ScreenAnalysis,
  Task,
  ToolCapability
} from '../shared/types'
import { getDatabase } from './data/db'
import { databasePath } from './data/capacity'
import { getUserDataDir } from './data/keys'
import { mergeImportedBundle } from './data/merge-bundle'
import { exportBundle, importBundle, stripSecrets } from './data/portability'
import { importCharacterDirectory } from './core/services/asset-service'
import { applyHotkey, readHotkey } from './hotkey-status'
import { buildIsolationImage, ensureDocker, friendlyBuildLine, isolationEnvironmentAsync } from './isolation/docker-runtime'
import { relationshipVoice, resetRelationship, startNewLine, type RelationshipRecord } from './core/services/relationship-service'
import { readRelationship, writeRelationship } from './settings'
import log from './logger'
import { learnVerifiedImageSkill } from './agent/learn-verified-image-skill'
import { performanceCue } from './core/performance-cue'
import { petSpeech } from '../shared/pet-speech'
import { checkForUpdates } from './updater'
import { getSettings, onSettingsChanged, updateSettings } from './settings'
import {
  getMainWindow,
  getPetBounds,
  getPetStateSafe,
  hideMain,
  hidePet,
  refreshPetState,
  resetPetPosition,
  confirmQuit,
  broadcastPetPerformance,
  focusPetChat,
  setPetChatOpen,
  beginPetDrag,
  movePetDrag,
  endPetDrag,
  setPetMousePassthrough,
  setPetPosition,
  setPetScale,
  openMainPath,
  showMain,
  showPet,
  togglePet
} from './windows'

let registered = false

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload)
  }
}

function validationError(error: z.ZodError): string {
  const field = error.issues[0]?.path.join('.')
  return field ? `请求参数无效：${field}` : '请求参数无效'
}

function redact(message: string): string {
  return message
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-••••')
    .replace(/(api[-_ ]?key\s*[:=]\s*)\S+/gi, '$1••••')
}

function errorMessage(error: unknown): string {
  if (error instanceof NotImplementedError) {
    const appError = new AppError(
      'NOT_IMPLEMENTED',
      '尚未实现',
      error.message,
      '请改用当前已经可用的功能，或稍后再试。',
      false,
      { cause: error }
    )
    log.error(appError.code, appError.category)
    return appError.toUserText()
  }
  if (error instanceof AppError) {
    log.error(error.code, error.category)
    return redact(error.toUserText())
  }
  const message = error instanceof Error ? error.message : '操作失败，请稍后重试'
  return redact(message)
}

function handleCore<T>(
  channel: string,
  schema: z.ZodTypeAny,
  action: (input: unknown) => Promise<Result<T>>
): void {
  ipcMain.handle(channel, async (_event, raw: unknown): Promise<Result<T>> => {
    const parsed = schema.safeParse(raw)
    if (!parsed.success) return { ok: false, error: validationError(parsed.error) }
    try {
      return await action(parsed.data)
    } catch (error) {
      log.error(`Core IPC failed: ${channel}`, error)
      return { ok: false, error: errorMessage(error) }
    }
  })
}

function applyLoginSetting(settings: AppSettings): void {
  app.setLoginItemSettings({
    openAtLogin: settings.startAtLogin,
    args: ['--hidden']
  })
}

function syncPetSettings(previous: AppSettings, next: AppSettings): void {
  if (previous.petVisible !== next.petVisible) {
    if (next.petVisible) showPet()
    else hidePet()
  }
  if (previous.petScale !== next.petScale) setPetScale(next.petScale)
  if (previous.petPreset !== next.petPreset) refreshPetState()
}

export function registerIpcHandlers(core: DesktopCore): void {
  if (registered) return
  registered = true
  let isolationPrepare: Promise<{ ok: boolean; detail: string }> | null = null
  let prepareController: AbortController | null = null
  let prepareGeneration = 0
  const autonomyViewState = (state: AutonomyState): AutonomyState => {
    // Preparing an image is separate from an existing live or uncleaned activity.
    if (!isolationPrepare || state.running || state.canStop) return state
    const cancelling = prepareController?.signal.aborted === true
    return { ...state, activityId: '', goal: '', kind: undefined, creation: undefined, result: undefined, viewUrl: '', running: false,
      phase: cancelling ? 'stopping' : 'preparing', canStop: true, busy: true,
      reason: cancelling ? '正在取消隔离环境准备。' : '正在准备隔离环境，离开页面不会中断；可停止准备。' }
  }
  const publishAutonomy = (state = core.autonomy.status()): void => {
    try { broadcast(IPC.autonomy.updated, autonomyViewState(state)) }
    catch { /* A renderer may close while a state update is being delivered. */ }
  }
  core.autonomy.subscribe(publishAutonomy)
  const privacyKey = (): string => JSON.stringify([getSettings().permissions.screen, getSettings().outboundImages, getSettings().doNotDisturb, getSettings().screenWatchEnabled])
  let previousPrivacy = privacyKey()
  core.onScreenAnalysis = analysis => broadcast(IPC.core.screenUpdated, analysis)
  core.onConversationUpdate = conversation => broadcast(IPC.core.conversationUpdated, conversation)
  core.memory.subscribe(() => broadcast(IPC.core.memoriesUpdated, core.memory.list()))
  core.subscribeModels(models => broadcast(IPC.core.modelsUpdated, models))
  core.memory.subscribeIndex(status => broadcast(IPC.core.memoryIndexStatus, status))
  core.onMemoryExtractionStatus = status => broadcast(IPC.core.memoryExtractionStatus, status)

  const presentedTaskStates = new Map<string, string>()
  core.tasks.onChange((task) => {
    try { learnVerifiedImageSkill(app.getPath('userData'), task) } catch (error) { log.warn('任务已记录，可复用步骤未保存', error) }
    broadcast(IPC.core.taskUpdated, task)
    // Per-file progress must not restart the character animation or invalidate
    // the reply's presentation analysis hundreds of times during one task.
    if (presentedTaskStates.get(task.id) === task.status) return
    presentedTaskStates.set(task.id, task.status)
    if (presentedTaskStates.size > 100) presentedTaskStates.delete(presentedTaskStates.keys().next().value!)
    core.invalidatePresentation()
    if (getSettings().doNotDisturb) return
    const intent = task.status === '已完成' ? '开心' : task.status === '失败' ? '困惑' : '思考'
    const preset = getSettings().petPreset
    const cue = performanceCue(preset, intent, core.affect.pad)
    if (preset === 'naiwa' && task.status === '执行中') { cue.motion = 'Working'; cue.expression = null }
    broadcastPetPerformance({ ...cue, text: petSpeech('任务「' + task.title + '」' + task.status + '。' + (task.result.split('\n')[0] || task.summary)) })
  })

  onSettingsChanged(settings => {
    core.syncMemoryPolicy()
    const nextPrivacy = privacyKey()
    if (nextPrivacy !== previousPrivacy) { core.cancelSensitiveRequests(); previousPrivacy = nextPrivacy }
    broadcast(IPC.settings.changed, settings)
  })

  ipcMain.handle(IPC.app.getInfo, (): AppInfo => {
    return {
      version: app.getVersion(),
      platform: process.platform,
      isPackaged: app.isPackaged,
      logsPath: app.getPath('logs'),
      userDataPath: app.getPath('userData')
    }
  })

  ipcMain.handle(IPC.app.quit, () => confirmQuit())

  ipcMain.handle(IPC.app.hideToTray, () => hideMain())

  ipcMain.handle(IPC.app.openLogs, async () => {
    const failure = await shell.openPath(app.getPath('logs'))
    if (failure) throw new Error(failure)
  })

  ipcMain.handle(IPC.app.openUserData, async () => {
    const failure = await shell.openPath(app.getPath('userData'))
    if (failure) throw new Error(failure)
  })

  ipcMain.handle(IPC.app.clearLogs, () => {
    log.transports.file.getFile().clear()
    log.info('Application logs cleared by user')
  })

  ipcMain.handle(IPC.app.pickOpen, async (_event, raw: unknown) => {
    const value = (raw ?? {}) as { title?: string; directory?: boolean; filters?: Array<{ name: string; extensions: string[] }> }
    const result = await dialog.showOpenDialog({
      title: value.title,
      properties: value.directory ? ['openDirectory'] : ['openFile'],
      filters: value.filters
    })
    return result.canceled ? null : result.filePaths[0] ?? null
  })

  ipcMain.handle(IPC.app.hotkey, () => readHotkey())

  ipcMain.handle(IPC.app.pickSave, async (_event, raw: unknown) => {
    const value = (raw ?? {}) as { title?: string; defaultPath?: string }
    const result = await dialog.showSaveDialog({
      title: value.title,
      defaultPath: value.defaultPath
    })
    return result.canceled ? null : result.filePath ?? null
  })

  ipcMain.handle(IPC.window.showMain, () => showMain())
  ipcMain.handle(IPC.window.hideMain, () => hideMain())
  ipcMain.handle(IPC.window.minimize, () => getMainWindow()?.minimize())
  ipcMain.handle(IPC.window.openPath, (_event, raw: unknown) => {
    const path = typeof raw === 'string' ? raw : ''
    openMainPath(path)
  })

  ipcMain.handle(IPC.pet.show, () => showPet())
  ipcMain.handle(IPC.pet.hide, () => hidePet())
  ipcMain.handle(IPC.pet.toggle, () => togglePet())
  ipcMain.handle(IPC.pet.getState, () => getPetStateSafe())
  ipcMain.handle(IPC.pet.getBounds, () => getPetBounds())
  ipcMain.handle(IPC.pet.resetPosition, () => resetPetPosition())

  ipcMain.handle(IPC.pet.setScale, (_event, raw: unknown) => {
    const parsed = petScaleSchema.safeParse(raw)
    if (!parsed.success) throw new Error(validationError(parsed.error))
    return setPetScale(parsed.data.scale)
  })

  ipcMain.handle(IPC.pet.setPosition, (_event, raw: unknown) => {
    const parsed = petPositionSchema.safeParse(raw)
    if (!parsed.success) throw new Error(validationError(parsed.error))
    return setPetPosition(parsed.data.x, parsed.data.y)
  })

  ipcMain.handle(IPC.pet.setIgnoreMouseEvents, (_event, raw: unknown) => {
    const parsed = ignoreMouseSchema.safeParse(raw)
    if (!parsed.success) throw new Error(validationError(parsed.error))
    setPetMousePassthrough(parsed.data.ignore)
  })

  ipcMain.handle(IPC.pet.setChatOpen, (_event, raw: unknown) => {
    const parsed = petChatSchema.safeParse(raw)
    if (!parsed.success) throw new Error(validationError(parsed.error))
    return setPetChatOpen(parsed.data.open)
  })
  ipcMain.handle(IPC.pet.beginDrag, (_event, raw: unknown) => {
    const point = raw as { x?: number; y?: number }
    if (typeof point?.x !== 'number' || typeof point?.y !== 'number') return
    beginPetDrag(point.x, point.y)
  })
  ipcMain.handle(IPC.pet.dragMove, (_event, raw: unknown) => {
    const point = raw as { x?: number; y?: number }
    if (typeof point?.x !== 'number' || typeof point?.y !== 'number') return
    movePetDrag(point.x, point.y)
  })
  ipcMain.handle(IPC.pet.endDrag, () => endPetDrag())

  ipcMain.handle(IPC.settings.get, () => getSettings())

  ipcMain.handle(IPC.settings.update, (_event, raw: unknown) => {
    const parsed = settingsPatchSchema.safeParse(raw)
    if (!parsed.success) throw new Error(validationError(parsed.error))
    const previous = getSettings()
    let next = updateSettings(parsed.data as Partial<AppSettings>)
    applyLoginSetting(next)
    syncPetSettings(previous, next)
    if (parsed.data.petHotkey && parsed.data.petHotkey !== previous.petHotkey) {
      const result = applyHotkey(parsed.data.petHotkey, () => focusPetChat())
      if (!result.ok) next = updateSettings({ petHotkey: previous.petHotkey })
    }
    return next
  })

  ipcMain.handle(IPC.updates.check, () => checkForUpdates())

  handleCore<BootstrapData>(IPC.core.getBootstrap, z.undefined(), () => core.getBootstrap())
  ipcMain.handle(IPC.core.createConversation, async () => {
    const result = await core.createConversation()
    if (result.ok) {
      broadcast(IPC.core.conversationUpdated, result.data)
      broadcast(IPC.core.activeChanged, { id: result.data.id })
    }
    return result
  })
  ipcMain.handle(IPC.core.setActiveConversation, async (_event, raw: unknown) => {
    const parsed = idSchema.safeParse(raw)
    if (!parsed.success) return { ok: false, error: validationError(parsed.error) }
    const result = await core.setActiveConversation(parsed.data.id)
    if (result.ok) broadcast(IPC.core.activeChanged, { id: result.data.id })
    return result
  })
  ipcMain.handle(IPC.core.sendMessage, async (_event, raw: unknown) => {
    const parsed = sendMessageSchema.safeParse(raw)
    if (!parsed.success) return { ok: false, error: validationError(parsed.error) }
    const { conversationId, text } = parsed.data
    try {
      const result = await core.sendMessage(
        conversationId,
        text,
        (delta) => broadcast(IPC.core.messageDelta, { conversationId, delta }),
        () => broadcast(IPC.core.messageStarted, { conversationId, userText: text })
      )
      if (result.ok) {
        broadcast(IPC.core.conversationUpdated, result.data)
      } else {
        broadcast(IPC.core.messageFailed, { conversationId, error: result.error })
      }
      return result
    } catch (error) {
      log.error('Chat IPC failed', error)
      const message = errorMessage(error)
      broadcast(IPC.core.messageFailed, { conversationId, error: message })
      return { ok: false, error: message }
    }
  })
  handleCore<Conversation[]>(IPC.core.deleteConversation, deleteConversationSchema, (input) => {
    const value = input as { id: string; scopes: DeleteScope[] }
    return core.deleteConversation(value.id, value.scopes)
  })
  handleCore<MemoryEntry>(IPC.core.addMemory, memoryAddSchema, (input) => {
    const value = input as { category: string; text: string }
    return core.addMemory(value.category, value.text)
  })
  handleCore<MemoryEntry>(IPC.core.updateMemory, memoryUpdateSchema, (input) => {
    const value = input as { id: string; category: string; text: string }
    return core.updateMemory(value.id, value.category, value.text)
  })
  handleCore<string>(IPC.core.deleteMemory, memoryDeleteSchema, (input) =>
    core.deleteMemory((input as { id: string }).id)
  )
  handleCore<MemoryEntry[]>(IPC.core.clearMemories, z.undefined(), () => core.clearMemories())
  handleCore<Task>(IPC.core.createTask, taskCreateSchema, (input) =>
    core.createTask((input as { title: string; root?: string }).title, (input as { root?: string }).root)
  )
  handleCore<Task>(IPC.core.approveTask, z.object({ id: z.string().min(1), scope: z.enum(['once', 'task']).optional() }), (input) => {
    const value = input as { id: string; scope?: 'once' | 'task' }
    return core.approveTask(value.id, value.scope ?? 'once')
  })
  handleCore<Task>(IPC.core.cancelTask, idSchema, (input) =>
    core.cancelTask((input as { id: string }).id)
  )
  handleCore<ToolCapability>(IPC.core.setToolEnabled, toolToggleSchema, (input) => {
    const value = input as { id: string; enabled: boolean }
    return core.setToolEnabled(value.id, value.enabled)
  })
  handleCore<ModelProfile>(IPC.core.verifyModel, modelVerifySchema, (input) => {
    const value = input as { id: string; input?: ModelInput }
    return core.verifyModel(value.id, value.input)
  })
  handleCore<ModelProfile>(IPC.core.createModel, z.undefined(), () => core.createModel())
  handleCore<ModelProfile>(IPC.core.saveModel, modelSaveSchema, (input) => {
    const value = input as { id: string; input: ModelInput }
    return core.saveModel(value.id, value.input)
  })
  handleCore<ModelProfile[]>(IPC.core.deleteModel, idSchema, (input) =>
    core.deleteModel((input as { id: string }).id)
  )
  handleCore<ModelProfile[]>(IPC.core.setDefaultModel, idSchema, (input) =>
    core.setDefaultModel((input as { id: string }).id)
  )
  handleCore<CharacterProfile>(IPC.core.saveCharacter, characterSchema, (input) =>
    core.saveCharacter(input as CharacterProfile)
  )
  handleCore<ScreenAnalysis>(IPC.core.analyzeScreen, z.undefined(), () => core.analyzeScreen())
  handleCore(IPC.core.searchHistory, z.object({ keyword: z.string().max(200) }), (input) =>
    core.searchHistory((input as { keyword: string }).keyword)
  )
  handleCore<Task>(IPC.core.denyTask, idSchema, (input) =>
    core.denyTask((input as { id: string }).id)
  )

  ipcMain.handle(IPC.character.importAsset, ( _event, raw: unknown) => {
    const parsed = characterImportSchema.safeParse(raw)
    if (!parsed.success) return { ok: false, error: validationError(parsed.error) }
    const imported = importCharacterDirectory(parsed.data.path, join(app.getPath('userData'), 'characters'))
    if (!imported.ok) return { ok: false, error: imported.reason }
    try {
      getDatabase().prepare(
        `INSERT INTO characters_imported(id, name, format, root_path, loaded, error, created_at) VALUES (?, ?, 'cubism', ?, 1, NULL, ?)`
      ).run(imported.id, imported.modelUrl, join(app.getPath('userData'), 'characters', imported.id), new Date().toISOString())
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : '导入记录保存失败，原有角色保持不变' }
    }
    return { ok: true, data: imported }
  })

  ipcMain.handle(IPC.pet.getAffect, () => core.affect.pad)
  const relationshipView = (record: RelationshipRecord) => ({
    stage: record.stage,
    since: record.since,
    history: record.history,
    lineId: record.lineId,
    address: relationshipVoice(record.stage).title,
    archivedLines: record.archivedLines
  })
  ipcMain.handle(IPC.relationship.get, () => relationshipView(readRelationship()))
  ipcMain.handle(IPC.relationship.reset, () => {
    const relationship = writeRelationship(resetRelationship(readRelationship()))
    const view = relationshipView(relationship)
    broadcast(IPC.relationship.changed, view)
    return view
  })
  ipcMain.handle(IPC.relationship.changeAppearance, (_event, raw: unknown) => {
    const schema = z.object({ mode: z.enum(['continue', 'new']), patch: settingsPatchSchema.pick({ petPreset: true, importedModelUrl: true, importedCharacterName: true }).strict() })
    const parsed = schema.safeParse(raw)
    if (!parsed.success) throw new Error(validationError(parsed.error))
    const previous = getSettings()
    const next = updateSettings(parsed.data.patch)
    const relationship = parsed.data.mode === 'new' ? writeRelationship(startNewLine(readRelationship())) : readRelationship()
    syncPetSettings(previous, next)
    // Import switches do not change preset ID; explicitly refresh the model URL too.
    if (previous.importedModelUrl !== next.importedModelUrl) refreshPetState()
    const view = relationshipView(relationship)
    broadcast(IPC.relationship.changed, view)
    return { settings: next, relationship: view }
  })
  ipcMain.handle(IPC.voice.readiness, () => core.voice.readiness())
  ipcMain.handle(IPC.voice.transcribe, async (_event, raw: unknown) => {
    const payload = raw as { samples?: number[] }
    const samples = Array.isArray(payload?.samples) ? Float32Array.from(payload.samples) : new Float32Array()
    return core.voice.transcribe(samples, getSettings().permissions.microphone)
  })
  ipcMain.handle(IPC.voice.speak, async (_event, raw: unknown) => {
    const payload = raw as { text?: string }
    const spoken = await core.voice.speak(String(payload?.text ?? ''))
    return {
      samples: spoken.audio ? Array.from(spoken.audio) : [],
      sampleRate: spoken.sampleRate,
      played: spoken.played,
      message: spoken.message
    }
  })
  ipcMain.handle(IPC.data.exportBundle, async (_event, raw: unknown) => {
    const requested = (raw as { passphrase?: string; path?: string }) ?? {}
    const passphrase = String(requested.passphrase ?? '')
    if (passphrase.length < 6) return { ok: false, error: '导出口令至少 6 位。没有口令不会导出。' }
    const bootstrap = await core.getBootstrap()
    if (!bootstrap.ok) return bootstrap
    const bundle = stripSecrets({
      version: 3,
      conversations: bootstrap.data.conversations,
      memories: bootstrap.data.memories,
      character: bootstrap.data.character,
      models: bootstrap.data.models.map((model) => ({ id: model.id, name: model.name, endpoint: model.endpoint }))
    })
    const target = requested.path?.trim() || join(app.getPath('downloads'), `murasame-${new Date().toISOString().slice(0, 10)}.murapack`)
    try {
      writeFileSync(target, exportBundle(bundle, passphrase))
      return { ok: true, data: { path: target, note: '数据包已加密，不含明文密钥。' } }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : '导出失败' }
    }
  })
  ipcMain.handle(IPC.data.importBundle, async (_event, raw: unknown) => {
    const value = raw as { path?: string; passphrase?: string }
    const source = String(value?.path ?? '')
    try {
      const payload = readFileSync(source)
      const bundle = importBundle(payload, String(value?.passphrase ?? ''), 3) as {
        conversations?: Parameters<typeof mergeImportedBundle>[1]['conversations']
        memories?: Parameters<typeof mergeImportedBundle>[1]['memories']
        character?: { name?: string; style?: string; example?: string; keywords?: string[]; proactive?: boolean; memory?: boolean }
      }
      const dbFile = databasePath(getUserDataDir())
      if (existsSync(dbFile)) copyFileSync(dbFile, `${dbFile}.before-import`)
      const merged = mergeImportedBundle(getDatabase(), bundle)
      if (bundle.character?.name) {
        await core.saveCharacter({
          name: bundle.character.name,
          style: bundle.character.style ?? '',
          example: bundle.character.example ?? '',
          keywords: bundle.character.keywords ?? [],
          proactive: Boolean(bundle.character.proactive),
          memory: bundle.character.memory !== false
        })
      }
      return {
        ok: true,
        data: {
          conversations: merged.conversations,
          memories: merged.memories,
          note: `已合并导入。原数据库备份在 ${dbFile}.before-import。`
        }
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : '导入失败，现有数据保持不变' }
    }
  })
  ipcMain.handle(IPC.autonomy.environment, () => isolationEnvironmentAsync())
  ipcMain.handle(IPC.autonomy.preview, () => core.autonomy.preview())
  ipcMain.handle(IPC.autonomy.status, async () => {
    const state = await core.autonomy.health()
    return autonomyViewState(state)
  })
  ipcMain.handle(IPC.autonomy.create, (_event, raw: unknown) => {
    const input = z.object({ kind: z.enum(['office', 'code']), goal: z.string().trim().min(1).max(2000) }).strict().safeParse(raw)
    if (!input.success) return { ok: false, error: '请选择办公或Python创作，并填写2000字以内的目标' }
    return core.createIsolationArtifact(input.data.kind, input.data.goal)
  })
  ipcMain.handle(IPC.autonomy.exportArtifact, async (_event, raw: unknown) => {
    const input = z.object({ id: z.string().uuid() }).strict().safeParse(raw)
    const state = core.autonomy.status()
    const artifact = state.creation?.artifact
    if (!input.success || !state.running || !artifact || artifact.id !== input.data.id) return { ok: false, error: '当前没有可导出的核验产物' }
    const selection = await dialog.showSaveDialog({
      title: '保存已核验产物（请使用新文件名）', defaultPath: artifact.name,
      filters: [{ name: artifact.kind === 'office' ? 'OpenDocument文字文档' : 'Python脚本', extensions: [artifact.kind === 'office' ? 'odt' : 'py'] }]
    })
    if (selection.canceled || !selection.filePath) return { ok: false, error: '已取消保存，产物仍留在本次隔离活动中' }
    return core.autonomy.exportCreation(artifact.id, selection.filePath)
  })
  const prepareIsolation = (send: (line: string) => void): Promise<{ ok: boolean; detail: string }> => {
    if (isolationPrepare) return isolationPrepare
    const controller = new AbortController()
    prepareController = controller
    isolationPrepare = (async () => {
      const docker = await ensureDocker({ onStatus: send, signal: controller.signal })
      if (!docker.ok) return docker
      if ((await isolationEnvironmentAsync(undefined, { signal: controller.signal })).image) return { ok: true, detail: '隔离环境已经就绪。' }
      const context = app.isPackaged ? join(process.resourcesPath, 'isolation') : join(app.getAppPath(), 'isolation')
      if (!existsSync(join(context, 'Dockerfile'))) return { ok: false, detail: '安装目录里没有隔离环境的制作文件。' }
      send('第一次使用，正在准备隔离环境，大约几分钟。')
      let last = ''
      return buildIsolationImage(context, (line) => {
        const text = friendlyBuildLine(line)
        if (!text || text === last) return
        last = text
        send(text)
      }, { signal: controller.signal })
    })().finally(() => {
      isolationPrepare = null
      if (prepareController === controller) prepareController = null
      publishAutonomy()
    })
    publishAutonomy()
    return isolationPrepare
  }
  ipcMain.handle(IPC.autonomy.buildImage, (event) => prepareIsolation((line) => {
    if (!event.sender.isDestroyed()) event.sender.send(IPC.autonomy.buildProgress, line)
  }))
  ipcMain.handle(IPC.autonomy.start, async (event, raw: unknown) => {
    const input = z.object({ confirmed: z.boolean().optional(), allowNetwork: z.boolean().optional(), kind: z.enum(['browse', 'video', 'office', 'code']).optional() }).strict().safeParse(raw ?? {})
    if (!input.success) return { ok: false, error: '活动范围无效，请重新确认' }
    const value = input.data
    if (!value.confirmed) return { ok: false, error: '还没有确认活动范围，容器没有启动。' }
    const generation = prepareGeneration
    const prepared = await prepareIsolation((line) => {
      if (!event.sender.isDestroyed()) event.sender.send(IPC.autonomy.buildProgress, line)
    })
    if (generation !== prepareGeneration) return { ok: false, error: '启动准备已取消，没有创建活动' }
    if (!prepared.ok) return { ok: false, error: prepared.detail }
    return core.autonomy.start({
      dockerAvailable: true,
      approved: true,
      needsPermission: false,
      share: null,
      allowNetwork: value.allowNetwork !== false,
      kind: value.kind
    })
  })
  ipcMain.handle(IPC.autonomy.open, (_event, raw: unknown) => {
    const url = String((raw as { url?: string })?.url ?? '')
    return core.autonomy.openPage(url)
  })
  ipcMain.handle(IPC.autonomy.look, () => {
    if (!getSettings().outboundImages) return { ok: false, error: '让模型看桌面需要先允许发送截图。当前产物仍在，下方真实画面可直接查看。' }
    return core.autonomy.look((image, signal) => core.describeIsolationImage(image, signal))
  })
  ipcMain.handle(IPC.autonomy.browse, (_event, raw: unknown) => {
    const goal = String((raw as { goal?: string })?.goal ?? '').trim()
    if (!goal) return { ok: false, error: '先说想让它在隔离桌面里看什么。' }
    if (!getSettings().outboundImages) return { ok: false, error: '自己逛需要把隔离桌面的截图发给看图模型。请先在设置里打开「允许把截图发给模型」。' }
    return core.autonomy.browse(goal, (image, target, notes, signal) => core.decideIsolationStep(image, target, notes, signal))
  })
  ipcMain.handle(IPC.autonomy.watch, (_event, raw: unknown) => {
    const url = String((raw as { url?: string })?.url ?? '').trim()
    if (!getSettings().outboundImages) return { ok: false, error: '看视频需要把截到的画面发给看图模型。请先在设置里打开「允许把截图发给模型」。' }
    return core.autonomy.watchVideo(url, (image, signal) => core.describeIsolationImage(image, signal))
  })
  ipcMain.handle(IPC.autonomy.stop, async () => {
    prepareGeneration++
    prepareController?.abort(new Error('用户停止了活动准备'))
    if (isolationPrepare) publishAutonomy()
    return core.autonomy.stop({ containerGone: false })
  })
  handleCore<Task>(IPC.core.continueTask, z.object({ id: z.string().min(1), answer: z.string().trim().min(1).max(10000) }), input => {
    const value = input as { id: string; answer: string }
    return core.continueTask(value.id, value.answer)
  })
  handleCore<string>(IPC.core.openArtifact, z.object({ id: z.string().min(1), artifact: z.string().min(1).max(2000) }), input => {
    const value = input as { id: string; artifact: string }
    return core.openArtifact(value.id, value.artifact)
  })

  log.info('IPC handlers registered')
}
