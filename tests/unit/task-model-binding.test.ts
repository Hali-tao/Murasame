import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { SqliteDatabase } from '../../src/main/data/sqlite-types'
import type { ResolvedModel, ModelRegistry } from '../../src/main/model/registry'
import type { TaskPlan } from '../../src/main/agent/executor'
import { initialSettings } from '../../src/shared/default-settings'
import { ModelGateway } from '../../src/main/model/gateway'
import { MurasameCore } from '../../src/main/core/murasame-core'
import { TaskService } from '../../src/main/core/services/task-service'

const seams = vi.hoisted(() => ({ settings: {} as Record<string, unknown> }))
vi.mock('electron', () => ({ shell: { openExternal: vi.fn() }, Notification: { isSupported: () => false } }))
vi.mock('../../src/main/windows', () => ({ broadcastPetPerformance: vi.fn() }))
vi.mock('../../src/main/logger', () => ({ default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }))
vi.mock('../../src/main/settings', () => ({ getSettings: () => seams.settings, bumpRelationship: vi.fn(), readToolEnabled: () => ({}), writeToolEnabled: vi.fn(), readRelationship: () => ({ stage: '初识' }) }))

const databases: DatabaseSync[] = []; const directories: string[] = []
function database(): SqliteDatabase {
  const db = new DatabaseSync(':memory:'); databases.push(db)
  for (const file of ['001_init.sql', '002_memory.sql', '003_trace.sql']) db.exec(readFileSync(`src/main/data/migrations/${file}`, 'utf8'))
  return db as unknown as SqliteDatabase
}
function model(id: string): ResolvedModel {
  return { id, name: id, provider: 'OpenAI Compatible', endpoint: `https://${id}.example/v1`, model: `${id}-model`, apiKey: `${id}-private-credential`, key: '', hasKey: true, caps: [], capabilities: [], probeNote: '', status: '在线', tone: 'green', default: true, latency: '10 ms' }
}
function fixtures() {
  const a = model('first'); const b = model('second'); let current: ResolvedModel | null = a
  const stored = new Map([[a.id, a], [b.id, b]])
  const registry = { getDefault: () => current, resolve: (id: string) => stored.get(id) ?? null } as unknown as ModelRegistry
  return { a, b, registry, stored, select: (selected: ResolvedModel | null) => { current = selected } }
}
function question(): TaskPlan { return { tool: 'browser', question: '需要补充目标', steps: [{ id: 'read', title: '读取网页', detail: '', expected: '', args: { url: 'https://example.com' } }] } }
function plannerModels() {
  const seen: ResolvedModel[] = []
  vi.spyOn(ModelGateway.prototype, 'callStructured').mockImplementation(async selected => { seen.push(structuredClone(selected)); return question() as never })
  return seen
}

