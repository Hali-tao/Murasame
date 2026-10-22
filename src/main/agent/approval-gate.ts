export type ApprovalScope = 'once' | 'task'

export interface ApprovalKey {
  toolId: string
  scope: string
}

export function approvalKey(toolId: string, scope: string): string {
  return `${toolId}:${scope}`
}

export function authorize(
  sensitive: boolean,
  decision: 'approve' | 'deny' | 'pending',
  key: string,
  granted: ReadonlyMap<string, ApprovalScope>
): 'execute' | 'blocked' | 'ask' {
  if (!sensitive) return 'execute'
  if (decision === 'deny') return 'blocked'
  if (granted.get(key) === 'task' || granted.get(key) === 'once') return decision === 'pending' ? 'execute' : 'execute'
  if (decision === 'approve') return 'execute'
  return 'ask'
}

export function grant(key: string, scope: ApprovalScope, granted: Map<string, ApprovalScope>): void {
  granted.set(key, scope)
}

export function consumeOnce(key: string, granted: Map<string, ApprovalScope>): void {
  if (granted.get(key) === 'once') granted.delete(key)
}

export function approvalExpired(requestedAt: number, now: number, limitMs = 10 * 60 * 1000): boolean {
  return now - requestedAt >= limitMs
}
