import { randomUUID } from 'node:crypto'

export type MemoryCategory = 'user' | 'feedback' | 'project' | 'reference'

export interface MemoryFact {
  id: string
  category: MemoryCategory
  text: string
  normalizedKey: string
  validUntil: string | null
  emotion: string
  source?: string
  vector?: number[] | null
  createdAt?: string
  updatedAt?: string
}

const secretPattern = /sk-[A-Za-z0-9_-]{8,}|api[_-]?key|密码是|原始屏幕|screenshot/i

export function normalizeKey(text: string): string {
  return text.replace(/\s+/g, '').toLowerCase()
}

export function extractCandidates(text: string): Array<{ category: MemoryCategory; text: string }> {
  const found: Array<{ category: MemoryCategory; text: string }> = []
  const patterns: Array<{ category: MemoryCategory; pattern: RegExp }> = [
    { category: 'user', pattern: /请叫我([^，。！\s]{1,20})/ },
    { category: 'user', pattern: /我喜欢([^，。！]{1,40})/ },
    { category: 'feedback', pattern: /我不([^，。！]{1,40})/ },
    { category: 'user', pattern: /我习惯([^，。！]{1,40})/ },
    { category: 'project', pattern: /记住[：:]([^，。！]{1,80})/ },
    { category: 'user', pattern: /我的名字是([^，。！\s]{1,20})/ },
    { category: 'user', pattern: /以后叫我([^，。！\s]{1,20})/ },
    { category: 'feedback', pattern: /我希望([^，。！]{1,40})/ },
    { category: 'project', pattern: /请记住([^，。！]{1,80})/ }
  ]
  for (const rule of patterns) {
    const match = rule.pattern.exec(text)
    if (match?.[1]) found.push({ category: rule.category, text: match[1].trim() })
  }
  return found.filter((item) => safeCandidate(item.text))
}

function emotionOf(text: string): string {
  if (/不|讨厌|烦|怕/.test(text)) return 'aversion'
  if (/喜欢|习惯|偏好/.test(text)) return 'preference'
  if (/累|困/.test(text)) return 'fatigue'
  if (/急|担心/.test(text)) return 'concern'
  if (/开心|高兴/.test(text)) return 'joy'
  if (/专注|目标/.test(text)) return 'focus'
  if (/平静|还好/.test(text)) return 'calm'
  return 'neutral'
}

/** 模型提出的候选里可能混进密钥或提交信息，这些不进记忆。 */
export function safeCandidate(text: string): boolean {
  return !secretPattern.test(text) && !/git\s|commit/i.test(text)
}

export function applyMemoryAction(
  existing: MemoryFact[],
  candidate: { category: MemoryCategory; text: string },
  action: 'ADD' | 'UPDATE' | 'DELETE' | 'NOOP',
  now: string,
  suppressed: ReadonlySet<string>,
  replaces?: string
): MemoryFact[] {
  if (action === 'NOOP') return existing
  const key = normalizeKey(candidate.text)
  if (suppressed.has(key) && action !== 'DELETE') return existing
  if (action === 'ADD' && existing.some((item) => item.normalizedKey === key && !item.validUntil)) return existing
  if (action === 'ADD') {
    return [...existing, { id: `mem-${randomUUID()}`, category: candidate.category, text: candidate.text, normalizedKey: key, validUntil: null, emotion: emotionOf(candidate.text), createdAt: now, updatedAt: now }]
  }
  const targetKey = replaces?.trim() ? normalizeKey(replaces) : key
  const target = existing.find((item) => (item.id === replaces || item.normalizedKey === targetKey) && !item.validUntil)
  if (action === 'UPDATE' && !target) return existing
  return existing.map((item) =>
    (item.id === replaces || item.normalizedKey === targetKey) && !item.validUntil ? { ...item, validUntil: now, updatedAt: now } : item
  ).concat(action === 'UPDATE'
    ? [{ id: `mem-${randomUUID()}`, category: candidate.category, text: candidate.text, normalizedKey: key, validUntil: null, emotion: emotionOf(candidate.text), source: target?.source, createdAt: now, updatedAt: now }]
    : [])
}

export function activeMemories(entries: readonly MemoryFact[]): MemoryFact[] {
  return entries.filter((item) => !item.validUntil)
}
