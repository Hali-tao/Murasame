import { safeStorage } from 'electron'
import Store from 'electron-store'
import type { ModelCapability, ModelInput, ModelProfile, ModelStatus, Tone } from '../../shared/types'
import log from '../logger'

interface StoredModel {
  id: string
  name: string
  provider: string
  endpoint: string
  encryptedKey: string | null
  model: string
  caps: string[]
  capabilities: ModelCapability[]
  probeNote: string
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

/**
 * 不预置任何服务商。模型服务完全由用户配置，
 * 预置假条目会让未配置的服务看起来像已配置（OR-01）。
 */
function seedModels(): StoredModel[] {
  return []
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
    capabilities: model.capabilities ?? [],
    probeNote: model.probeNote ?? '',
    status: model.status,
    tone: model.tone,
    default: model.default,
    latency: model.latency
  }
}

/** demo 版预置过的假配置 id，清理时只认这三条。 */
const DEMO_SEED_IDS = ['openai-main', 'claude-long', 'qwen-local']

export class ModelRegistry {
  private readonly listeners = new Set<(models: ModelProfile[]) => void>()
  private readonly verificationVersions = new Map<string, number>()
  private readonly connectionEpochs = new Map<string, number>()
  private readonly statusSnapshots = new WeakMap<ResolvedModel, { id: string; epoch: number }>()
  private store = new Store<ModelStoreShape>({
    name: 'murasame-models',
    defaults: { models: seedModels() }
  })

  constructor() {
    this.pruneDemoSeeds()
  }

  /**
   * 早期版本把三条假配置写进了磁盘，删掉种子函数不会影响已存的数据。
   * 这里只清理从未配置过密钥的那几条，用户自己填过的不动。
   */
  private pruneDemoSeeds(): void {
    const models = this.store.get('models')
    const kept = models.filter((model) => !(DEMO_SEED_IDS.includes(model.id) && !model.encryptedKey))
    if (kept.length === models.length) return
    if (kept.length > 0 && !kept.some((model) => model.default)) kept[0].default = true
    this.writeModels(kept)
  }

  list(): ModelProfile[] {
    return this.store.get('models').map(publicProfile)
  }

  subscribe(listener: (models: ModelProfile[]) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private writeModels(models: StoredModel[], committed?: () => void): void {
    this.store.set('models', models)
    committed?.()
    const snapshot = models.map(publicProfile)
    for (const listener of this.listeners) {
      try { listener(structuredClone(snapshot)) } catch { /* Observers cannot undo a saved configuration. */ }
    }
  }

  remove(id: string): ModelProfile[] {
    const models = this.store.get('models')
    const target = models.find((item) => item.id === id)
    if (!target) throw new Error('模型配置不存在')
    const kept = models.filter((item) => item.id !== id)
    // 删掉当前服务后，把第一条顶上，避免没有可用配置却仍显示有。
    if (target.default && kept.length > 0) kept[0].default = true
    this.writeModels(kept, () => this.invalidateConnectionStatus(id))
    return kept.map(publicProfile)
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
      // 地址与模型名留空，由用户选模板或自己填，不替用户假定某一家。
      endpoint: '',
      encryptedKey: null,
      model: '',
      caps: [],
      capabilities: [],
      probeNote: '',
      status: '未验证',
      tone: 'gray',
      default: false,
      latency: '—'
    }
    const existing = this.store.get('models')
    // 第一条配置直接设为当前服务，省去用户再点一次。
    if (existing.length === 0) model.default = true
    this.writeModels([...existing, model])
    return publicProfile(model)
  }

  save(id: string, input: ModelInput): ModelProfile {
    const models = this.store.get('models')
    const index = models.findIndex((item) => item.id === id)
    if (index < 0) throw new Error('模型配置不存在')
    const next = this.withInput(models[index], input)
    const updated = [...models]
    updated[index] = next
    const previous = models[index]
    this.writeModels(updated, () => {
      this.nextVerificationVersion(id)
      if (previous.provider !== next.provider || previous.endpoint !== next.endpoint
        || previous.model !== next.model || Boolean(input.key.trim())) this.invalidateConnectionStatus(id)
    })
    return publicProfile(next)
  }

