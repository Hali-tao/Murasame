import type { PetPresetId } from './pet-presets'
import type { ToolCallRecord, Verdict } from './evidence'
import type { CreationKind, CreationProgress } from './isolated-creation'

export interface ActivityStatus {
  activityId?: string
  running: boolean
  reason: string
  viewUrl: string
  notes: string[]
  taskStatus: string
  kind?: 'manual' | 'browse' | 'video' | CreationKind
  goal?: string
  allowNetwork?: boolean
  phase?: 'idle' | 'preparing' | 'running' | 'stopping' | 'stopped' | 'failed'
  canStop?: boolean
  busy?: boolean
  creation?: CreationProgress
}

export type Tone = 'coral' | 'green' | 'amber' | 'blue' | 'violet' | 'gray' | 'red'

export type Result<T> = { ok: true; data: T } | { ok: false; error: string }

export interface Message {
  id: string
  role: 'user' | 'assistant'
  text: string
  time: string
}

export type MemoryRecallStatus = 'complete' | 'limited' | 'unavailable' | 'disabled' | 'not-used' | 'unknown'

export interface Conversation {
  id: string
  title: string
  time: string
  preview: string
  count: number
  pinned: boolean
  messages: Message[]
  recalledMemoryIds?: string[]
  recalledAtMessageId?: string
  memoryRecallStatus?: MemoryRecallStatus
}

export interface ConversationDeleted {
  id: string
  activeConversationId: string | null
}

export interface MemoryExtractionStatus {
  conversationId: string
  status: 'processing' | 'saved' | 'unchanged' | 'skipped' | 'failed' | 'cleared'
  reason?: string
  updatedAt: string
}

export interface MemoryEntry {
  id: string
  category: string
  text: string
  source: string
  updated: string
}

export type TaskStepState = '完成' | '进行中' | '待执行' | '待核对' | '等待批准' | '已取消' | '正在停止'

export type TaskStatus =
  | '待确认'
  | '已确认'
  | '规划中'
  | '执行中'
  | '等待批准'
  | '正在停止'
  | '已完成'
  | '部分完成'
  | '失败'
  | '已取消'
  | '已中断'

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
  status: TaskStatus
  tone: Tone
  progress: number
  created: string
  model: string
  modelProfileId: string | null
  scope: string
  summary: string
  steps: TaskStep[]
  artifacts: string[]
  approval: ApprovalRequest | null
  result: string
  toolCalls: ToolCallRecord[]
  verdict: Verdict | null
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

export type ModelCapabilityId =
  | 'text.chat'
  | 'text.stream'
  | 'vision.image-input'
  | 'tools.function-calling'
  | 'output.json-schema'

export type CapabilityStatus = 'unknown' | 'declared' | 'verified' | 'unsupported'

export interface ModelCapability {
  id: ModelCapabilityId
  status: CapabilityStatus
  detail: string
  probedAt: string
}

