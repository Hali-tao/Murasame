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
import { rememberActiveConversation } from './core/active-conversation'
import { MurasameCore as DesktopCore } from './core/murasame-core'
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
import { buildIsolationImage, dockerAvailable, ensureDocker, friendlyBuildLine, isolationEnvironment } from './isolation/docker-runtime'
import { relationshipVoice, resetRelationship, type RelationshipRecord } from './core/services/relationship-service'
import { readRelationship, writeRelationship } from './settings'
import log from './logger'
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
  let relationship: RelationshipRecord = readRelationship()
  let isolationPrepare: Promise<{ ok: boolean; detail: string }> | null = null

  core.tasks.onChange((task) => {
    broadcast(IPC.core.taskUpdated, task)
    if (!['已完成', '失败', '部分完成', '已取消'].includes(task.status) || getSettings().doNotDisturb) return
    broadcastPetPerformance({
      intent: task.status === '已完成' ? '开心' : '思考',
      motion: null,
      expression: null,
      degraded: false,
      pad: core.affect.pad,
      text: `任务「${task.title}」${task.status}。${task.result.split('\n')[0] ?? ''}`
    })
  })

  onSettingsChanged((settings) => {
    const windows = [getMainWindow()]
    windows.forEach((window) => {
      if (window && !window.isDestroyed()) window.webContents.send(IPC.settings.changed, settings)
    })
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
        rememberActiveConversation(conversationId)
        broadcast(IPC.core.conversationUpdated, result.data)
        broadcast(IPC.core.activeChanged, { id: conversationId })
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
    core.createTask((input as { title: string }).title)
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

  const relationshipView = (record: RelationshipRecord) => ({
    stage: record.stage,
    since: record.since,
    history: record.history,
    lineId: record.lineId,
    address: relationshipVoice(record.stage).title
  })
  ipcMain.handle(IPC.relationship.get, () => relationshipView(relationship))
  ipcMain.handle(IPC.relationship.reset, () => {
    relationship = writeRelationship(resetRelationship(readRelationship()))
    return relationshipView(relationship)
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
  ipcMain.handle(IPC.autonomy.environment, () => isolationEnvironment())
  ipcMain.handle(IPC.autonomy.status, () => core.autonomy.health())
  const prepareIsolation = (send: (line: string) => void): Promise<{ ok: boolean; detail: string }> => {
    if (isolationPrepare) return isolationPrepare
    isolationPrepare = (async () => {
      const docker = await ensureDocker({ onStatus: send })
      if (!docker.ok) return docker
      if (isolationEnvironment().image) return { ok: true, detail: '隔离环境已经就绪。' }
      const context = app.isPackaged ? join(process.resourcesPath, 'isolation') : join(app.getAppPath(), 'isolation')
      if (!existsSync(join(context, 'Dockerfile'))) return { ok: false, detail: '安装目录里没有隔离环境的制作文件。' }
      send('第一次使用，正在准备隔离环境，大约几分钟。')
      let last = ''
      return buildIsolationImage(context, (line) => {
        const text = friendlyBuildLine(line)
        if (!text || text === last) return
        last = text
        send(text)
      })
    })().finally(() => {
      isolationPrepare = null
    })
    return isolationPrepare
  }
  ipcMain.handle(IPC.autonomy.buildImage, (event) => prepareIsolation((line) => {
    if (!event.sender.isDestroyed()) event.sender.send(IPC.autonomy.buildProgress, line)
  }))
  ipcMain.handle(IPC.autonomy.start, async (event, raw: unknown) => {
    const value = (raw ?? {}) as { confirmed?: boolean; allowNetwork?: boolean }
    if (!value.confirmed) return { ok: false, error: '还没有确认活动范围，容器没有启动。' }
    const prepared = await prepareIsolation((line) => {
      if (!event.sender.isDestroyed()) event.sender.send(IPC.autonomy.buildProgress, line)
    })
    if (!prepared.ok) return { ok: false, error: prepared.detail }
    return core.autonomy.start({
      dockerAvailable: true,
      approved: true,
      needsPermission: false,
      share: null,
      allowNetwork: value.allowNetwork !== false
    })
  })
  ipcMain.handle(IPC.autonomy.open, (_event, raw: unknown) => {
    const url = String((raw as { url?: string })?.url ?? '')
    return core.autonomy.openPage(url)
  })
  ipcMain.handle(IPC.autonomy.look, () => {
    const settings = getSettings()
    return core.autonomy.look(async (image) => {
      if (!settings.outboundImages) return '截图留在本机，没有发给模型。'
      return core.describeIsolationImage(image)
    })
  })
  ipcMain.handle(IPC.autonomy.browse, (_event, raw: unknown) => {
    const goal = String((raw as { goal?: string })?.goal ?? '').trim()
    if (!goal) return { ok: false, error: '先说想让它在隔离桌面里看什么。' }
    if (!getSettings().outboundImages) return { ok: false, error: '自己逛需要把隔离桌面的截图发给看图模型。请先在设置里打开「允许把截图发给模型」。' }
    return core.autonomy.browse(goal, (image, target, notes) => core.decideIsolationStep(image, target, notes))
  })
  ipcMain.handle(IPC.autonomy.watch, (_event, raw: unknown) => {
    const url = String((raw as { url?: string })?.url ?? '').trim()
    if (!getSettings().outboundImages) return { ok: false, error: '看视频需要把截到的画面发给看图模型。请先在设置里打开「允许把截图发给模型」。' }
    return core.autonomy.watchVideo(url, (image) => core.describeIsolationImage(image))
  })
  ipcMain.handle(IPC.autonomy.stop, async () => {
    const result = await core.autonomy.stop({ containerGone: !dockerAvailable() })
    if (result.ok && result.data.notes.length > 0) {
      broadcastPetPerformance({
        intent: '思考',
        motion: null,
        expression: null,
        degraded: false,
        pad: core.affect.pad,
        text: `我在隔离桌面里看到：\n${result.data.notes.join('\n')}`
      })
    }
    return result
  })

  log.info('IPC handlers registered')
}