  /** 候选配置只在内存中探测；成功提交前不影响当前服务。 */
  prepareVerification(id: string, input?: ModelInput): {
    model: ResolvedModel
    commit: (capabilities: ModelCapability[], latencyMs: number, note: string) => ModelProfile
  } {
    const current = this.store.get('models').find((model) => model.id === id)
    if (!current) throw new Error('模型配置不存在')
    const candidate = input ? this.withInput(current, input) : current
    const version = this.nextVerificationVersion(id)
    return {
      model: this.resolveStored(candidate),
      commit: (capabilities, latencyMs, note) => {
        const models = this.store.get('models')
        const index = models.findIndex((model) => model.id === id)
        if (index < 0) throw new Error('模型配置已被删除，验证结果未保存')
        if (this.verificationVersions.get(id) !== version) throw new Error('模型配置已有较新的修改，之前的验证结果未保存，请重新验证')
        const next: StoredModel = {
          ...candidate, default: models[index].default, capabilities, probeNote: note,
          status: '在线', tone: 'green', latency: `${latencyMs} ms`
        }
        models[index] = next
        // This explicit verification is newer evidence than in-flight chats,
        // even if the user verified exactly the same connection again.
        this.writeModels(models, () => {
          this.nextVerificationVersion(id)
          this.invalidateConnectionStatus(id)
        })
        return publicProfile(next)
      }
    }
  }

  private nextVerificationVersion(id: string): number {
    const version = (this.verificationVersions.get(id) ?? 0) + 1
    this.verificationVersions.set(id, version)
    return version
  }

  private invalidateConnectionStatus(id: string): void {
    this.connectionEpochs.set(id, (this.connectionEpochs.get(id) ?? 0) + 1)
  }

  private withInput(current: StoredModel, input: ModelInput): StoredModel {
    const newKey = input.key.trim()
    let encryptedKey = current.encryptedKey
    if (newKey) encryptedKey = this.encryptKey(newKey)
    const connectionChanged =
      current.provider !== input.provider ||
      current.endpoint !== input.endpoint ||
      current.model !== input.model ||
      Boolean(newKey)
    return {
      ...current,
      name: input.name,
      provider: input.provider,
      endpoint: input.endpoint,
      encryptedKey,
      model: input.model,
      caps: [...input.caps],
      capabilities: connectionChanged ? [] : current.capabilities ?? [],
      probeNote: connectionChanged ? '' : current.probeNote ?? '',
      status: connectionChanged ? '未验证' : current.status,
      tone: connectionChanged ? 'gray' : current.tone,
      latency: connectionChanged ? '—' : current.latency
    }
  }

  setDefault(id: string): ModelProfile[] {
    const models = this.store.get('models')
    const target = models.find((model) => model.id === id)
    if (!target) throw new Error('模型配置不存在')
    const chat = target.capabilities?.find((item) => item.id === 'text.chat' && item.status === 'verified')
    if (target.status !== '在线' || !chat) {
      throw new Error('该模型尚未通过连接验证，当前服务保持不变，请先验证配置')
    }
    const probedAt = Date.parse(chat.probedAt)
    if ((!Number.isFinite(probedAt) || Date.now() - probedAt > 14 * 24 * 60 * 60 * 1000) && !(target.probeNote ?? '').includes('建议重新验证')) {
      target.probeNote = [target.probeNote, '探测结果已超过有效期，建议重新验证'].filter(Boolean).join('；')
    }
    const updated = models.map((model) => ({ ...model, default: model.id === id }))
    this.writeModels(updated)
    return updated.map(publicProfile)
  }

  saveCapabilities(id: string, capabilities: ModelCapability[], note = ''): ModelProfile {
    const models = this.store.get('models')
    const index = models.findIndex((item) => item.id === id)
    if (index < 0) throw new Error('模型配置不存在')
    const updated = [...models]
    updated[index] = { ...updated[index], capabilities, probeNote: note }
    this.writeModels(updated)
    return publicProfile(updated[index])
  }

  markVerified(id: string, latencyMs: number, expected?: ResolvedModel): ModelProfile | null {
    return this.updateStatus(id, '在线', 'green', `${latencyMs} ms`, expected)
  }

  markOffline(id: string, expected?: ResolvedModel): ModelProfile | null {
    return this.updateStatus(id, '离线', 'red', '连接失败', expected)
  }

  private resolveStored(model: StoredModel): ResolvedModel {
    const resolved = { ...publicProfile(model), apiKey: this.decryptKey(model.encryptedKey) }
    this.statusSnapshots.set(resolved, { id: model.id, epoch: this.connectionEpochs.get(model.id) ?? 0 })
    return resolved
  }

  private updateStatus(id: string, status: ModelStatus, tone: Tone, latency: string, expected?: ResolvedModel): ModelProfile | null {
    const models = this.store.get('models')
    const index = models.findIndex((item) => item.id === id)
    if (expected) {
      const snapshot = this.statusSnapshots.get(expected)
      // A late reply still belongs to its conversation, but cannot attest to a
      // replaced/deleted connection. Tokens stay private; no credentials or
      // revision markers need to be serialized into profiles or conversation data.
      if (index < 0 || snapshot?.id !== id || snapshot.epoch !== (this.connectionEpochs.get(id) ?? 0)) return null
    }
    if (index < 0) throw new Error('模型配置不存在')
    const updated = [...models]
    updated[index] = { ...updated[index], status, tone, latency }
    this.writeModels(updated)
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