export interface ModelProfile {
  id: string
  name: string
  provider: string
  endpoint: string
  key: string
  hasKey: boolean
  model: string
  caps: string[]
  capabilities: ModelCapability[]
  probeNote: string
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

export interface ChatTurnStarted {
  conversationId: string
  userText: string
}

export interface ChatTurnFailed {
  conversationId: string
  error: string
}

export interface ScreenAnalysis {
  title: string
  confidence: string
  summary: string
  bullets: string[]
  action: string
  sourceWindow: string
  resolution: string
  capturedAt: string
  continuous: boolean
  tree?: string
  image?: string
  untrusted?: boolean
  marks?: Array<{ id: number; name: string }>
  refusal?: string
  needsTaskConfirm?: boolean
  timings?: { captureMs: number; waitMs: number; generateMs: number }
  watch?: string
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
  /** 唤起桌宠对话的全局快捷键，Electron accelerator 写法。 */
  petHotkey: string
  importedModelUrl: string
  importedCharacterName: string
  screenWatchEnabled: boolean
  screenWatchSeconds: 5 | 15 | 60
  voiceRoute: 'local' | 'windows' | 'cloud'
  speakReplies: boolean
  userName: string
  /** 是否允许把屏幕截图发给当前模型服务。 */
  outboundImages: boolean
  /** 写图片到桌面或图片文件夹：ask 每次问，allow 提前允许后不再问。 */
  fileApproval: 'ask' | 'allow'
  proactivePace: 'low' | 'mid' | 'high'
  onboardingDone: boolean
  permissions: Permissions
}

export interface MemoryIndexStatus {
  state: 'idle' | 'rebuilding' | 'paused' | 'failed'
  completed: number
  total: number
  message: string
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
  activeConversationId: string | null
  memoryNote?: string
  memoryIndex?: MemoryIndexStatus
  /** 向量服务和记忆模型都就绪时为 true；否则记忆不会被带进对话。 */
  memoryReady?: boolean
}

export interface AppInfo {
  version: string
  platform: string
  isPackaged: boolean
  logsPath: string
  userDataPath: string
}

export interface PerformanceCue {
  intent: string
  motion: string | null
  expression: string | null
  degraded: boolean
  pad: { pleasure: number; arousal: number; dominance: number }
  text?: string
}

/** 情绪变化事件：只记录「发生了什么」，不推断动机，不持久化。 */
export interface AffectEvent {
  id: number
  at: string
  reason: string
  pad: { pleasure: number; arousal: number; dominance: number }
}

export interface PetChatLayout {
  open: boolean
  side: 'left' | 'right'
}

export interface PetState {
  visible: boolean
  scale: number
  x: number
  y: number
  preset: PetPresetId
  importedModelUrl: string
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

export interface HistoryHit {
  id: string
  title: string
  preview: string
}

export type HistorySearchResult =
  | { status: 'ok'; items: HistoryHit[] }
  | { status: 'empty' }
  | { status: 'error'; message: string }

export type DeleteScope = 'history' | 'memory' | 'cache' | 'logs'

export interface RelationshipView {
  stage: string
  since: string
  history: Array<{ stage: string; since: string }>
  lineId: string
  address: string
  archivedLines?: Array<{ lineId: string; stage: string; since: string; history: Array<{ stage: string; since: string }> }>
}

/** 一次真实的记忆召回事件（该记忆在这一轮被写进模型上下文）。 */
export interface MemoryRecallEvent {
  conversationId: string
  conversationTitle: string
  turnId: string
  /** 该轮对话记录时间（ISO 字符串）。 */
  at: string
}

/** 一条长期记忆的召回来源：最近一次 + 总次数 + 最近若干次事件。 */
export interface MemoryRecallSource extends MemoryRecallEvent {
  memoryId: string
  /** 该记忆被真正带进模型上下文的总次数（没有上限，统计自历史记录）。 */
  count: number
  /** 最近若干次召回事件（最新在前，最多 5 条）。 */
  recent: MemoryRecallEvent[]
}

/** 每日回顾（事实版）：只汇总今天真实发生的事，不做评分/打卡。 */
export interface DailyRecap {
  /** 本地日期 YYYY-MM-DD。 */
  date: string
  messages: number
  conversations: number
  memoriesAdded: number
  /** 今天真正把记忆带进模型上下文的轮数（不是「提取」次数）。 */
  memoryRecalls: number
  tasksCompleted: number
  tasksFailed: number
  tasksActive: number
  tasksCancelled: number
  hasActivity: boolean
}

export interface MurasameCore {
  getBootstrap(): Promise<Result<BootstrapData>>
  createConversation(): Promise<Result<Conversation>>
  sendMessage(
    conversationId: string,
    text: string,
    onDelta?: (delta: string) => void
  ): Promise<Result<Conversation>>
  setActiveConversation(id: string): Promise<Result<{ id: string }>>
  deleteConversation(id: string, scopes: DeleteScope[]): Promise<Result<Conversation[]>>
  addMemory(category: string, text: string): Promise<Result<MemoryEntry>>
  updateMemory(id: string, category: string, text: string): Promise<Result<MemoryEntry>>
  deleteMemory(id: string): Promise<Result<string>>
  clearMemories(): Promise<Result<MemoryEntry[]>>
  /** 每条记忆最近一次真正被召回进入对话的来源；从未被召回的记忆不会出现在结果里。 */
  memoryRecallSources(): Promise<Result<MemoryRecallSource[]>>
  /** 今日回顾（事实版）：只读本地数据库汇总，不发网络请求。 */
  dailyRecap(): Promise<Result<DailyRecap>>
  createTask(title: string, root?: string): Promise<Result<Task>>
  approveTask(id: string, scope?: 'once' | 'task'): Promise<Result<Task>>
  continueTask(id: string, answer: string): Promise<Result<Task>>
  openArtifact(id: string, artifact: string): Promise<Result<string>>
  cancelTask(id: string): Promise<Result<Task>>
  setToolEnabled(id: string, enabled: boolean): Promise<Result<ToolCapability>>
  verifyModel(id: string, input?: ModelInput): Promise<Result<ModelProfile>>
  createModel(): Promise<Result<ModelProfile>>
  saveModel(id: string, input: ModelInput): Promise<Result<ModelProfile>>
  deleteModel(id: string): Promise<Result<ModelProfile[]>>
  setDefaultModel(id: string): Promise<Result<ModelProfile[]>>
  saveCharacter(profile: CharacterProfile): Promise<Result<CharacterProfile>>
  analyzeScreen(): Promise<Result<ScreenAnalysis>>
  searchHistory(keyword: string): Promise<Result<HistorySearchResult>>
  denyTask(id: string): Promise<Result<Task>>
}

export interface MurasameApi {
  app: {
    getInfo(): Promise<AppInfo>
    quit(): Promise<void>
    hideToTray(): Promise<void>
    openLogs(): Promise<void>
    openUserData(): Promise<void>
    clearLogs(): Promise<void>
    pickOpen(options?: { title?: string; directory?: boolean; filters?: Array<{ name: string; extensions: string[] }> }): Promise<string | null>
    pickSave(options?: { title?: string; defaultPath?: string }): Promise<string | null>
    hotkey(): Promise<string>
  }
  window: {
    showMain(): Promise<void>
    hideMain(): Promise<void>
    minimize(): Promise<void>
    openPath(path: string): Promise<void>
    onNavigated(listener: (path: string) => void): () => void
    onHidden(listener: () => void): () => void
  }
  pet: {
    show(): Promise<PetState>
    hide(): Promise<PetState>
    toggle(): Promise<PetState>
    getState(): Promise<PetState>
    getAffect(): Promise<PerformanceCue['pad']>
    getAffectEvents(): Promise<AffectEvent[]>
    setScale(scale: number): Promise<PetState>
    setPosition(x: number, y: number): Promise<PetState>
    setIgnoreMouseEvents(ignore: boolean): Promise<void>
    getBounds(): Promise<PetBounds>
    resetPosition(): Promise<PetState>
    setChatOpen(open: boolean): Promise<PetChatLayout>
    beginDrag(screenX: number, screenY: number): Promise<void>
    dragMove(screenX: number, screenY: number): Promise<void>
    endDrag(): Promise<void>
    onFocusChat(listener: () => void): () => void
    onStateChanged(listener: (state: PetState) => void): () => void
    onPerformance(listener: (cue: PerformanceCue) => void): () => void
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
  character: {
    importAsset(path: string): Promise<Result<{ ok: boolean; reason: string; id: string; modelUrl: string }>>
  }
  relationship: {
    get(): Promise<RelationshipView>
    reset(): Promise<RelationshipView>
    changeAppearance(input: { patch: Pick<Partial<AppSettings>, 'petPreset' | 'importedModelUrl' | 'importedCharacterName'>; mode: 'continue' | 'new' }): Promise<{ settings: AppSettings; relationship: RelationshipView }>
    onChanged(listener: (relationship: RelationshipView) => void): () => void
  }
  data: {
    exportBundle(passphrase: string, path?: string): Promise<Result<{ path: string; note: string }>>
    importBundle(path: string, passphrase: string): Promise<Result<{ conversations: number; memories: number; note: string }>>
  }
  voice: {
    readiness(): Promise<{ stt: boolean; tts: boolean; detail: string }>
    transcribe(samples: number[]): Promise<{ text: string; accepted: boolean; message: string }>
    speak(text: string): Promise<{ samples: number[]; sampleRate: number; played: boolean; message: string }>
  }
  autonomy: {
    onStatusChanged(listener: (state: ActivityStatus) => void): () => void
    preview(): Promise<Result<{ image: string }>>
    create(kind: CreationKind, goal: string): Promise<Result<ActivityStatus>>
    exportArtifact(id: string): Promise<Result<{ path: string; bytes: number; sha256: string }>>
    status(): Promise<ActivityStatus>
    start(options?: { confirmed?: boolean; allowNetwork?: boolean; kind?: 'browse' | 'video' | CreationKind }): Promise<Result<ActivityStatus>>
    environment(): Promise<{ docker: boolean; image: boolean; detail: string }>
    openPage(url: string): Promise<Result<ActivityStatus>>
    look(): Promise<Result<ActivityStatus>>
    browse(goal: string): Promise<Result<ActivityStatus>>
    watch(url: string): Promise<Result<ActivityStatus>>
    buildImage(): Promise<{ ok: boolean; detail: string }>
    onBuildProgress(listener: (line: string) => void): () => void
    stop(): Promise<Result<ActivityStatus>>
  }
  events: {
    onMessageDelta(listener: (payload: ChatDelta) => void): () => void
    onMessageStarted(listener: (payload: ChatTurnStarted) => void): () => void
    onMessageFailed(listener: (payload: ChatTurnFailed) => void): () => void
    onConversationUpdated(listener: (conversation: Conversation) => void): () => void
    onConversationDeleted(listener: (event: ConversationDeleted) => void): () => void
    onScreenUpdated(listener: (analysis: ScreenAnalysis) => void): () => void
    onTaskUpdated(listener: (task: Task) => void): () => void
    onMemoriesUpdated(listener: (memories: MemoryEntry[]) => void): () => void
    onModelsUpdated(listener: (models: ModelProfile[]) => void): () => void
    onMemoryExtractionStatus(listener: (status: MemoryExtractionStatus) => void): () => void
    onMemoryIndexStatus(listener: (status: MemoryIndexStatus) => void): () => void
    onActiveConversation(listener: (payload: { id: string }) => void): () => void
  }
}
