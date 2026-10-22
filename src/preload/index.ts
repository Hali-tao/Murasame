import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type {
  AppInfo,
  AppSettings,
  BootstrapData,
  ChatDelta,
  CharacterProfile,
  Conversation,
  DeleteScope,
  MemoryEntry,
  ModelInput,
  ModelProfile,
  MurasameApi,
  PetBounds,
  PetState,
  Result,
  ScreenAnalysis,
  Task,
  ToolCapability,
  UpdateCheckResult
} from '../shared/types'

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const wrapped = (_event: Electron.IpcRendererEvent, payload: T): void => listener(payload)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.removeListener(channel, wrapped)
}

const api: MurasameApi = {
  app: {
    getInfo: (): Promise<AppInfo> => ipcRenderer.invoke(IPC.app.getInfo),
    quit: (): Promise<void> => ipcRenderer.invoke(IPC.app.quit),
    hideToTray: (): Promise<void> => ipcRenderer.invoke(IPC.app.hideToTray),
    openLogs: (): Promise<void> => ipcRenderer.invoke(IPC.app.openLogs),
    openUserData: (): Promise<void> => ipcRenderer.invoke(IPC.app.openUserData),
    clearLogs: (): Promise<void> => ipcRenderer.invoke(IPC.app.clearLogs)
  },
  window: {
    showMain: (): Promise<void> => ipcRenderer.invoke(IPC.window.showMain),
    hideMain: (): Promise<void> => ipcRenderer.invoke(IPC.window.hideMain),
    minimize: (): Promise<void> => ipcRenderer.invoke(IPC.window.minimize)
  },
  pet: {
    show: (): Promise<PetState> => ipcRenderer.invoke(IPC.pet.show),
    hide: (): Promise<PetState> => ipcRenderer.invoke(IPC.pet.hide),
    toggle: (): Promise<PetState> => ipcRenderer.invoke(IPC.pet.toggle),
    getState: (): Promise<PetState> => ipcRenderer.invoke(IPC.pet.getState),
    setScale: (scale: number): Promise<PetState> => ipcRenderer.invoke(IPC.pet.setScale, { scale }),
    setPosition: (x: number, y: number): Promise<PetState> =>
      ipcRenderer.invoke(IPC.pet.setPosition, { x, y }),
    setIgnoreMouseEvents: (ignore: boolean): Promise<void> =>
      ipcRenderer.invoke(IPC.pet.setIgnoreMouseEvents, { ignore }),
    getBounds: (): Promise<PetBounds> => ipcRenderer.invoke(IPC.pet.getBounds),
    resetPosition: (): Promise<PetState> => ipcRenderer.invoke(IPC.pet.resetPosition),
    onStateChanged: (listener: (state: PetState) => void): (() => void) =>
      subscribe(IPC.pet.stateChanged, listener)
  },
  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.settings.get),
    update: (patch: Partial<AppSettings>): Promise<AppSettings> =>
      ipcRenderer.invoke(IPC.settings.update, patch),
    onChanged: (listener: (settings: AppSettings) => void): (() => void) =>
      subscribe(IPC.settings.changed, listener)
  },
  updates: {
    check: (): Promise<UpdateCheckResult> => ipcRenderer.invoke(IPC.updates.check)
  },
  core: {
    getBootstrap: (): Promise<Result<BootstrapData>> => ipcRenderer.invoke(IPC.core.getBootstrap),
    createConversation: (): Promise<Result<Conversation>> =>
      ipcRenderer.invoke(IPC.core.createConversation),
    sendMessage: (conversationId: string, text: string): Promise<Result<Conversation>> =>
      ipcRenderer.invoke(IPC.core.sendMessage, { conversationId, text }),
    deleteConversation: (id: string, scopes: DeleteScope[]): Promise<Result<Conversation[]>> =>
      ipcRenderer.invoke(IPC.core.deleteConversation, { id, scopes }),
    addMemory: (category: string, text: string): Promise<Result<MemoryEntry>> =>
      ipcRenderer.invoke(IPC.core.addMemory, { category, text }),
    updateMemory: (id: string, category: string, text: string): Promise<Result<MemoryEntry>> =>
      ipcRenderer.invoke(IPC.core.updateMemory, { id, category, text }),
    deleteMemory: (id: string): Promise<Result<string>> =>
      ipcRenderer.invoke(IPC.core.deleteMemory, { id }),
    clearMemories: (): Promise<Result<MemoryEntry[]>> =>
      ipcRenderer.invoke(IPC.core.clearMemories),
    createTask: (title: string): Promise<Result<Task>> =>
      ipcRenderer.invoke(IPC.core.createTask, { title }),
    approveTask: (id: string): Promise<Result<Task>> =>
      ipcRenderer.invoke(IPC.core.approveTask, { id }),
    cancelTask: (id: string): Promise<Result<Task>> =>
      ipcRenderer.invoke(IPC.core.cancelTask, { id }),
    setToolEnabled: (id: string, enabled: boolean): Promise<Result<ToolCapability>> =>
      ipcRenderer.invoke(IPC.core.setToolEnabled, { id, enabled }),
    verifyModel: (id: string, input?: ModelInput): Promise<Result<ModelProfile>> =>
      ipcRenderer.invoke(IPC.core.verifyModel, { id, input }),
    createModel: (): Promise<Result<ModelProfile>> => ipcRenderer.invoke(IPC.core.createModel),
    saveModel: (id: string, input: ModelInput): Promise<Result<ModelProfile>> =>
      ipcRenderer.invoke(IPC.core.saveModel, { id, input }),
    setDefaultModel: (id: string): Promise<Result<ModelProfile[]>> =>
      ipcRenderer.invoke(IPC.core.setDefaultModel, { id }),
    saveCharacter: (profile: CharacterProfile): Promise<Result<CharacterProfile>> =>
      ipcRenderer.invoke(IPC.core.saveCharacter, profile),
    analyzeScreen: (): Promise<Result<ScreenAnalysis>> =>
      ipcRenderer.invoke(IPC.core.analyzeScreen)
  },
  events: {
    onMessageDelta: (listener: (payload: ChatDelta) => void): (() => void) =>
      subscribe(IPC.core.messageDelta, listener)
  }
}

contextBridge.exposeInMainWorld('murasame', api)
