import { join } from 'node:path'
import { configureLocalModels, localModelDirectory, missingModelFiles } from './model-env'

/**
 * 记忆向量在本机算，不依赖 Ollama。国内直连装不上 Ollama，
 * 而记忆只需要一个中文向量模型，随安装包带走即可。
 */
export const EMBEDDING_MODEL_ID = 'bge-small-zh-v1.5'
export const EMBEDDING_DIM = 512
// Pooling/normalization changes invalidate vectors even when model and dimension match.
export const EMBEDDING_PROFILE = 'cls-q8-l2-v1'
export const EMBEDDING_FILES = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  join('onnx', 'model_quantized.onnx')
]

export function missingEmbeddingFiles(userDataDir: string): string[] {
  return missingModelFiles(localModelDirectory(userDataDir, EMBEDDING_MODEL_ID, EMBEDDING_FILES), EMBEDDING_FILES)
}

export function vectorsCompatible(storedModelId: string, storedDim: number, storedProfile?: string): 'ok' | 'recompute' {
  if (storedModelId !== EMBEDDING_MODEL_ID || storedDim !== EMBEDDING_DIM || storedProfile !== EMBEDDING_PROFILE) return 'recompute'
  return 'ok'
}

export function cosine(left: readonly number[], right: readonly number[]): number {
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  const length = Math.min(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    dot += left[index] * right[index]
    leftNorm += left[index] * left[index]
    rightNorm += right[index] * right[index]
  }
  if (leftNorm === 0 || rightNorm === 0) return 0
  return dot / Math.sqrt(leftNorm * rightNorm)
}

export function rrf(rankings: readonly string[][], k = 60): string[] {
  const scores = new Map<string, number>()
  for (const ranking of rankings) {
    ranking.forEach((id, index) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + index + 1))
    })
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id)
}

export interface RecallEntry {
  id: string
  text: string
  category: string
  vector: number[] | null
}

export function recallMemories(
  query: string,
  entries: readonly RecallEntry[],
  queryVector: number[] | null
): { ids: string[]; degraded: boolean; injected: RecallEntry[] } {
  const lexical = entries.filter((entry) => {
    const tokens = query.split(/[，。\s]/).filter((token) => token.length >= 2)
    return tokens.some((token) => entry.text.includes(token))
  }).map((entry) => entry.id)
  if (!queryVector) {
    return { ids: [], degraded: true, injected: [] }
  }
  const semantic = [...entries]
    .filter((entry) => entry.vector?.length === queryVector.length && cosine(queryVector, entry.vector) >= 0.45)
    .sort((a, b) => cosine(queryVector, b.vector ?? []) - cosine(queryVector, a.vector ?? []))
    .map((entry) => entry.id)
  const ids = rrf([semantic, lexical]).slice(0, 8)
  const injected = ids.map((id) => entries.find((entry) => entry.id === id)).filter((entry): entry is RecallEntry => Boolean(entry))
  const limited = limitTokens(injected)
  return { ids: limited.map((entry) => entry.id), degraded: false, injected: limited }
}

function limitTokens(entries: RecallEntry[]): RecallEntry[] {
  const kept: RecallEntry[] = []
  let tokens = 0
  for (const entry of entries) {
    tokens += entry.text.length
    if (kept.length >= 8 || tokens > 1500) break
    kept.push(entry)
  }
  return kept
}

type Extractor = (
  text: string,
  options: { pooling: 'cls'; normalize: boolean }
) => Promise<{ data: Float32Array }>

let extractor: { directory: string; pending: Promise<Extractor> } | null = null

async function load(userDataDir: string): Promise<Extractor> {
  const directory = localModelDirectory(userDataDir, EMBEDDING_MODEL_ID, EMBEDDING_FILES)
  if (extractor?.directory === directory) return extractor.pending
  const current = { directory, pending: (async () => {
    await configureLocalModels(userDataDir)
    const { pipeline } = await import('@huggingface/transformers')
    return await pipeline('feature-extraction', directory, { dtype: 'q8', device: 'cpu', local_files_only: true }) as unknown as Extractor
  })() }
  extractor = current
  try { return await current.pending } catch (error) {
    if (extractor === current) extractor = null
    throw error
  }
}

/**
 * 算不出来时返回 null，调用方会如实降级，不会拿关键词硬凑当成语义召回。
 * BGE v1.5 的短句可不加查询前缀；按官方规范取首token(CLS)并归一化。
 */
export async function embedLocally(text: string, userDataDir: string): Promise<number[] | null> {
  if (missingEmbeddingFiles(userDataDir).length > 0) return null
  try {
    const run = await load(userDataDir)
    const output = await run(text, { pooling: 'cls', normalize: true })
    if (output.data.length !== EMBEDDING_DIM) return null
    const vector = Array.from(output.data)
    return vector.every(Number.isFinite) && vector.some(value => value !== 0) ? vector : null
  } catch {
    return null
  }
}

