import type {
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
  TaskStep,
  ToolCapability
} from '../../shared/types'
import { initialBootstrap } from '../../shared/mock-data'

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const clone = <T>(value: T): T => structuredClone(value)
const nowLabel = (): string =>
  new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
const uid = (prefix: string): string => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
const ok = <T>(data: T): Result<T> => ({ ok: true, data })
const fail = <T>(error: string): Result<T> => ({ ok: false, error })

export class MockCore implements MurasameCore {
  protected data: BootstrapData

  constructor(data: BootstrapData = initialBootstrap()) {
    this.data = clone(data)
  }

  async getBootstrap(): Promise<Result<BootstrapData>> {
    await delay(180)
    return ok(clone(this.data))
  }

  async createConversation(): Promise<Result<Conversation>> {
    const conversation: Conversation = {
      id: uid('chat'),
      title: '新的对话',
      time: '刚刚',
      preview: '从一个问题开始…',
      count: 1,
      pinned: false,
      messages: [
        {
          id: uid('msg'),
          role: 'assistant',
          text: '我在。想继续昨天的工作，还是从一件新事情开始？',
          time: nowLabel()
        }
      ]
    }
    this.data.conversations.unshift(conversation)
    return ok(clone(conversation))
  }

  async sendMessage(conversationId: string, text: string): Promise<Result<Conversation>> {
    const conversation = this.data.conversations.find((item) => item.id === conversationId)
    if (!conversation) return fail('会话不存在或已被清除')
    const timestamp = nowLabel()
    conversation.messages.push({ id: uid('msg'), role: 'user', text, time: timestamp })
    conversation.preview = text.slice(0, 28)
    conversation.time = '刚刚'
    conversation.count = conversation.messages.length
    await delay(720)
    const reply = this.buildReply(text)
    conversation.messages.push({ id: uid('msg'), role: 'assistant', text: reply, time: nowLabel() })
    conversation.preview = reply.slice(0, 30).replace(/\n/g, ' ')
    conversation.count = conversation.messages.length
    return ok(clone(conversation))
  }

  async deleteConversation(id: string, scopes: DeleteScope[]): Promise<Result<Conversation[]>> {
    if (scopes.includes('history')) {
      this.data.conversations = this.data.conversations.filter((item) => item.id !== id)
    }
    return ok(clone(this.data.conversations))
  }

  async addMemory(category: string, text: string): Promise<Result<MemoryEntry>> {
    const entry: MemoryEntry = {
      id: uid('mem'),
      category,
      text,
      source: '手动添加',
      updated: '刚刚'
    }
    this.data.memories.unshift(entry)
    return ok(clone(entry))
  }

  async updateMemory(id: string, category: string, text: string): Promise<Result<MemoryEntry>> {
    const entry = this.data.memories.find((item) => item.id === id)
    if (!entry) return fail('记忆条目不存在')
    entry.category = category
    entry.text = text
    entry.updated = '刚刚'
    entry.source = '用户更正 · 刚刚'
    return ok(clone(entry))
  }

  async deleteMemory(id: string): Promise<Result<string>> {
    this.data.memories = this.data.memories.filter((item) => item.id !== id)
    return ok(id)
  }

  async clearMemories(): Promise<Result<MemoryEntry[]>> {
    this.data.memories = []
    return ok([])
  }

  async createTask(title: string): Promise<Result<Task>> {
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const prefix = `T-${datePart}-`
    const highest = this.data.tasks
      .filter((item) => item.id.startsWith(prefix))
      .reduce((max, item) => Math.max(max, Number(item.id.slice(prefix.length)) || 0), 0)
    const task: Task = {
      id: `${prefix}${String(highest + 1).padStart(2, '0')}`,
      title,
      status: '执行中',
      tone: 'blue',
      progress: 8,
      created: '刚刚',
      model: this.defaultModelName(),
      scope: this.data.tasks[0]?.scope ?? '已授权范围',
      summary: '汇总授权范围内的记录，生成可供人工修改的结果；每一步都会展示实际执行状态。',
      steps: [
        { id: uid('step'), title: '读取授权范围内的记录', detail: '只读取已授权目录与任务摘要', state: '进行中', tone: 'blue', time: '刚刚' },
        { id: uid('step'), title: '合并重复条目', detail: '等待上一步完成', state: '待执行', tone: 'gray', time: '—' },
        { id: uid('step'), title: '生成草稿', detail: '等待上一步完成', state: '待执行', tone: 'gray', time: '—' }
      ],
      artifacts: [],
      approval: null,
      result: '任务已创建，正在读取授权范围内的记录。'
    }
    this.data.tasks.unshift(task)
    return ok(clone(task))
  }

