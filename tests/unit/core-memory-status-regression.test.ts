import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initialSettings } from '../../src/shared/default-settings'
import { MemoryDatabase } from '../helpers/memory-db'
import type { ModelRegistry } from '../../src/main/model/registry'
import { ModelGateway } from '../../src/main/model/gateway'
import { MurasameCore } from '../../src/main/core/murasame-core'
const seams = vi.hoisted(() => ({ settings: {} as Record<string, unknown>, cues: [] as Array<{ text?: string }> }))
vi.mock('electron', () => ({ shell: { openExternal: vi.fn() }, Notification: { isSupported: () => false } }))
vi.mock('../../src/main/windows', () => ({ broadcastPetPerformance: (cue: { text?: string }) => seams.cues.push(cue) }))
vi.mock('../../src/main/logger', () => ({ default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }))
vi.mock('../../src/main/settings', () => ({ getSettings: () => seams.settings, bumpRelationship: vi.fn(), readToolEnabled: () => ({}), writeToolEnabled: vi.fn(), readRelationship: () => ({ stage: '初识' }) }))
const model = { id: 'controlled-model', model: 'local-test', endpoint: 'http://unused.invalid' }
const models = { getDefault: () => model, markOffline: vi.fn(), markVerified: vi.fn() } as unknown as ModelRegistry
beforeEach(() => { vi.restoreAllMocks(); seams.settings = { ...structuredClone(initialSettings), memoryEnabled: true, memoryAutoExtract: true }; seams.cues = [] })

describe('core memory extraction status propagation', () => {
  it('publishes processing then saved or failed without dropping current facts, and keeps performance updates silent', async () => {
    vi.spyOn(ModelGateway.prototype, 'chat').mockResolvedValue('完整回答。保留解释。')
    let failExtraction = false
    vi.spyOn(ModelGateway.prototype, 'callStructured').mockImplementation(async (_model, _schema, name) => {
      if (name === 'remember') {
        if (failExtraction) throw new Error('controlled extraction failure')
        return { memories: [{ action: 'ADD', category: 'project', text: '白桦项目' }] }
      }
      return { intent: '思考', relevance: 0.4, consequence: 0, coping: 0.3, norm: 0 }
    })
    const core = MurasameCore.create(new MemoryDatabase(), models)
    const statuses: string[] = []
    core.onMemoryExtractionStatus = (status) => statuses.push(status.status)
    const chat = await core.createConversation()
    if (!chat.ok) throw new Error(chat.error)
    await core.sendMessage(chat.data.id, '项目事实')
    await vi.waitFor(() => expect(statuses).toEqual(['processing', 'saved']))
    expect(core.memory.list().map((fact) => fact.text)).toEqual(['白桦项目'])
    expect(seams.cues.filter((cue) => cue.text)).toHaveLength(1)
    failExtraction = true
    await core.sendMessage(chat.data.id, '下一轮事实')
    await vi.waitFor(() => expect(statuses).toEqual(['processing', 'saved', 'processing', 'failed']))
    expect(core.memory.list().map((fact) => fact.text)).toEqual(['白桦项目'])
    seams.settings.memoryAutoExtract = false
    await core.sendMessage(chat.data.id, '暂停时的消息')
    expect(statuses.at(-1)).toBe('skipped')
  })
})
