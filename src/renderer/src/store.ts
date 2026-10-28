import { create } from 'zustand'
import type {
  AppInfo,
  AppSettings,
  BootstrapData,
  CharacterProfile,
  Conversation,
  DeleteScope,
  MemoryEntry,
  MemoryExtractionStatus,
  ModelInput,
  ModelProfile,
  Result,
  ScreenAnalysis,
  Task,
  Tone,
  ToolCapability
} from '@shared/types'

export interface ToastItem {
  id: string
  message: string
  tone: Tone
}

interface AppStore {
  data: BootstrapData | null
  info: AppInfo | null
  loading: boolean
  startupError: string | null
  busy: Record<string, boolean>
  memoryExtractions: Record<string, MemoryExtractionStatus>
  toasts: ToastItem[]
  selectedConversationId: string | null
  selectedTaskId: string | null
  selectedModelId: string | null
  init(): Promise<void>
  notify(message: string, tone?: Tone): void
  dismissToast(id: string): void
  selectConversation(id: string | null): void
  selectTask(id: string | null): void
  selectModel(id: string | null): void
  updateSettings(patch: Partial<AppSettings>): Promise<boolean>
  createConversation(): Promise<Conversation | null>
  sendMessage(conversationId: string, text: string): Promise<Conversation | null>
  deleteConversation(id: string, scopes: DeleteScope[]): Promise<Conversation[] | null>
  addMemory(category: string, text: string): Promise<MemoryEntry | null>
  updateMemory(id: string, category: string, text: string): Promise<MemoryEntry | null>
  deleteMemory(id: string): Promise<boolean>
  clearMemories(): Promise<boolean>
  createTask(title: string): Promise<Task | null>
  approveTask(id: string, scope?: 'once' | 'task'): Promise<Task | null>
  cancelTask(id: string): Promise<Task | null>
  denyTask(id: string): Promise<Task | null>
  setToolEnabled(id: string, enabled: boolean): Promise<ToolCapability | null>
  verifyModel(id: string, input?: ModelInput): Promise<ModelProfile | null>
  createModel(): Promise<ModelProfile | null>
  saveModel(id: string, input: ModelInput): Promise<ModelProfile | null>
  deleteModel(id: string): Promise<boolean>
  setDefaultModel(id: string): Promise<boolean>
  saveCharacter(profile: CharacterProfile): Promise<boolean>
  analyzeScreen(): Promise<ScreenAnalysis | null>
}

let initialized = false
let toastCounter = 0
const toastId = (): string => `toast-${Date.now()}-${toastCounter++}`

function unwrap<T>(result: Result<T>, notify: (message: string, tone?: Tone) => void): T | null {
  if (result.ok) return result.data
  notify(result.error, 'red')
  return null
}