  async approveTask(id: string): Promise<Result<Task>> {
    const task = this.data.tasks.find((item) => item.id === id)
    if (!task) return fail('任务不存在')
    if (!task.approval) return fail('该任务当前没有待批准操作')
    task.status = '执行中'
    task.tone = 'blue'
    task.progress = 70
    task.approval = null
    task.steps = task.steps.map((step, index): TaskStep => {
      if (index === 1) return { ...step, detail: '补丁已应用，原文件备份保留', state: '完成', tone: 'green', time: '刚刚' }
      if (index === 2) return { ...step, detail: '正在运行 2 个回归用例', state: '进行中', tone: 'blue', time: '刚刚' }
      return step
    })
    task.result = '本次写入已批准并执行。回归测试尚未结束，暂不标记完成。'
    return ok(clone(task))
  }

  async cancelTask(id: string): Promise<Result<Task>> {
    const task = this.data.tasks.find((item) => item.id === id)
    if (!task) return fail('任务不存在')
    task.status = '已取消'
    task.tone = 'red'
    task.steps = task.steps.map((step) =>
      step.tone === 'blue' || step.tone === 'amber'
        ? { ...step, detail: '已停止安排后续动作', state: '已取消', tone: 'red' }
        : step
    )
    task.result = '已取消。已完成步骤与产物仍可查看，不视为成功。'
    return ok(clone(task))
  }

  async setToolEnabled(id: string, enabled: boolean): Promise<Result<ToolCapability>> {
    const tool = this.data.tools.find((item) => item.id === id)
    if (!tool) return fail('能力不存在')
    tool.enabled = enabled
    if (!enabled) tool.permission = '已停用'
    else if (id === 'screen' || id === 'isolated') tool.permission = '已授权'
    else if (tool.permission === '已停用') tool.permission = '只读'
    return ok(clone(tool))
  }

  async verifyModel(id: string): Promise<Result<ModelProfile>> {
    const model = this.data.models.find((item) => item.id === id)
    if (!model) return fail('模型配置不存在')
    await delay(900)
    model.status = '在线'
    model.tone = 'green'
    model.latency = '912 ms'
    return ok(clone(model))
  }

  async createModel(): Promise<Result<ModelProfile>> {
    const model: ModelProfile = {
      id: uid('model'),
      name: '新的模型配置',
      provider: 'OpenAI Compatible',
      endpoint: 'https://api.openai.com/v1',
      key: '',
      hasKey: false,
      model: '',
      caps: ['文本'],
      status: '未验证',
      tone: 'gray',
      default: false,
      latency: '—'
    }
    this.data.models.push(model)
    return ok(clone(model))
  }

  async saveModel(id: string, input: ModelInput): Promise<Result<ModelProfile>> {
    const model = this.data.models.find((item) => item.id === id)
    if (!model) return fail('模型配置不存在')
    Object.assign(model, clone(input))
    model.status = '未验证'
    model.tone = 'gray'
    model.latency = '—'
    return ok(clone(model))
  }

  async setDefaultModel(id: string): Promise<Result<ModelProfile[]>> {
    if (!this.data.models.some((item) => item.id === id)) return fail('模型配置不存在')
    this.data.models.forEach((model) => {
      model.default = model.id === id
      if (model.default && model.status !== '在线') {
        model.status = '在线'
        model.tone = 'green'
      }
    })
    return ok(clone(this.data.models))
  }

  async saveCharacter(profile: CharacterProfile): Promise<Result<CharacterProfile>> {
    this.data.character = clone(profile)
    return ok(clone(this.data.character))
  }

  async analyzeScreen(): Promise<Result<ScreenAnalysis>> {
    await delay(980)
    return ok(clone(this.data.screenAnalysis))
  }

  private buildReply(text: string): string {
    if (/报错|编码|乱码|unicode/i.test(text)) {
      return '先确认这不是模型问题，而是读取参数问题。最小路径是：\n\n1. 用 gb18030 重试读取，并记录失败行。\n2. 只在 read_csv 处改 encoding，保留原始文件。\n3. 补一个中文与车牌号列的回归用例。\n\n如果你愿意，我可以把第 1、3 步整理成任务，文件写入前仍会单独请求批准。'
    }
    if (/任务|整理|汇总/.test(text)) {
      return '可以。我会先拆成可核验的步骤，再询问你是否创建任务；不会仅凭这段对话直接执行。你希望处理哪个目录或文件？'
    }
    if (/记忆/.test(text)) {
      return '当前长期记忆已启用。我从这段对话只会提取稳定的偏好，不保存原始屏幕画面或完整密钥；你也可以在「长期记忆」里逐条更正或删除。'
    }
    return '我明白。结合当前会话，我建议先把目标、操作对象和可接受的副作用说清楚，再决定是继续分析还是创建任务。如果这句话涉及文件或应用操作，我会先给你确认入口。'
  }

  private defaultModelName(): string {
    return this.data.models.find((item) => item.default)?.name ?? 'OpenAI · 主模型'
  }
}
