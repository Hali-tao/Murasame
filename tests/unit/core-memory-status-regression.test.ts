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
  it('does not disable future memory extraction when deleting history fails', async () => {
    vi.spyOn(ModelGateway.prototype, 'chat').mockResolvedValue('完整回答')
    const db = new MemoryDatabase()
    const core = MurasameCore.create(db, models)
    const statuses: string[] = []
    core.onMemoryExtractionStatus = status => statuses.push(status.status)
    const chat = await core.createConversation()
    if (!chat.ok) throw new Error(chat.error)
    vi.spyOn(db, 'transaction').mockImplementationOnce(() => () => { throw new Error('受控历史写入失败') })
    expect((await core.deleteConversation(chat.data.id, ['history'])).ok).toBe(false)
    vi.spyOn(ModelGateway.prototype, 'callStructured').mockResolvedValue({ memories: [{ action: 'ADD', category: 'project', text: '保留会话的新项目' }] })
    await core.sendMessage(chat.data.id, '继续当前会话')
    await vi.waitFor(() => expect(statuses).toEqual(['processing', 'saved']))
  })

  it.each(['update', 'delete'] as const)('withdraws a completed notice after a manual %s', async action => {
    vi.spyOn(ModelGateway.prototype, 'chat').mockResolvedValue('完整回答')
    vi.spyOn(ModelGateway.prototype, 'callStructured').mockResolvedValue({ memories: [{ action: 'ADD', category: 'project', text: '白桦项目' }] })
    const core = MurasameCore.create(new MemoryDatabase(), models)
    const statuses: string[] = []
    core.onMemoryExtractionStatus = status => statuses.push(status.status)
    const chat = await core.createConversation()
    if (!chat.ok) throw new Error(chat.error)
    await core.sendMessage(chat.data.id, '项目信息')
    await vi.waitFor(() => expect(statuses).toEqual(['processing', 'saved']))
    const fact = core.memory.list()[0]
    const result = action === 'update' ? await core.updateMemory(fact.id, 'project', '新的白桦项目') : await core.deleteMemory(fact.id)
    expect(result.ok).toBe(true)
    expect(statuses).toEqual(['processing', 'saved', 'cleared'])
  })

  it('keeps the newer queued extraction processing until its own outcome arrives', async () => {
    vi.spyOn(ModelGateway.prototype, 'chat').mockResolvedValue('完整回答')
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    let calls = 0
    vi.spyOn(ModelGateway.prototype, 'callStructured').mockImplementation(async (_model, _schema, name) => {
      if (name === 'remember') {
        if (++calls === 1) { await gate; return { memories: [] } }
        throw new Error('第二轮受控失败')
      }
      return { intent: '思考', relevance: 0.4, consequence: 0, coping: 0.3, norm: 0 }
    })
    const core = MurasameCore.create(new MemoryDatabase(), models)
    const statuses: string[] = []
    core.onMemoryExtractionStatus = status => statuses.push(status.status)
    const chat = await core.createConversation()
    if (!chat.ok) throw new Error(chat.error)
    await core.sendMessage(chat.data.id, '第一轮'); await core.sendMessage(chat.data.id, '第二轮')
    expect(statuses).toEqual(['processing', 'processing'])
    release()
    await vi.waitFor(() => expect(statuses).toEqual(['processing', 'processing', 'failed']))
  })

  it('withdraws a cleared extraction and ignores its late failure, then accepts a new turn', async () => {
    vi.spyOn(ModelGateway.prototype, 'chat').mockResolvedValue('完整回答')
    let rejectOld!: (reason: Error) => void
    const pending = new Promise<never>((_resolve, reject) => { rejectOld = reject })
    let rememberCalls = 0
    vi.spyOn(ModelGateway.prototype, 'callStructured').mockImplementation(async (_model, _schema, name) => {
      if (name === 'remember') {
        rememberCalls++
        if (rememberCalls === 1) return pending
        return { memories: [{ action: 'ADD', category: 'project', text: '新的白桦项目' }] }
      }
      return { intent: '思考', relevance: 0.4, consequence: 0, coping: 0.3, norm: 0 }
    })
    const core = MurasameCore.create(new MemoryDatabase(), models)
    const ingest = vi.spyOn(core.memory, 'ingestProposed')
    const statuses: string[] = []
    core.onMemoryExtractionStatus = status => statuses.push(status.status)
    const chat = await core.createConversation()
    if (!chat.ok) throw new Error(chat.error)
    await core.sendMessage(chat.data.id, '旧轮次')
    expect((await core.clearMemories()).ok).toBe(true)
    rejectOld(new Error('旧请求迟到的失败'))
    await ingest.mock.results[0].value
    expect(statuses).toEqual(['processing', 'cleared'])
    await core.sendMessage(chat.data.id, '新轮次')
    await vi.waitFor(() => expect(statuses).toEqual(['processing', 'cleared', 'processing', 'saved']))
  })

  it('does not withdraw existing results when clearing fails', async () => {
    vi.spyOn(ModelGateway.prototype, 'chat').mockResolvedValue('完整回答')
    vi.spyOn(ModelGateway.prototype, 'callStructured').mockResolvedValue({ memories: [] })
    const core = MurasameCore.create(new MemoryDatabase(), models)
    const statuses: string[] = []
    core.onMemoryExtractionStatus = status => statuses.push(status.status)
    const chat = await core.createConversation()
    if (!chat.ok) throw new Error(chat.error)
    await core.sendMessage(chat.data.id, '旧轮次')
    await vi.waitFor(() => expect(statuses).toEqual(['processing', 'unchanged']))
    vi.spyOn(core.memory, 'clear').mockResolvedValue({ ok: false, error: '受控保存失败' })
    expect((await core.clearMemories()).ok).toBe(false)
    expect(statuses).toEqual(['processing', 'unchanged'])
  })

  it.each([['history'], ['memory']] as const)('withdraws the selected conversation result after clearing %s', async (scope) => {
    vi.spyOn(ModelGateway.prototype, 'chat').mockResolvedValue('完整回答')
    vi.spyOn(ModelGateway.prototype, 'callStructured').mockResolvedValue({ memories: [] })
    const core = MurasameCore.create(new MemoryDatabase(), models)
    const statuses: string[] = []
    core.onMemoryExtractionStatus = status => statuses.push(status.status)
    const chat = await core.createConversation()
    if (!chat.ok) throw new Error(chat.error)
    await core.sendMessage(chat.data.id, '某轮次')
    await vi.waitFor(() => expect(statuses).toEqual(['processing', 'unchanged']))
    expect((await core.deleteConversation(chat.data.id, [scope])).ok).toBe(true)
    expect(statuses).toEqual(['processing', 'unchanged', 'cleared'])
  })

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