export const useAppStore = create<AppStore>((set, get) => {
  const replaceConversation = (conversation: Conversation): void => {
    const data = get().data
    if (!data) return
    set({
      data: {
        ...data,
        conversations: data.conversations.map((item) =>
          item.id === conversation.id ? conversation : item
        )
      }
    })
  }

  const replaceTask = (task: Task): void => {
    const data = get().data
    if (!data) return
    set({
      data: {
        ...data,
        tasks: data.tasks.map((item) => (item.id === task.id ? task : item))
      },
      selectedTaskId: task.id
    })
  }

  const busyRun = async <T>(key: string, action: () => Promise<T>): Promise<T> => {
    set((state) => ({ busy: { ...state.busy, [key]: true, ...(key.startsWith('chat:send:') ? { 'chat:send': true } : {}) } }))
    try {
      return await action()
    } finally {
      set((state) => {
        const busy = { ...state.busy, [key]: false }
        if (key.startsWith('chat:send:')) busy['chat:send'] = Object.entries(busy).some(([name, active]) => name.startsWith('chat:send:') && active)
        return { busy }
      })
    }
  }

  return {
    data: null,
    info: null,
    loading: true,
    startupError: null,
    busy: {},
    memoryExtractions: {},
    toasts: [],
    selectedConversationId: null,
    selectedTaskId: null,
    selectedModelId: null,

    async init() {
      if (initialized) return
      initialized = true
      if (!window.murasame) {
        set({
          loading: false,
          startupError: '安全桥接未加载。请从 Murasame 桌面应用启动，而不是直接用浏览器打开页面。'
        })
        return
      }
      try {
        const [bootstrap, info, settings] = await Promise.all([
          window.murasame.core.getBootstrap(),
          window.murasame.app.getInfo(),
          window.murasame.settings.get()
        ])
        if (!bootstrap.ok) throw new Error(bootstrap.error)
        const data: BootstrapData = { ...bootstrap.data, settings }
        set({
          data,
          info,
          loading: false,
          startupError: null,
          selectedConversationId: data.activeConversationId ?? data.conversations[0]?.id ?? null,
          selectedTaskId: data.tasks[0]?.id ?? null,
          selectedModelId: data.models.find((model) => model.default)?.id ?? data.models[0]?.id ?? null
        })
        window.murasame.settings.onChanged((next) => {
          const current = get().data
          if (current) set({ data: { ...current, settings: next } })
        })
        window.murasame.events.onScreenUpdated?.(screenAnalysis => {
          const current = get().data
          if (current) set({ data: { ...current, screenAnalysis } })
        })
        window.murasame.events.onConversationUpdated((conversation) => {
          const current = get().data
          if (!current) return
          const exists = current.conversations.some((item) => item.id === conversation.id)
          set({
            data: {
              ...current,
              conversations: exists
                ? current.conversations.map((item) => (item.id === conversation.id ? conversation : item))
                : [conversation, ...current.conversations]
            },
            busy: { ...get().busy, [`chat:remote:${conversation.id}`]: false }
          })
        })
        window.murasame.events.onMessageStarted(({ conversationId }) => {
          set((state) => ({ busy: { ...state.busy, [`chat:remote:${conversationId}`]: true } }))
        })
        window.murasame.events.onMessageFailed(({ conversationId }) => {
          set((state) => ({ busy: { ...state.busy, [`chat:remote:${conversationId}`]: false } }))
        })
        window.murasame.events.onMemoriesUpdated?.((memories) => {
          const current = get().data
          if (current) set({ data: { ...current, memories } })
        })
        window.murasame.events.onMemoryExtractionStatus?.((status) => {
          set((state) => ({ memoryExtractions: { ...state.memoryExtractions, [status.conversationId]: status } }))
        })
        window.murasame.events.onActiveConversation(({ id }) => {
          set({ selectedConversationId: id })
        })
        window.murasame.events.onTaskUpdated((task) => {
          const current = get().data
          if (!current) return
          const exists = current.tasks.some((item) => item.id === task.id)
          set({
            data: {
              ...current,
              tasks: exists ? current.tasks.map((item) => (item.id === task.id ? task : item)) : [task, ...current.tasks]
            }
          })
        })
      } catch (error) {
        set({
          loading: false,
          startupError: error instanceof Error ? error.message : '应用初始化失败'
        })
      }
    },

    notify(message, tone = 'green') {
      const id = toastId()
      set((state) => ({ toasts: [...state.toasts, { id, message, tone }] }))
      setTimeout(() => {
        set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }))
      }, 3600)
    },

    dismissToast(id) {
      set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }))
    },

    selectConversation(id) {
      set({ selectedConversationId: id })
      if (id) void window.murasame?.core.setActiveConversation(id)
    },

    selectTask(id) {
      set({ selectedTaskId: id })
    },

    selectModel(id) {
      set({ selectedModelId: id })
    },

    async updateSettings(patch) {
      try {
        const settings = await window.murasame.settings.update(patch)
        const data = get().data
        if (data) set({ data: { ...data, settings } })
        return true
      } catch (error) {
        get().notify(error instanceof Error ? error.message : '设置保存失败', 'red')
        return false
      }
    },

    async createConversation() {
      return busyRun('conversation:create', async () => {
        const result = await window.murasame.core.createConversation()
        const conversation = unwrap(result, get().notify)
        if (!conversation) return null
        const data = get().data
        if (data) {
          const exists = data.conversations.some((item) => item.id === conversation.id)
          set({
            data: {
              ...data,
              conversations: exists
                ? data.conversations.map((item) => (item.id === conversation.id ? conversation : item))
                : [conversation, ...data.conversations]
            },
            selectedConversationId: conversation.id
          })
        }
        return conversation
      })
    },

    async sendMessage(conversationId, text) {
      return busyRun(`chat:send:${conversationId}`, async () => {
        const result = await window.murasame.core.sendMessage(conversationId, text)
        const conversation = unwrap(result, get().notify)
        if (conversation) replaceConversation(conversation)
        return conversation
      })
    },

    async deleteConversation(id, scopes) {
      return busyRun('history:delete', async () => {
        const result = await window.murasame.core.deleteConversation(id, scopes)
        const conversations = unwrap(result, get().notify)
        if (!conversations) return null
        const data = get().data
        if (data) {
          const nextId = get().selectedConversationId === id ? conversations[0]?.id ?? null : get().selectedConversationId
          set({
            data: { ...data, conversations },
            selectedConversationId: nextId
          })
        }
        get().notify('已按所选范围清除本地记录')
        return conversations
      })
    },

    async addMemory(category, text) {
      return busyRun('memory:save', async () => {
        const result = await window.murasame.core.addMemory(category, text)
        const memory = unwrap(result, get().notify)
        if (!memory) return null
        const data = get().data
        if (data) set({ data: { ...data, memories: [memory, ...data.memories.filter((item) => item.id !== memory.id)] } })
        get().notify('已添加记忆条目')
        return memory
      })
    },

    async updateMemory(id, category, text) {
      return busyRun('memory:save', async () => {
        const result = await window.murasame.core.updateMemory(id, category, text)
        const memory = unwrap(result, get().notify)
        if (!memory) return null
        const data = get().data
        if (data) {
          set({
            data: {
              ...data,
              memories: [memory, ...data.memories.filter((item) => item.id !== id && item.id !== memory.id)]
            }
          })
        }
        get().notify('记忆条目已更新')
        return memory
      })
    },

    async deleteMemory(id) {
      return busyRun('memory:delete', async () => {
        const result = await window.murasame.core.deleteMemory(id)
        if (!result.ok) {
          get().notify(result.error, 'red')
          return false
        }
        const data = get().data
        if (data) {
          set({ data: { ...data, memories: data.memories.filter((item) => item.id !== id) } })
        }
        get().notify('记忆条目已删除')
        return true
      })
    },

    async clearMemories() {
      return busyRun('memory:clear', async () => {
        const result = await window.murasame.core.clearMemories()
        if (!result.ok) {
          get().notify(result.error, 'red')
          return false
        }
        const data = get().data
        if (data) set({ data: { ...data, memories: result.data } })
        get().notify('长期记忆已清空')
        return true
      })
    },

    async createTask(title) {
      return busyRun('task:create', async () => {
        const result = await window.murasame.core.createTask(title)
        const task = unwrap(result, get().notify)
        if (!task) return null
        const data = get().data
        if (data) set({ data: { ...data, tasks: [task, ...data.tasks.filter(item => item.id !== task.id)] }, selectedTaskId: task.id })
        get().notify('任务已创建，执行前仍会请求必要批准')
        return task
      })
    },

    async approveTask(id, scope = 'once') {
      return busyRun('task:approve', async () => {
        const result = await window.murasame.core.approveTask(id, scope)
        const task = unwrap(result, get().notify)
        if (task) {
          replaceTask(task)
          get().notify('已批准，任务在后台执行，进度会实时更新')
        }
        return task
      })
    },

    async cancelTask(id) {
      return busyRun('task:cancel', async () => {
        const result = await window.murasame.core.cancelTask(id)
        const task = unwrap(result, get().notify)
        if (task) {
          replaceTask(task)
          get().notify(task.status === '正在停止' ? '正在停止，手上这个文件处理完就停' : '任务已取消；已完成步骤与产物仍可查看', 'amber')
        }
        return task
      })
    },

    async denyTask(id) {
      return busyRun('task:approve', async () => {
        const result = await window.murasame.core.denyTask(id)
        const task = unwrap(result, get().notify)
        if (task) {
          replaceTask(task)
          get().notify('已拒绝。任务受阻，没有执行敏感操作', 'amber')
        }
        return task
      })
    },

    async setToolEnabled(id, enabled) {
      return busyRun(`tool:${id}`, async () => {
        const result = await window.murasame.core.setToolEnabled(id, enabled)
        const tool = unwrap(result, get().notify)
        if (!tool) return null
        const data = get().data
        if (data) {
          set({
            data: {
              ...data,
              tools: data.tools.map((item) => (item.id === id ? tool : item))
            }
          })
        }
        get().notify(enabled ? `${tool.name} 已启用` : `${tool.name} 已停用`, enabled ? 'green' : 'amber')
        return tool
      })
    },

    async verifyModel(id, input) {
      return busyRun('model:verify', async () => {
        const result = await window.murasame.core.verifyModel(id, input)
        const model = unwrap(result, get().notify)
        if (!model) return null
        const data = get().data
        if (data) {
          set({
            data: {
              ...data,
              models: data.models.map((item) => (item.id === id ? model : item))
            }
          })
        }
        if (model.status === '在线') get().notify(`连接验证成功 · ${model.latency}`)
        else {
          const chat = model.capabilities.find((item) => item.id === 'text.chat')
          get().notify(chat?.detail ? `还不能使用：${chat.detail}` : '验证未通过，还不能开始使用', 'red')
        }
        return model
      })
    },

    async createModel() {
      return busyRun('model:create', async () => {
        const result = await window.murasame.core.createModel()
        const model = unwrap(result, get().notify)
        if (!model) return null
        const data = get().data
        if (data) {
          set({
            data: { ...data, models: [...data.models, model] },
            selectedModelId: model.id
          })
        }
        get().notify('已添加新的模型配置', 'blue')
        return model
      })
    },

    async saveModel(id, input) {
      return busyRun('model:save', async () => {
        const result = await window.murasame.core.saveModel(id, input)
        const model = unwrap(result, get().notify)
        if (!model) return null
        const data = get().data
        if (data) {
          set({
            data: {
              ...data,
              models: data.models.map((item) => (item.id === id ? model : item))
            }
          })
        }
        get().notify('模型配置已保存')
        return model
      })
    },

    async deleteModel(id) {
      return busyRun('model:delete', async () => {
        const result = await window.murasame.core.deleteModel(id)
        const models = unwrap(result, get().notify)
        if (!models) return false
        const data = get().data
        if (data) set({ data: { ...data, models }, selectedModelId: models[0]?.id ?? null })
        get().notify('配置已删除')
        return true
      })
    },

    async setDefaultModel(id) {
      return busyRun('model:default', async () => {
        const result = await window.murasame.core.setDefaultModel(id)
        if (!result.ok) {
          get().notify(result.error, 'red')
          return false
        }
        const data = get().data
        if (data) set({ data: { ...data, models: result.data }, selectedModelId: id })
        const note = result.data.find((model) => model.probeNote)?.probeNote
        get().notify(note ? `已设为当前服务。${note}` : '已设为当前服务；新任务将使用该配置')
        return true
      })
    },

    async saveCharacter(profile) {
      return busyRun('character:save', async () => {
        const result = await window.murasame.core.saveCharacter(profile)
        if (!result.ok) {
          get().notify(result.error, 'red')
          return false
        }
        const data = get().data
        if (data) set({ data: { ...data, character: result.data } })
        get().notify('角色设定已保存')
        return true
      })
    },

    async analyzeScreen() {
      return busyRun('screen:analyze', async () => {
        const result = await window.murasame.core.analyzeScreen()
        const analysis = unwrap(result, get().notify)
        if (!analysis) return null
        const data = get().data
        if (data) set({ data: { ...data, screenAnalysis: analysis } })
        get().notify('当前画面分析完成')
        return analysis
      })
    }
  }
})

export function resetStoreForTests(): void {
  initialized = false
  useAppStore.setState({
    data: null,
    info: null,
    loading: true,
    startupError: null,
    busy: {},
    memoryExtractions: {},
    toasts: [],
    selectedConversationId: null,
    selectedTaskId: null,
    selectedModelId: null
  })
}
