import { activeMemories, applyMemoryAction, extractCandidates, normalizeKey, safeCandidate, type MemoryCategory, type MemoryFact } from '../memory/facts'

export type ExtractPurpose = 'read' | 'memory-write' | 'mutate'

export interface ProposedMemory {
  action: 'ADD' | 'UPDATE' | 'DELETE'
  category: MemoryCategory
  text: string
  replaces?: string
}

/** 由模型从整句话里提出候选，不先用句式筛。模型调用失败时这一轮什么都不写。 */
export async function runModelExtraction(
  text: string,
  existing: readonly MemoryFact[],
  suppressed: ReadonlySet<string>,
  propose: (text: string, known: string[]) => Promise<ProposedMemory[]>
): Promise<{ facts: MemoryFact[]; failed: boolean }> {
  try {
    const known = activeMemories(existing).map((item) => item.text).slice(0, 30)
    const proposals = await propose(text, known)
    const now = new Date().toISOString()
    let facts = [...existing]
    for (const item of proposals) {
      const candidate = { category: item.category, text: item.text.trim() }
      if (!candidate.text || !safeCandidate(candidate.text)) continue
      if (item.action !== 'DELETE' && suppressed.has(normalizeKey(candidate.text))) continue
      facts = applyMemoryAction(facts, candidate, item.action, now, suppressed, item.replaces)
    }
    return { facts, failed: false }
  } catch {
    return { facts: [...existing], failed: true }
  }
}

export interface ExtractionRequest {
  toolId: string
  purpose: ExtractPurpose
}

export function guardExtractionTool(purpose: ExtractPurpose): { allowed: boolean; reason: string } {
  if (purpose === 'read' || purpose === 'memory-write') return { allowed: true, reason: '' }
  return { allowed: false, reason: '提取过程只能读取和写入记忆，已拒绝该调用' }
}

export async function runExtractionAsync(
  text: string,
  existing: readonly MemoryFact[],
  suppressed: ReadonlySet<string>,
  judge: (candidate: { category: MemoryCategory; text: string }) => Promise<'ADD' | 'UPDATE' | 'DELETE' | 'NOOP'>,
  calls: readonly ExtractionRequest[] = []
): Promise<{ facts: MemoryFact[]; denied: string[]; failed: boolean }> {
  const denied = calls.filter((call) => !guardExtractionTool(call.purpose).allowed).map((call) => call.toolId)
  if (denied.length > 0) return { facts: [...existing], denied, failed: true }
  try {
    const now = new Date().toISOString()
    let facts = [...existing]
    const candidates = extractCandidates(text).filter((item) => !suppressed.has(normalizeKey(item.text)))
    const actions: Array<{ candidate: { category: MemoryCategory; text: string }; action: 'ADD' | 'UPDATE' | 'DELETE' | 'NOOP' }> = []
    for (const candidate of candidates) actions.push({ candidate, action: await judge(candidate) })
    for (const item of actions) facts = applyMemoryAction(facts, item.candidate, item.action, now, suppressed)
    return { facts, denied, failed: false }
  } catch {
    return { facts: [...existing], denied, failed: true }
  }
}

export function extractionOrder(calls: readonly ExtractionRequest[]): 'separated' | 'interleaved' | 'denied' {
  if (calls.some((call) => !guardExtractionTool(call.purpose).allowed)) return 'denied'
  const purposes = calls.map((call) => call.purpose)
  const firstWrite = purposes.indexOf('memory-write')
  const lastRead = purposes.lastIndexOf('read')
  if (firstWrite !== -1 && lastRead > firstWrite) return 'interleaved'
  return 'separated'
}

export function runExtraction(
  text: string,
  existing: readonly MemoryFact[],
  suppressed: ReadonlySet<string>,
  calls: readonly ExtractionRequest[] = [],
  judge: (candidate: { category: MemoryCategory; text: string }) => 'ADD' | 'UPDATE' | 'DELETE' | 'NOOP' = () => 'ADD'
): { facts: MemoryFact[]; denied: string[]; failed: boolean } {
  const denied = calls.filter((call) => !guardExtractionTool(call.purpose).allowed).map((call) => call.toolId)
  const reads = calls.filter((call) => call.purpose === 'read')
  const writes = calls.filter((call) => call.purpose === 'memory-write')
  if (extractionOrder([...reads, ...writes]) === 'interleaved') {
    return { facts: [...existing], denied, failed: true }
  }
  try {
    void reads
    const now = new Date().toISOString()
    let facts = [...existing]
    const candidates = extractCandidates(text).filter((item) => !suppressed.has(normalizeKey(item.text)))
    for (const candidate of candidates) {
      facts = applyMemoryAction(facts, candidate, judge(candidate), now, suppressed)
    }
    void writes
    return { facts, denied, failed: false }
  } catch {
    return { facts: [...existing], denied, failed: true }
  }
}
