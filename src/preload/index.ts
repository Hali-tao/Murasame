import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type {
  AppInfo,
  AppSettings,
  BootstrapData,
  ChatDelta,
  ChatTurnFailed,
  ChatTurnStarted,
  CharacterProfile,
  Conversation,
  DeleteScope,
  MemoryEntry,
  ModelInput,
  ModelProfile,
  MurasameApi,
  PerformanceCue,
  PetBounds,
  PetChatLayout,
  PetState,
  Result,
  ScreenAnalysis,
  Task,
  ToolCapability,
  HistorySearchResult,
  RelationshipView,
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
    clearLogs: (): Promise<void> => ipcRenderer.invoke(IPC.app.clearLogs),
    pickOpen: (options): Promise<string | null> => ipcRenderer.invoke(IPC.app.pickOpen, options),
    pickSave: (options): Promise<string | null> => ipcRenderer.invoke(IPC.app.pickSave, options),
    hotkey: (): Promise<string> => ipcRenderer.invoke(IPC.app.hotkey)
  },
  window: {
    showMain: (): Promise<void> => ipcRenderer.invoke(IPC.window.showMain),
    hideMain: (): Promise<void> => ipcRenderer.invoke(IPC.window.hideMain),
    minimize: (): Promise<void> => ipcRenderer.invoke(IPC.window.minimize),
    openPath: (path): Promise<void> => ipcRenderer.invoke(IPC.window.openPath, path),
    onNavigated: (listener): (() => void) => subscribe(IPC.window.navigated, listener),
    onHidden: (listener): (() => void) => subscribe(IPC.window.hidden, listener)
  },
  pet: {
    show: (): Promise<PetState> => ipcRenderer.invoke(IPC.pet.show),
    hide: (): Promise<PetState> => ipcRenderer.invoke(IPC.pet.hide),
    toggle: (): Promise<PetState> => ipcRenderer.invoke(IPC.pet.toggle),
    getState: (): Promise<PetState> => ipcRenderer.invoke(IPC.pet.getState),
    getAffect: () => ipcRenderer.invoke(IPC.pet.getAffect),
    setScale: (scale: number): Promise<PetState> => ipcRenderer.invoke(IPC.pet.setScale, { scale }),
    setPosition: (x: number, y: number): Promise<PetState> =>
      ipcRenderer.invoke(IPC.pet.setPosition, { x, y }),
    setIgnoreMouseEvents: (ignore: boolean): Promise<void> =>
      ipcRenderer.invoke(IPC.pet.setIgnoreMouseEvents, { ignore }),
    getBounds: (): Promise<PetBounds> => ipcRenderer.invoke(IPC.pet.getBounds),
    resetPosition: (): Promise<PetState> => ipcRenderer.invoke(IPC.pet.resetPosition),
    setChatOpen: (open: boolean): Promise<PetChatLayout> => ipcRenderer.invoke(IPC.pet.setChatOpen, { open }),
    beginDrag: (screenX: number, screenY: number): Promise<void> => ipcRenderer.invoke(IPC.pet.beginDrag, { x: screenX, y: screenY }),
    dragMove: (screenX: number, screenY: number): Promise<void> => ipcRenderer.invoke(IPC.pet.dragMove, { x: screenX, y: screenY }),
    endDrag: (): Promise<void> => ipcRenderer.invoke(IPC.pet.endDrag),
    onFocusChat: (listener: () => void): (() => void) => subscribe(IPC.pet.focusChat, listener),
    onStateChanged: (listener: (state: PetState) => void): (() => void) =>
      subscribe(IPC.pet.stateChanged, listener),
    onPerformance: (listener: (cue: PerformanceCue) => void): (() => void) =>
      subscribe(IPC.pet.performance, listener)
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
    continueTask: (id: string, answer: string): Promise<Result<Task>> => ipcRenderer.invoke(IPC.core.continueTask, { id, answer }),
    openArtifact: (id: string, artifact: string): Promise<Result<string>> => ipcRenderer.invoke(IPC.core.openArtifact, { id, artifact }),
    getBootstrap: (): Promise<Result<BootstrapData>> => ipcRenderer.invoke(IPC.core.getBootstrap),
    createConversation: (): Promise<Result<Conversation>> =>
      ipcRenderer.invoke(IPC.core.createConversation),
    sendMessage: (conversationId: string, text: string): Promise<Result<Conversation>> =>
      ipcRenderer.invoke(IPC.core.sendMessage, { conversationId, text }),
    setActiveConversation: (id: string): Promise<Result<{ id: string }>> =>
      ipcRenderer.invoke(IPC.core.setActiveConversation, { id }),
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
    approveTask: (id: string, scope?: 'once' | 'task'): Promise<Result<Task>> =>
      ipcRenderer.invoke(IPC.core.approveTask, { id, scope }),
    cancelTask: (id: string): Promise<Result<Task>> =>
      ipcRenderer.invoke(IPC.core.cancelTask, { id }),
    setToolEnabled: (id: string, enabled: boolean): Promise<Result<ToolCapability>> =>
      ipcRenderer.invoke(IPC.core.setToolEnabled, { id, enabled }),
    verifyModel: (id: string, input?: ModelInput): Promise<Result<ModelProfile>> =>
      ipcRenderer.invoke(IPC.core.verifyModel, { id, input }),
    createModel: (): Promise<Result<ModelProfile>> => ipcRenderer.invoke(IPC.core.createModel),
    saveModel: (id: string, input: ModelInput): Promise<Result<ModelProfile>> =>
      ipcRenderer.invoke(IPC.core.saveModel, { id, input }),
    deleteModel: (id: string): Promise<Result<ModelProfile[]>> =>
      ipcRenderer.invoke(IPC.core.deleteModel, { id }),
    setDefaultModel: (id: string): Promise<Result<ModelProfile[]>> =>
      ipcRenderer.invoke(IPC.core.setDefaultModel, { id }),
    saveCharacter: (profile: CharacterProfile): Promise<Result<CharacterProfile>> =>
      ipcRenderer.invoke(IPC.core.saveCharacter, profile),
    analyzeScreen: (): Promise<Result<ScreenAnalysis>> =>
      ipcRenderer.invoke(IPC.core.analyzeScreen),
    searchHistory: (keyword: string): Promise<Result<HistorySearchResult>> =>
      ipcRenderer.invoke(IPC.core.searchHistory, { keyword }),
    denyTask: (id: string): Promise<Result<Task>> =>
      ipcRenderer.invoke(IPC.core.denyTask, { id })
  },
  character: {
    importAsset: (path: string): Promise<Result<{ ok: boolean; reason: string; id: string; modelUrl: string }>> =>
      ipcRenderer.invoke(IPC.character.importAsset, { path })
  },
  relationship: {
    get: (): Promise<RelationshipView> => ipcRenderer.invoke(IPC.relationship.get),
    reset: (): Promise<RelationshipView> => ipcRenderer.invoke(IPC.relationship.reset),
    changeAppearance: input => ipcRenderer.invoke(IPC.relationship.changeAppearance, input),
    onChanged: listener => subscribe(IPC.relationship.changed, listener)
  },
  data: {
    exportBundle: (passphrase: string, path?: string): Promise<Result<{ path: string; note: string }>> =>
      ipcRenderer.invoke(IPC.data.exportBundle, { passphrase, path }),
    importBundle: (path: string, passphrase: string): Promise<Result<{ conversations: number; memories: number; note: string }>> =>
      ipcRenderer.invoke(IPC.data.importBundle, { path, passphrase })
  },
  voice: {
    readiness: (): Promise<{ stt: boolean; tts: boolean; detail: string }> =>
      ipcRenderer.invoke(IPC.voice.readiness),
    transcribe: (samples: number[]): Promise<{ text: string; accepted: boolean; message: string }> =>
      ipcRenderer.invoke(IPC.voice.transcribe, { samples }),
    speak: (text: string): Promise<{ samples: number[]; sampleRate: number; played: boolean; message: string }> =>
      ipcRenderer.invoke(IPC.voice.speak, { text })
  },
  autonomy: {
    status: () => ipcRenderer.invoke(IPC.autonomy.status),
    environment: () => ipcRenderer.invoke(IPC.autonomy.environment),
    start: (options?: { confirmed?: boolean; allowNetwork?: boolean }) => ipcRenderer.invoke(IPC.autonomy.start, options),
    openPage: (url: string) => ipcRenderer.invoke(IPC.autonomy.open, { url }),
    look: () => ipcRenderer.invoke(IPC.autonomy.look),
    browse: (goal: string) => ipcRenderer.invoke(IPC.autonomy.browse, { goal }),
    watch: (url: string) => ipcRenderer.invoke(IPC.autonomy.watch, { url }),
    buildImage: () => ipcRenderer.invoke(IPC.autonomy.buildImage),
    onBuildProgress: (listener: (line: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, line: string): void => listener(line)
      ipcRenderer.on(IPC.autonomy.buildProgress, handler)
      return () => ipcRenderer.removeListener(IPC.autonomy.buildProgress, handler)
    },
    stop: () => ipcRenderer.invoke(IPC.autonomy.stop)
  },
  events: {
    onScreenUpdated: listener => subscribe(IPC.core.screenUpdated, listener),
    onMemoriesUpdated: (listener) => subscribe(IPC.core.memoriesUpdated, listener),
    onMemoryExtractionStatus: (listener) => subscribe(IPC.core.memoryExtractionStatus, listener),
    onMessageDelta: (listener: (payload: ChatDelta) => void): (() => void) =>
      subscribe(IPC.core.messageDelta, listener),
    onMessageStarted: (listener: (payload: ChatTurnStarted) => void): (() => void) =>
      subscribe(IPC.core.messageStarted, listener),
    onMessageFailed: (listener: (payload: ChatTurnFailed) => void): (() => void) =>
      subscribe(IPC.core.messageFailed, listener),
    onConversationUpdated: (listener: (conversation: Conversation) => void): (() => void) =>
      subscribe(IPC.core.conversationUpdated, listener),
    onTaskUpdated: (listener: (task: Task) => void): (() => void) =>
      subscribe(IPC.core.taskUpdated, listener),
    onActiveConversation: (listener: (payload: { id: string }) => void): (() => void) =>
      subscribe(IPC.core.activeChanged, listener)
  }
}

contextBridge.exposeInMainWorld('murasame', api)
