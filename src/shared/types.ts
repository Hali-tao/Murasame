import type { PetPresetId } from './pet-presets'

export type Tone = 'coral' | 'green' | 'amber' | 'blue' | 'violet' | 'gray' | 'red'

export type Result<T> = { ok: true; data: T } | { ok: false; error: string }

export interface Message {
  id: string
  role: 'user' | 'assistant'
  text: string
  time: string
}

export interface Conversation {
  id: string
  title: string
  time: string
  preview: string
  count: number
  pinned: boolean
  messages: Message[]
}

export interface MemoryEntry {
  id: string
  category: string
  text: string
  source: string
  updated: string
}

export type TaskStepState = '完成' | '进行中' | '待执行' | '等待批准' | '已取消'

export interface TaskStep {
  id: string
  title: string
  detail: string
  state: TaskStepState
  tone: Tone
  time: string
}

export interface ApprovalRequest {
  target: string
  impact: string
  tool: string
}

export interface Task {
  id: string
  title: string
  status: '执行中' | '等待批准' | '已完成' | '已取消'
  tone: Tone
  progress: number
  created: string
  model: string
  scope: string
  summary: string
  steps: TaskStep[]
  artifacts: string[]
  approval: ApprovalRequest | null
  result: string
}

export interface ToolCapability {
  id: string
  name: string
  kind: '工具' | '插件' | '内置'
  ability: string
  permission: string
  enabled: boolean
  last: string
  note: string
}

export type ModelStatus = '在线' | '未验证' | '离线'

export interface ModelProfile {
  id: string
  name: string
  provider: string
  endpoint: string
  key: string
  hasKey: boolean
  model: string
  caps: string[]
  status: ModelStatus
  tone: Tone
  default: boolean
  latency: string
}

export interface ModelInput {
  name: string
  provider: string
  endpoint: string
  key: string
  model: string
  caps: string[]
}

export interface ChatDelta {
  conversationId: string
  delta: string
}

export interface ScreenAnalysis {
  title: string
  confidence: string
  summary: string
  bullets: string[]
  action: string
}

export interface CharacterProfile {
  name: string
  style: string
  example: string
  keywords: string[]
  proactive: boolean
  memory: boolean
}

export interface Permissions {
  screen: boolean
  microphone: boolean
  accessibility: boolean
}

export interface AppSettings {
  startAtLogin: boolean
  minimizeToTray: boolean
  doNotDisturb: boolean
  taskNotifications: boolean
  encryptLocalData: boolean
  closeBehavior: 'tray' | 'ask' | 'quit'
  logRetentionDays: number
  memoryEnabled: boolean
  memoryAutoExtract: boolean
  petVisible: boolean
  petScale: number
  petPreset: PetPresetId
  permissions: Permissions
}

export interface BootstrapData {
  conversations: Conversation[]
  memories: MemoryEntry[]
  tasks: Task[]
  tools: ToolCapability[]
  models: ModelProfile[]
  screenAnalysis: ScreenAnalysis
  character: CharacterProfile
  settings: AppSettings
}

export interface AppInfo {
  version: string
  platform: string
  isPackaged: boolean
  logsPath: string
  userDataPath: string
}

export interface PetState {
  visible: boolean
  scale: number
  x: number
  y: number
  preset: PetPresetId
}

export interface PetBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface UpdateCheckResult {
  status: 'disabled' | 'available' | 'not-available' | 'error' | 'checking'
  message: string
  version?: string
}

export type DeleteScope = 'history' | 'memory' | 'cache' | 'logs'

export interface MurasameCore {
  getBootstrap(): Promise<Result<BootstrapData>>
  createConversation(): Promise<Result<Conversation>>
  sendMessage(
    conversationId: string,
    text: string,
    onDelta?: (delta: string) => void
  ): Promise<Result<Conversation>>
  deleteConversation(id: string, scopes: DeleteScope[]): Promise<Result<Conversation[]>>
  addMemory(category: string, text: string): Promise<Result<MemoryEntry>>
  updateMemory(id: string, category: string, text: string): Promise<Result<MemoryEntry>>
  deleteMemory(id: string): Promise<Result<string>>
  clearMemories(): Promise<Result<MemoryEntry[]>>
  createTask(title: string): Promise<Result<Task>>
  approveTask(id: string): Promise<Result<Task>>
  cancelTask(id: string): Promise<Result<Task>>
  setToolEnabled(id: string, enabled: boolean): Promise<Result<ToolCapability>>
  verifyModel(id: string, input?: ModelInput): Promise<Result<ModelProfile>>
  createModel(): Promise<Result<ModelProfile>>
  saveModel(id: string, input: ModelInput): Promise<Result<ModelProfile>>
  setDefaultModel(id: string): Promise<Result<ModelProfile[]>>
  saveCharacter(profile: CharacterProfile): Promise<Result<CharacterProfile>>
  analyzeScreen(): Promise<Result<ScreenAnalysis>>
}

export interface MurasameApi {
  app: {
    getInfo(): Promise<AppInfo>
    quit(): Promise<void>
    hideToTray(): Promise<void>
    openLogs(): Promise<void>
    openUserData(): Promise<void>
    clearLogs(): Promise<void>
  }
  window: {
    showMain(): Promise<void>
    hideMain(): Promise<void>
    minimize(): Promise<void>
  }
  pet: {
    show(): Promise<PetState>
    hide(): Promise<PetState>
    toggle(): Promise<PetState>
    getState(): Promise<PetState>
    setScale(scale: number): Promise<PetState>
    setPosition(x: number, y: number): Promise<PetState>
    setIgnoreMouseEvents(ignore: boolean): Promise<void>
    getBounds(): Promise<PetBounds>
    resetPosition(): Promise<PetState>
    onStateChanged(listener: (state: PetState) => void): () => void
  }
  settings: {
    get(): Promise<AppSettings>
    update(patch: Partial<AppSettings>): Promise<AppSettings>
    onChanged(listener: (settings: AppSettings) => void): () => void
  }
  updates: {
    check(): Promise<UpdateCheckResult>
  }
  core: MurasameCore
  events: {
    onMessageDelta(listener: (payload: ChatDelta) => void): () => void
  }
}
