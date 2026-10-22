import { app, ipcMain, shell } from 'electron'
import { z } from 'zod'
import { IPC } from '../shared/ipc'
import {
  characterSchema,
  deleteConversationSchema,
  idSchema,
  ignoreMouseSchema,
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
  MurasameCore,
  Result,
  ScreenAnalysis,
  Task,
  ToolCapability
} from '../shared/types'
import { markQuitting } from './app-state'
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
  setPetMousePassthrough,
  setPetPosition,
  setPetScale,
  showMain,
  showPet,
  togglePet
} from './windows'

let registered = false

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

export function registerIpcHandlers(core: MurasameCore): void {
  if (registered) return
  registered = true

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

  ipcMain.handle(IPC.app.quit, () => {
    markQuitting()
    setImmediate(() => app.quit())
  })

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

  ipcMain.handle(IPC.window.showMain, () => showMain())
  ipcMain.handle(IPC.window.hideMain, () => hideMain())
  ipcMain.handle(IPC.window.minimize, () => getMainWindow()?.minimize())

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

  ipcMain.handle(IPC.settings.get, () => getSettings())

  ipcMain.handle(IPC.settings.update, (_event, raw: unknown) => {
    const parsed = settingsPatchSchema.safeParse(raw)
    if (!parsed.success) throw new Error(validationError(parsed.error))
    const previous = getSettings()
    const next = updateSettings(parsed.data as Partial<AppSettings>)
    applyLoginSetting(next)
    syncPetSettings(previous, next)
    return next
  })

  ipcMain.handle(IPC.updates.check, () => checkForUpdates())

  handleCore<BootstrapData>(IPC.core.getBootstrap, z.undefined(), () => core.getBootstrap())
  handleCore<Conversation>(IPC.core.createConversation, z.undefined(), () => core.createConversation())
  ipcMain.handle(IPC.core.sendMessage, async (event, raw: unknown) => {
    const parsed = sendMessageSchema.safeParse(raw)
    if (!parsed.success) return { ok: false, error: validationError(parsed.error) }
    const { conversationId, text } = parsed.data
    try {
      return await core.sendMessage(conversationId, text, (delta) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send(IPC.core.messageDelta, { conversationId, delta })
        }
      })
    } catch (error) {
      log.error('Chat IPC failed', error)
      return { ok: false, error: errorMessage(error) }
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
  handleCore<Task>(IPC.core.approveTask, idSchema, (input) =>
    core.approveTask((input as { id: string }).id)
  )
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
  handleCore<ModelProfile[]>(IPC.core.setDefaultModel, idSchema, (input) =>
    core.setDefaultModel((input as { id: string }).id)
  )
  handleCore<CharacterProfile>(IPC.core.saveCharacter, characterSchema, (input) =>
    core.saveCharacter(input as CharacterProfile)
  )
  handleCore<ScreenAnalysis>(IPC.core.analyzeScreen, z.undefined(), () => core.analyzeScreen())

  log.info('IPC handlers registered')
}

