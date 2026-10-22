export const EMBEDDING_MODEL_ID = 'nomic-embed-text'
export const EMBEDDING_DIM = 768

export function vectorsCompatible(storedModelId: string, storedDim: number): 'ok' | 'recompute' {
  if (storedModelId !== EMBEDDING_MODEL_ID || storedDim !== EMBEDDING_DIM) return 'recompute'
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
    .filter((entry) => entry.vector)
    .sort((a, b) => cosine(queryVector, b.vector ?? []) - cosine(queryVector, a.vector ?? []))
    .map((entry) => entry.id)
  const ids = rrf([semantic, lexical]).slice(0, 8)
  const injected = ids.map((id) => entries.find((entry) => entry.id === id)).filter((entry): entry is RecallEntry => Boolean(entry))
  return { ids, degraded: false, injected: limitTokens(injected) }
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

export async function embedLocally(text: string, fetchImpl: typeof fetch = fetch): Promise<number[] | null> {
  try {
    const response = await fetchImpl('http://127.0.0.1:11434/api/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBEDDING_MODEL_ID, prompt: text }),
      signal: AbortSignal.timeout(800)
    })
    if (!response.ok) return null
    const payload = await response.json() as { embedding?: number[] }
    if (!payload.embedding || payload.embedding.length !== EMBEDDING_DIM) return null
    return payload.embedding
  } catch {
    return null
  }
}

