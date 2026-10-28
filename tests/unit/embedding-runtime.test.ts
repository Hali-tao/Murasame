import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import type { SqliteDatabase } from '../../src/main/data/sqlite-types'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'

const sdk = vi.hoisted(() => ({ pipeline: vi.fn(), env: { allowRemoteModels: true, localModelPath: '' }, encode: vi.fn() }))
vi.mock('@huggingface/transformers', () => ({ pipeline: sdk.pipeline, env: sdk.env }))
const roots: string[] = []
const files = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx']
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'embedding-contract-')); roots.push(root)
  return root
}
function model(root: string) {
  const path = join(root, 'bge-small-zh-v1.5')
  for (const file of files) { const target = join(path, file); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, 'fixture-model-boundary') }
  return path
}
beforeEach(() => {
  vi.resetModules(); sdk.pipeline.mockReset(); sdk.encode.mockReset(); sdk.env.allowRemoteModels = true
  sdk.encode.mockResolvedValue({ data: new Float32Array([1, ...Array(511).fill(0)]) })
  sdk.pipeline.mockResolvedValue(sdk.encode)
})
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

it('[FR-14] BGE使用官方CLS句向量并归一化，不取token均值', async () => {
  const root = fixture(); model(join(root, 'models'))
  const { embedLocally } = await import('../../src/main/local/embedding')
  expect((await embedLocally('独立合成资料', root))?.length).toBe(512)
  expect(sdk.encode).toHaveBeenCalledWith('独立合成资料', { pooling: 'cls', normalize: true })
})

it('[NFR-C02] 编码方法也是索引身份，旧mean向量不能与CLS混用', async () => {
  const { vectorsCompatible, EMBEDDING_MODEL_ID, EMBEDDING_DIM } = await import('../../src/main/local/embedding')
  expect(vectorsCompatible(EMBEDDING_MODEL_ID, EMBEDDING_DIM)).toBe('recompute')
  expect(vectorsCompatible(EMBEDDING_MODEL_ID, EMBEDDING_DIM, 'cls-q8-l2-v1')).toBe('ok')
  expect(vectorsCompatible(EMBEDDING_MODEL_ID, EMBEDDING_DIM, 'mean-q8-l2-v1')).toBe('recompute')
})

it('[NFR-C01] 用户只下载语音模型时仍使用安装包内完整记忆模型', async () => {
  const root = fixture(); const bundled = fixture(); const expected = model(bundled)
  mkdirSync(join(root, 'models/whisper'), { recursive: true })
  const { setBundledModelsRoot } = await import('../../src/main/local/model-env'); setBundledModelsRoot(bundled)
  const { embedLocally, missingEmbeddingFiles } = await import('../../src/main/local/embedding')
  expect(missingEmbeddingFiles(root)).toEqual([])
  expect(await embedLocally('独立资料', root)).not.toBeNull()
  expect(sdk.pipeline).toHaveBeenCalledWith('feature-extraction', expected, expect.objectContaining({ local_files_only: true }))
  expect(sdk.env.allowRemoteModels).toBe(false)
})

it('[NFR-C01] 不完整用户覆盖不遮蔽完整内置模型，完整覆盖优先且不拼接两份模型', async () => {
  const root = fixture(); const bundled = fixture(); const bundledModel = model(bundled)
  mkdirSync(join(root, 'models/bge-small-zh-v1.5'), { recursive: true })
  writeFileSync(join(root, 'models/bge-small-zh-v1.5/config.json'), 'partial')
  const { setBundledModelsRoot } = await import('../../src/main/local/model-env'); setBundledModelsRoot(bundled)
  const { embedLocally } = await import('../../src/main/local/embedding')
  await embedLocally('内置', root)
  const localModel = model(join(root, 'models'))
  await embedLocally('完整本地', root)
  expect(sdk.pipeline.mock.calls.map(call => call[1])).toEqual([bundledModel, localModel])
})

it('[NFR-P01] 并行首次召回共享一次模型加载，失败后允许重新加载', async () => {
  const root = fixture(); model(join(root, 'models'))
  let release!: (value: typeof sdk.encode) => void
  sdk.pipeline.mockImplementation(() => new Promise(resolve => { release = resolve }))
  const { embedLocally } = await import('../../src/main/local/embedding')
  const first = embedLocally('第一条', root), second = embedLocally('第二条', root)
  await vi.waitFor(() => expect(sdk.pipeline).toHaveBeenCalled())
  const calls = sdk.pipeline.mock.calls.length
  release(sdk.encode)
  expect(calls).toBe(1)
  await Promise.all([first, second])
})

it('[NFR-R02] 本地加载失败可重试，非法向量不进入索引', async () => {
  const root = fixture(); model(join(root, 'models'))
  sdk.pipeline.mockRejectedValueOnce(new Error('fixture failure'))
  const { embedLocally } = await import('../../src/main/local/embedding')
  expect(await embedLocally('先失败', root)).toBeNull()
  expect(await embedLocally('重试', root)).not.toBeNull()
  sdk.encode.mockResolvedValue({ data: new Float32Array([NaN, ...Array(511).fill(0)]) })
  expect(await embedLocally('损坏数据', root)).toBeNull()
})

it('[NFR-C02] 编码方法升级持久失效旧向量，保留事实并在后台重建后跨重启使用', async () => {
  const root = fixture(); model(join(root, 'models'))
  const raw = new DatabaseSync(':memory:')
  for (const file of ['001_init.sql', '002_memory.sql', '003_trace.sql']) raw.exec(readFileSync(`src/main/data/migrations/${file}`, 'utf8'))
  const db: SqliteDatabase = {
    prepare: sql => raw.prepare(sql) as unknown as ReturnType<SqliteDatabase['prepare']>, exec: sql => { raw.exec(sql); return db }, pragma: () => undefined, close: () => raw.close(),
    transaction: work => () => { raw.exec('BEGIN'); try { const value = work(); raw.exec('COMMIT'); return value } catch (error) { raw.exec('ROLLBACK'); throw error } }
  }
  try {
    const { MemoryService } = await import('../../src/main/core/services/memory-service')
    const service = new MemoryService(db, root)
    await service.add('user', '合成偏好：不吃辣')
    raw.prepare("UPDATE meta SET value = 'bge-small-zh-v1.5:512' WHERE key = 'embedding'").run()
    const reopened = new MemoryService(db, root)
    expect(reopened.list().map(item => item.text)).toEqual(['合成偏好：不吃辣'])
    expect(reopened.active()[0].vector).toBeNull()
    expect(raw.prepare('SELECT vector_json FROM memories').get()?.vector_json).toBeNull()
    expect(raw.prepare("SELECT value FROM meta WHERE key = 'embedding'").get()?.value).toBe('bge-small-zh-v1.5:512:cls-q8-l2-v1')
    await reopened.recall('合成偏好')
    await vi.waitFor(() => expect(reopened.indexStatus().state).toBe('idle'))
    expect(new MemoryService(db, root).active()[0].vector).not.toBeNull()
  } finally { raw.close() }
})
