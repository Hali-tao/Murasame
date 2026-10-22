import { initialBootstrap } from '../../shared/mock-data'
import type {
  BootstrapData,
  Conversation,
  ModelInput,
  ModelProfile,
  Result
} from '../../shared/types'
import type { ChatTurn } from './model-client'
import { ModelApiClient } from './model-client'
import type { ModelRepository, ResolvedModel } from './model-repository'
import { MockCore } from './mock-core'

const clone = <T>(value: T): T => structuredClone(value)
const nowLabel = (): string =>
  new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
const uid = (prefix: string): string => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
const ok = <T>(data: T): Result<T> => ({ ok: true, data })
const fail = <T>(error: string): Result<T> => ({ ok: false, error })

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '模型请求失败，请稍后重试'
}

export class DesktopCore extends MockCore {
  constructor(
    private readonly models: ModelRepository,
    private readonly client = new ModelApiClient()
  ) {
    super({ ...initialBootstrap(), models: models.list() })
  }

  async getBootstrap(): Promise<Result<BootstrapData>> {
    this.data.models = this.models.list()
    return super.getBootstrap()
  }

  async sendMessage(
    conversationId: string,
    text: string,
    onDelta?: (delta: string) => void
  ): Promise<Result<Conversation>> {
    const conversation = this.data.conversations.find((item) => item.id === conversationId)
    if (!conversation) return fail('会话不存在或已被清除')

    const model = this.models.getDefault()
    if (!model) return fail('尚未配置模型，请先到「模型服务」填写服务地址、API Key 和模型名称')
    if (!model.model.trim()) return fail('当前模型尚未填写模型名称，请到「模型服务」补全配置')
    if (!model.endpoint.trim()) return fail('当前模型尚未填写服务地址，请到「模型服务」补全配置')

    const messages: ChatTurn[] = conversation.messages.slice(-24).map((message) => ({
      role: message.role,
      content: message.text
    }))
    messages.push({ role: 'user', content: text })

    let reply: string
    const startedAt = Date.now()
    try {
      reply = await this.client.stream(model, messages, onDelta ?? (() => undefined))
    } catch (error) {
      this.models.markOffline(model.id)
      this.data.models = this.models.list()
      return fail(errorMessage(error))
    }

    const timestamp = nowLabel()
    conversation.messages.push({ id: uid('msg'), role: 'user', text, time: timestamp })
    conversation.messages.push({ id: uid('msg'), role: 'assistant', text: reply, time: nowLabel() })
    conversation.preview = reply.slice(0, 32).replace(/\n/g, ' ')
    conversation.time = '刚刚'
    conversation.count = conversation.messages.length
    if (conversation.title === '新的对话') conversation.title = text.slice(0, 24)
    this.models.markVerified(model.id, Date.now() - startedAt)
    this.data.models = this.models.list()

    return ok(clone(conversation))
  }

  async verifyModel(id: string, input?: ModelInput): Promise<Result<ModelProfile>> {
    try {
      if (input) this.models.save(id, input)
      const model = this.models.resolve(id)
      if (!model) return fail('模型配置不存在')
      const outcome = await this.client.test(model)
      const profile = this.models.markVerified(id, outcome.latencyMs)
      this.data.models = this.models.list()
      return ok(profile)
    } catch (error) {
      try {
        this.models.markOffline(id)
        this.data.models = this.models.list()
      } catch {
        // Preserve the original validation error when the profile does not exist.
      }
      return fail(errorMessage(error))
    }
  }

  async createModel(): Promise<Result<ModelProfile>> {
    try {
      const model = this.models.create()
      this.data.models = this.models.list()
      return ok(model)
    } catch (error) {
      return fail(errorMessage(error))
    }
  }

  async saveModel(id: string, input: ModelInput): Promise<Result<ModelProfile>> {
    try {
      const model = this.models.save(id, input)
      this.data.models = this.models.list()
      return ok(model)
    } catch (error) {
      return fail(errorMessage(error))
    }
  }

  async setDefaultModel(id: string): Promise<Result<ModelProfile[]>> {
    try {
      const models = this.models.setDefault(id)
      this.data.models = models
      return ok(models)
    } catch (error) {
      return fail(errorMessage(error))
    }
  }
}

export type { ResolvedModel }
