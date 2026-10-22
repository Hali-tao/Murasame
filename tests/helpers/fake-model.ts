export type FakeOutcome =
  | { kind: 'text'; text: string }
  | { kind: 'schema-mismatch' }
  | { kind: 'timeout' }
  | { kind: 'http'; status: 401 | 429 }
  | { kind: 'empty' }
  | { kind: 'stream-break' }
  | { kind: 'lie-success'; claim: string }

export class FakeModel {
  private index = 0

  constructor(private readonly script: FakeOutcome[]) {}

  async next(): Promise<string> {
    const step = this.script[this.index] ?? { kind: 'empty' as const }
    this.index += 1
    if (step.kind === 'text') return step.text
    if (step.kind === 'schema-mismatch') return '{"action":"ADD"}'
    if (step.kind === 'timeout') throw new Error('模型请求超时（120 秒），请检查网络或服务地址')
    if (step.kind === 'http' && step.status === 401) throw new Error('API Key 无效、已过期或没有访问该模型的权限（HTTP 401/403）')
    if (step.kind === 'http') throw new Error('请求过于频繁或额度不足（HTTP 429），请稍后重试')
    if (step.kind === 'empty') return ''
    if (step.kind === 'stream-break') throw new Error('模型服务没有返回可读取的响应流')
    return step.claim
  }
}
