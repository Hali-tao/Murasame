import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '../../src/shared/ipc'

type Handler = (event: unknown, raw?: unknown) => unknown
const h = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  windows: [] as Array<{ isDestroyed: () => boolean; webContents: { send: () => void } }>,
  taskListener: null as null | ((task: unknown) => void),
  settings: {
    startAtLogin: false,
    minimizeToTray: false,
    doNotDisturb: false,
    taskNotifications: false,
    encryptLocalData: false,
    closeBehavior: 'tray',
    logRetentionDays: 7,
    memoryEnabled: true,
    memoryAutoExtract: true,
    petVisible: true,
    petScale: 1,
    petPreset: 'naiwa',
    importedModelUrl: '',
    importedCharacterName: '',
    screenWatchEnabled: false,
    screenWatchSeconds: 15,
    voiceRoute: 'local',
    speakReplies: false,
    userName: '',
    outboundImages: false,
    fileApproval: 'ask',
    petHotkey: 'Alt+Space',
    proactivePace: 'mid',
    onboardingDone: true,
    permissions: { screen: true, microphone: true, accessibility: true }
  }
}))

const allCoreChannels = [
  IPC.core.getBootstrap, IPC.core.deleteConversation, IPC.core.addMemory, IPC.core.updateMemory,
  IPC.core.deleteMemory, IPC.core.clearMemories, IPC.core.createTask, IPC.core.approveTask,
  IPC.core.cancelTask, IPC.core.setToolEnabled, IPC.core.verifyModel, IPC.core.createModel,
  IPC.core.saveModel, IPC.core.deleteModel, IPC.core.setDefaultModel, IPC.core.saveCharacter,
  IPC.core.analyzeScreen, IPC.core.searchHistory, IPC.core.denyTask, IPC.core.continueTask,
  IPC.core.openArtifact, IPC.core.sendMessage, IPC.core.setActiveConversation
]

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: Handler) => { h.handlers.set(channel, handler) } },
  BrowserWindow: { getAllWindows: () => h.windows },
  app: {
    getVersion: () => '0.9.0-test',
    getPath: (name: string) => `C:\\test\\${name}`,
    isPackaged: false,
    getAppPath: () => 'C:\\test\\app'
  },
  dialog: { showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })), showSaveDialog: vi.fn(async () => ({ canceled: true })), showMessageBox: vi.fn(), showErrorBox: vi.fn() },
  shell: { openPath: vi.fn(async () => '') }
}))
vi.mock('../../src/main/core/murasame-core', () => ({ MurasameCore: class {} }))
vi.mock('../../src/main/data/db', () => ({ getDatabase: () => ({ prepare: () => ({ run: () => ({ changes: 1 }) }) }) }))
vi.mock('../../src/main/data/capacity', () => ({ databasePath: (dir: string) => `${dir}\\murasame.db` }))
vi.mock('../../src/main/data/keys', () => ({ getUserDataDir: () => 'C:\\test\\userData' }))
vi.mock('../../src/main/data/merge-bundle', () => ({ mergeImportedBundle: vi.fn(() => ({ conversations: 0, memories: 0 })) }))
vi.mock('../../src/main/data/portability', () => ({
  exportBundle: vi.fn(() => Buffer.from('bundle')),
  importBundle: vi.fn(() => ({ version: 3 })),
  stripSecrets: (value: unknown) => value
}))
vi.mock('../../src/main/core/services/asset-service', () => ({ importCharacterDirectory: vi.fn(() => ({ ok: false, reason: '没有可导入的角色目录' })) }))
vi.mock('../../src/main/hotkey-status', () => ({ applyHotkey: vi.fn(() => ({ ok: true, message: '' })), readHotkey: vi.fn(() => 'Alt+Space') }))
vi.mock('../../src/main/isolation/docker-runtime', () => ({
  buildIsolationImage: vi.fn(async () => ({ ok: true, detail: '' })),
  ensureDocker: vi.fn(async () => ({ ok: true, detail: '' })),
  friendlyBuildLine: (line: string) => line,
  isolationEnvironmentAsync: vi.fn(async () => ({ image: 'image' }))
}))
vi.mock('../../src/main/core/services/relationship-service', () => ({
  relationshipVoice: () => ({ tone: '', joke: '', title: '旅人' }),
  resetRelationship: (record: unknown) => record,
  startNewLine: (record: unknown) => record
}))
vi.mock('../../src/main/settings', () => ({
  getSettings: () => h.settings,
  onSettingsChanged: vi.fn(),
  updateSettings: vi.fn((patch: Record<string, unknown>) => ({ ...h.settings, ...patch })),
  readRelationship: () => ({ stage: '初识', since: new Date(0).toISOString(), turns: 0, days: 0, history: [], lineId: 'line-1', archivedLines: [] }),
  writeRelationship: vi.fn((record: unknown) => record)
}))
vi.mock('../../src/main/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('../../src/main/agent/learn-verified-image-skill', () => ({ learnVerifiedImageSkill: vi.fn() }))
vi.mock('../../src/main/core/performance-cue', () => ({ performanceCue: vi.fn(() => ({ intent: '思考', motion: null, expression: null, degraded: false, pad: {} })) }))
vi.mock('../../src/main/updater', () => ({ checkForUpdates: vi.fn(async () => ({ status: 'not-available', message: '当前已是最新版本。' })) }))
vi.mock('../../src/main/windows', () => ({
  getMainWindow: () => null,
  getPetBounds: () => ({ x: 0, y: 0, width: 360, height: 500 }),
  getPetStateSafe: () => ({ visible: false, scale: 1, x: 0, y: 0, preset: 'naiwa', importedModelUrl: '' }),
  hideMain: vi.fn(),
  hidePet: vi.fn(),
  refreshPetState: vi.fn(),
  resetPetPosition: vi.fn(),
  confirmQuit: vi.fn(),
  broadcastPetPerformance: vi.fn(),
  focusPetChat: vi.fn(),
  setPetChatOpen: vi.fn(),
  beginPetDrag: vi.fn(),
  movePetDrag: vi.fn(),
  endPetDrag: vi.fn(),
  setPetMousePassthrough: vi.fn(),
  setPetPosition: vi.fn(),
  setPetScale: vi.fn(),
  openMainPath: vi.fn(),
  showMain: vi.fn(),
  showPet: vi.fn(),
  togglePet: vi.fn()
}))

const sendMessage = vi.fn(async (..._args: unknown[]) => ({ ok: true, data: { id: 'chat-1' } }))
const transcribe = vi.fn(async (_audio: Float32Array, _allowed: boolean) => ({ text: '识别成功', accepted: true, message: '本地识别完成' }))
const speak = vi.fn(async (_text: string) => ({ audio: null, sampleRate: 24_000, played: true, message: '本地合成完成' }))
const browse = vi.fn(async (_goal: string) => ({ ok: true, data: { running: false } }))
const createIsolationArtifact = vi.fn(async (_kind: string, _goal: string) => ({ ok: true, data: { running: false } }))
const setActiveConversation = vi.fn(async (id: string) => ({ ok: true, data: { id } }))
const createConversation = vi.fn(async () => ({ ok: true, data: { id: 'chat-created', title: '新的对话', time: '', preview: '', count: 0, pinned: false, messages: [] } }))
const bootstrap = vi.fn(async () => ({ ok: true, data: { conversations: [], memories: [], character: null, models: [], settings: h.settings, tasks: [], tools: [], affect: {}, app: {} } }))

const autonomyState = {
  running: false, phase: 'idle', reason: '', goal: '', kind: undefined, activityId: '',
  viewUrl: '', notes: [], taskStatus: '', hostExecution: false, canStop: false, busy: false,
  creation: undefined, result: undefined
}

function createCore() {
  const core = {
    sendMessage,
    createConversation,
    setActiveConversation,
    getBootstrap: bootstrap,
    deleteConversation: vi.fn(async () => ({ ok: true, data: [] })),
    addMemory: vi.fn(async () => ({ ok: true, data: {} })),
    updateMemory: vi.fn(async () => ({ ok: true, data: {} })),
    deleteMemory: vi.fn(async () => ({ ok: true, data: 'id' })),
    clearMemories: vi.fn(async () => ({ ok: true, data: [] })),
    createTask: vi.fn(async () => ({ ok: true, data: {} })),
    approveTask: vi.fn(async () => ({ ok: true, data: {} })),
    continueTask: vi.fn(async () => ({ ok: true, data: {} })),
    openArtifact: vi.fn(async () => ({ ok: true, data: '' })),
    cancelTask: vi.fn(async () => ({ ok: true, data: {} })),
    denyTask: vi.fn(async () => ({ ok: true, data: {} })),
    setToolEnabled: vi.fn(async () => ({ ok: true, data: {} })),
    verifyModel: vi.fn(async () => ({ ok: true, data: {} })),
    createModel: vi.fn(async () => ({ ok: true, data: {} })),
    saveModel: vi.fn(async () => ({ ok: true, data: {} })),
    deleteModel: vi.fn(async () => ({ ok: true, data: [] })),
    setDefaultModel: vi.fn(async () => ({ ok: true, data: [] })),
    saveCharacter: vi.fn(async () => ({ ok: true, data: {} })),
    analyzeScreen: vi.fn(async () => ({ ok: true, data: {} })),
    searchHistory: vi.fn(async () => ({ ok: true, data: {} })),
    invalidatePresentation: vi.fn(() => 1),
    syncMemoryPolicy: vi.fn(),
    cancelSensitiveRequests: vi.fn(),
    subscribeModels: vi.fn(),
    onScreenAnalysis: undefined as undefined | ((value: unknown) => void),
    onConversationUpdate: undefined as undefined | ((value: unknown) => void),
    onConversationDeleted: undefined as undefined | ((value: unknown) => void),
    onMemoryExtractionStatus: undefined as undefined | ((value: unknown) => void),
    affect: { pad: { valence: 0, arousal: 0, dominance: 0 } },
    memory: { subscribe: vi.fn(), subscribeIndex: vi.fn(), list: vi.fn(() => []) },
    tasks: { onChange: (listener: (task: unknown) => void) => { h.taskListener = listener } },
    voice: { readiness: vi.fn(async () => ({ stt: true, tts: true, detail: '' })), transcribe, speak },
    autonomy: {
      subscribe: vi.fn(),
      status: vi.fn(() => autonomyState),
      health: vi.fn(async () => autonomyState),
      preview: vi.fn(async () => ({ ok: false, error: '没有运行中的隔离桌面' })),
      createIsolationArtifact,
      exportCreation: vi.fn(async () => ({ ok: false, error: '没有可导出的核验产物' })),
      start: vi.fn(async () => ({ ok: true, data: autonomyState })),
      stop: vi.fn(async () => ({ ok: true, data: autonomyState })),
      openPage: vi.fn(async () => ({ ok: false, error: '活动还没开始，没有操作宿主桌面。' })),
      look: vi.fn(async () => ({ ok: true, data: autonomyState })),
      browse,
      watchVideo: vi.fn(async () => ({ ok: true, data: autonomyState }))
    }
  }
  return core
}

function event() {
  const sender = { isDestroyed: () => false, send: vi.fn() }
  return { sender }
}

async function invoke(channel: string, raw?: unknown): Promise<unknown> {
  const handler = h.handlers.get(channel)
  if (!handler) throw new Error(`未注册的 IPC 通道：${channel}`)
  return handler(event(), raw)
}

type Core = ReturnType<typeof createCore>
let core: Core

beforeEach(async () => {
  vi.resetModules()
  h.handlers.clear()
  h.windows = []
  h.taskListener = null
  h.settings.outboundImages = false
  sendMessage.mockClear()
  transcribe.mockClear()
  speak.mockClear()
  browse.mockClear()
  createIsolationArtifact.mockClear()
  setActiveConversation.mockClear()
  createConversation.mockClear()
  bootstrap.mockClear()
  core = createCore()
  const { registerIpcHandlers } = await import('../../src/main/ipc')
  registerIpcHandlers(core as never)
})

describe('[QA-IPC-00] IPC 参数校验与失败隔离', () => {
  it('[QA-IPC-01] 所有核心通道在参数非法时返回结构化错误并保持动作未执行', async () => {
    for (const channel of allCoreChannels) {
      const result = await invoke(channel, { unexpected: true })
      expect(result, channel).toMatchObject({ ok: false })
      expect(typeof (result as { error: string }).error, channel).toBe('string')
      expect((result as { error: string }).error, channel).toContain('请求参数无效')
    }
    expect(sendMessage).not.toHaveBeenCalled()
    expect(setActiveConversation).not.toHaveBeenCalled()
    expect(createConversation).not.toHaveBeenCalled()
    expect(bootstrap).not.toHaveBeenCalled()
  })

  it('[QA-IPC-02] 发送消息缺失字段或超长文本时返回结构化错误，不进入核心服务', async () => {
    const missing = await invoke(IPC.core.sendMessage, { conversationId: 'chat-1' })
    expect(missing).toEqual({ ok: false, error: '请求参数无效：text' })
    const tooLong = await invoke(IPC.core.sendMessage, { conversationId: 'chat-1', text: 'x'.repeat(8001) })
    expect(tooLong).toMatchObject({ ok: false })
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('[QA-IPC-03] 录音样本超长或含非数字时拒绝，不把失控数据送进识别推理', async () => {
    const tooMany = await invoke(IPC.voice.transcribe, { samples: new Array(16_000 * 121).fill(0) })
    expect(transcribe.mock.calls.length).toBe(0)
    expect(tooMany).toMatchObject({ accepted: false })
    expect(String((tooMany as { message: string }).message)).toMatch(/[\u4e00-\u9fff]/)

    const invalid = await invoke(IPC.voice.transcribe, { samples: ['不是数字', null, 1] })
    expect(transcribe.mock.calls.length).toBe(0)
    expect(invalid).toMatchObject({ accepted: false })

    const ok = await invoke(IPC.voice.transcribe, { samples: new Array(16_000).fill(0.1) })
    expect(transcribe).toHaveBeenCalledTimes(1)
    expect(transcribe.mock.calls[0][0]).toBeInstanceOf(Float32Array)
    expect((transcribe.mock.calls[0][0] as Float32Array).length).toBe(16_000)
    expect(transcribe.mock.calls[0][1]).toBe(true)
    expect(ok).toMatchObject({ accepted: true })
  })

  it('[QA-IPC-04] 朗读文本超长时拒绝，不把整段文字交给语音合成', async () => {
    const result = await invoke(IPC.voice.speak, { text: '长'.repeat(4_000) })
    expect(speak.mock.calls.length).toBe(0)
    expect(result).toMatchObject({ played: false })
    expect(String((result as { message: string }).message)).toMatch(/[\u4e00-\u9fff]/)
  })

  it('[QA-IPC-05] 自主浏览目标超长时拒绝，与创作目标的 2000 字上限保持一致', async () => {
    h.settings.outboundImages = true
    const result = await invoke(IPC.autonomy.browse, { goal: '看'.repeat(4_000) })
    expect(browse.mock.calls.length).toBe(0)
    expect(result).toMatchObject({ ok: false })

    const created = await invoke(IPC.autonomy.create, { kind: 'office', goal: '写'.repeat(2001) })
    expect(createIsolationArtifact.mock.calls.length).toBe(0)
    expect(created).toMatchObject({ ok: false })
  })

  it('[QA-IPC-06] 广播时渲染窗口不可用不应让 IPC 请求本身失败', async () => {
    h.windows = [{ isDestroyed: () => false, webContents: { send: () => { throw new Error('Render frame was disposed') } } }]
    await expect(invoke(IPC.core.setActiveConversation, { id: 'chat-1' })).resolves.toEqual({ ok: true, data: { id: 'chat-1' } })
    await expect(invoke(IPC.core.createConversation)).resolves.toMatchObject({ ok: true })
  })

  it('[QA-IPC-07] 任务状态回调中广播失败不应中断协作者与表现处理', async () => {
    h.windows = [{ isDestroyed: () => false, webContents: { send: () => { throw new Error('Render frame was disposed') } } }]
    expect(h.taskListener).toBeTypeOf('function')
    const task = { id: 'task-1', title: '整理文件', status: '执行中', tone: 'blue', progress: 0, summary: '', result: '', steps: [], toolCalls: [], artifacts: [] }
    expect(() => h.taskListener?.(task)).not.toThrow()
  })

  it('[QA-IPC-08] 核心服务异常被转为脱敏后的结构化错误并广播失败事件', async () => {
    sendMessage.mockRejectedValueOnce(new Error('上游失败 sk-abcdefgh12345'))
    const result = await invoke(IPC.core.sendMessage, { conversationId: 'chat-1', text: '你好' })
    expect(result).toEqual({ ok: false, error: '上游失败 sk-••••' })
  })

  it('[QA-IPC-09] 导入角色路径非法与数据包口令过短都返回中文结构化错误', async () => {
    const imported = await invoke(IPC.character.importAsset, { path: '' })
    expect(imported).toEqual({ ok: false, error: '请求参数无效：path' })
    const exported = await invoke(IPC.data.exportBundle, { passphrase: '12345' })
    expect(exported).toMatchObject({ ok: false })
    expect(String((exported as { error: string }).error)).toContain('口令')
  })
})
