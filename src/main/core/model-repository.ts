import { safeStorage } from 'electron'
import Store from 'electron-store'
import type { ModelInput, ModelProfile, ModelStatus, Tone } from '../../shared/types'
import { initialBootstrap } from '../../shared/mock-data'
import log from '../logger'

interface StoredModel {
  id: string
  name: string
  provider: string
  endpoint: string
  encryptedKey: string | null
  model: string
  caps: string[]
  status: ModelStatus
  tone: Tone
  default: boolean
  latency: string
}

interface ModelStoreShape {
  models: StoredModel[]
}

export interface ResolvedModel extends ModelProfile {
  apiKey: string
}

function seedModels(): StoredModel[] {
  return initialBootstrap().models.map((model) => ({
    id: model.id,
    name: model.name,
    provider: model.provider,
    endpoint: model.endpoint,
    encryptedKey: null,
    model: model.model,
    caps: [...model.caps],
    status: '未验证',
    tone: 'gray',
    default: model.default,
    latency: '—'
  }))
}

function publicProfile(model: StoredModel): ModelProfile {
  return {
    id: model.id,
    name: model.name,
    provider: model.provider,
    endpoint: model.endpoint,
    key: '',
    hasKey: Boolean(model.encryptedKey),
    model: model.model,
    caps: [...model.caps],
    status: model.status,
    tone: model.tone,
    default: model.default,
    latency: model.latency
  }
}

export class ModelRepository {
  private store = new Store<ModelStoreShape>({
    name: 'murasame-models',
    defaults: { models: seedModels() }
  })

  list(): ModelProfile[] {
    return this.store.get('models').map(publicProfile)
  }

  get(id: string): ModelProfile | null {
    const model = this.store.get('models').find((item) => item.id === id)
    return model ? publicProfile(model) : null
  }

  getDefault(): ResolvedModel | null {
    const models = this.store.get('models')
    const model = models.find((item) => item.default) ?? models[0]
    return model ? this.resolveStored(model) : null
  }

  resolve(id: string): ResolvedModel | null {
    const model = this.store.get('models').find((item) => item.id === id)
    return model ? this.resolveStored(model) : null
  }

  create(): ModelProfile {
    const model: StoredModel = {
      id: `model-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: '新的模型配置',
      provider: 'OpenAI Compatible',
      endpoint: 'https://api.openai.com/v1',
      encryptedKey: null,
      model: '',
      caps: ['文本'],
      status: '未验证',
      tone: 'gray',
      default: false,
      latency: '—'
    }
    this.store.set('models', [...this.store.get('models'), model])
    return publicProfile(model)
  }

  save(id: string, input: ModelInput): ModelProfile {
    const models = this.store.get('models')
    const index = models.findIndex((item) => item.id === id)
    if (index < 0) throw new Error('模型配置不存在')
    const current = models[index]
    const newKey = input.key.trim()
    let encryptedKey = current.encryptedKey
    if (newKey) encryptedKey = this.encryptKey(newKey)
    const connectionChanged =
      current.provider !== input.provider ||
      current.endpoint !== input.endpoint ||
      current.model !== input.model ||
      Boolean(newKey)
    const next: StoredModel = {
      ...current,
      name: input.name,
      provider: input.provider,
      endpoint: input.endpoint,
      encryptedKey,
      model: input.model,
      caps: [...input.caps],
      status: connectionChanged ? '未验证' : current.status,
      tone: connectionChanged ? 'gray' : current.tone,
      latency: connectionChanged ? '—' : current.latency
    }
    const updated = [...models]
    updated[index] = next
    this.store.set('models', updated)
    return publicProfile(next)
  }

  setDefault(id: string): ModelProfile[] {
    const models = this.store.get('models')
    if (!models.some((model) => model.id === id)) throw new Error('模型配置不存在')
    const updated = models.map((model) => ({ ...model, default: model.id === id }))
    this.store.set('models', updated)
    return updated.map(publicProfile)
  }

  markVerified(id: string, latencyMs: number): ModelProfile {
    return this.updateStatus(id, '在线', 'green', `${latencyMs} ms`)
  }

  markOffline(id: string): ModelProfile {
    return this.updateStatus(id, '离线', 'red', '连接失败')
  }

  private resolveStored(model: StoredModel): ResolvedModel {
    return { ...publicProfile(model), apiKey: this.decryptKey(model.encryptedKey) }
  }

  private updateStatus(id: string, status: ModelStatus, tone: Tone, latency: string): ModelProfile {
    const models = this.store.get('models')
    const index = models.findIndex((item) => item.id === id)
    if (index < 0) throw new Error('模型配置不存在')
    const updated = [...models]
    updated[index] = { ...updated[index], status, tone, latency }
    this.store.set('models', updated)
    return publicProfile(updated[index])
  }

  private encryptKey(key: string): string {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Windows 安全存储当前不可用，无法保存 API Key')
    }
    return safeStorage.encryptString(key).toString('base64')
  }

  private decryptKey(encryptedKey: string | null): string {
    if (!encryptedKey) return ''
    try {
      return safeStorage.decryptString(Buffer.from(encryptedKey, 'base64'))
    } catch (error) {
      log.error('Unable to decrypt saved model credential', error instanceof Error ? error.message : error)
      return ''
    }
  }
}