beforeEach(() => { seams.settings = { ...structuredClone(initialSettings), memoryEnabled: false, memoryAutoExtract: false, taskNotifications: false } })
afterEach(() => {
  vi.restoreAllMocks()
  for (const db of databases.splice(0)) db.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('[FR-25] 任务模型绑定与恢复', () => {
  it('[FR-25] 创建只捕获一次当前配置，实际规划与持久化快照一致', async () => {
    const f = fixtures(); let reads = 0
    f.registry.getDefault = () => ++reads === 1 ? f.a : f.b
    const seen = plannerModels(); const db = database(); const core = MurasameCore.create(db, f.registry)
    const created = await core.tasks.create('请打开网页 https://example.com')
    expect(created.ok).toBe(true)
    expect(seen.map(item => item.id)).toEqual(['first'])
    expect(core.tasks.list()[0].modelProfileId).toBe('first')
  })

  it('[FR-25] 待确认任务补充要求仍用原模型，新建任务才用新默认模型', async () => {
    const f = fixtures(); const seen = plannerModels(); const core = MurasameCore.create(database(), f.registry)
    const created = await core.tasks.create('请打开网页 https://example.com'); if (!created.ok) throw new Error(created.error)
    f.select(f.b)
    const continued = await core.tasks.continueTask(created.data.id, '请查阅新的页面说明')
    expect(continued.ok).toBe(true)
    await core.tasks.create('请打开另一个网页 https://example.org')
    expect(seen.map(item => item.id)).toEqual(['first', 'first', 'second'])
  })

  it('[FR-25] 同一配置被编辑后运行中的任务仍用原模型和原凭据', async () => {
    const f = fixtures(); const seen = plannerModels(); const core = MurasameCore.create(database(), f.registry)
    const created = await core.tasks.create('请打开网页 https://example.com'); if (!created.ok) throw new Error(created.error)
    f.a.model = 'edited-model'; f.a.apiKey = 'edited-private-credential'
    const continued = await core.tasks.continueTask(created.data.id, '补充网页内容')
    expect(continued.ok).toBe(true)
    expect(seen[1]).toMatchObject({ model: 'first-model', apiKey: 'first-private-credential' })
  })

  it.each(['changed', 'deleted', 'key-rotated'])('[NFR-R02] 重启后原配置%s不能悄悄改用默认模型', async (change) => {
    const f = fixtures(); const seen = plannerModels(); const db = database(); const first = MurasameCore.create(db, f.registry)
    const created = await first.tasks.create('请打开网页 https://example.com'); if (!created.ok) throw new Error(created.error)
    if (change === 'changed') f.a.endpoint = 'https://changed.example/v1'
    if (change === 'deleted') f.stored.delete(f.a.id)
    if (change === 'key-rotated') f.a.apiKey = 'rotated-private-credential'
    f.select(f.b)
    const restarted = MurasameCore.create(db, f.registry)
    const result = await restarted.tasks.continueTask(created.data.id, '补充新的目标')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/原模型|原配置|绑定/)
    expect(seen).toHaveLength(1)
    expect(restarted.tasks.list()[0].modelProfileId).toBe('first')
  })

  it('[FR-25] 重启后原配置未变时按原绑定恢复，不受新默认选择影响', async () => {
    const f = fixtures(); const seen = plannerModels(); const db = database(); const first = MurasameCore.create(db, f.registry)
    const created = await first.tasks.create('请打开网页 https://example.com'); if (!created.ok) throw new Error(created.error)
    f.select(f.b)
    const restarted = MurasameCore.create(db, f.registry)
    const result = await restarted.tasks.continueTask(created.data.id, '补充页面')
    expect(result.ok).toBe(true)
    expect(seen.map(item => item.id)).toEqual(['first', 'first'])
    const stored = JSON.stringify(db.prepare('SELECT snapshot_json FROM task_model_snapshots').all())
    const calls = JSON.stringify(restarted.tasks.list()[0].toolCalls)
    expect(stored + calls).not.toContain('private-credential')
    expect(stored + calls).not.toContain('apiKey')
  })

  it('[NFR-R03] 已核验检查点恢复不请求模型，即使原配置已删除', async () => {
    const root = mkdtempSync(join(tmpdir(), 'model-binding-')); directories.push(root)
    const db = database(); const service = new TaskService(db); const a = model('first')
    service.setModelSnapshotProvider(() => a)
    service.setPlanner(async () => ({ tool: 'filesystem', question: '', root, steps: [
      { id: 'a', title: '写第一项', detail: '', expected: '', args: { action: 'write', path: 'a.txt', content: 'first' }, checks: [{ kind: 'file-content', path: 'a.txt', value: 'first' }] },
      { id: 'b', dependsOn: ['a'], title: '写第二项', detail: '', expected: '', args: { action: 'write', path: 'b.txt', content: 'second' }, checks: [{ kind: 'file-content', path: 'b.txt', value: 'second' }] }
    ] }))
    const created = await service.create(`写入文件 ${root}`); if (!created.ok) throw new Error(created.error)
    await service.approve(created.data.id, 'once'); await service.settled(created.data.id)
    const restarted = new TaskService(db); let calls = 0
    restarted.setModelSnapshotProvider(() => null)
    restarted.setPlanner(async () => { calls += 1; throw new Error('不应重新规划') })
    const resumed = await restarted.continueTask(created.data.id, '继续')
    expect(resumed.ok).toBe(true); expect(calls).toBe(0)
    await restarted.approve(created.data.id, 'task'); await restarted.settled(created.data.id)
    expect(restarted.list()[0].status).toBe('已完成')
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('first')
    expect(readFileSync(join(root, 'b.txt'), 'utf8')).toBe('second')
  })
})
