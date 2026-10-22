import type { ToolRun } from './terminal'

export function browserDecision(url: string): 'allow' | 'denied' {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'denied'
    if (parsed.username || parsed.password) return 'denied'
    return 'allow'
  } catch {
    return 'denied'
  }
}

export async function readVisiblePage(url: string, fetchImpl: typeof fetch = fetch): Promise<ToolRun> {
  if (browserDecision(url) === 'denied') {
    return {
      status: 'error',
      raw: '只读取公开网页，不携带登录状态',
      evidence: { kind: 'http-status', target: url, expected: '2xx', actual: '拒绝', matched: false }
    }
  }
  try {
    const response = await fetchImpl(url, { headers: { Accept: 'text/html' }, redirect: 'follow' })
    const text = (await response.text()).replace(/\s+/g, ' ').trim().slice(0, 4000)
    const matched = response.status >= 200 && response.status < 400 && text.length > 0
    return {
      status: matched ? 'ok' : 'error',
      raw: text || `status=${response.status}`,
      evidence: { kind: 'http-status', target: url, expected: '2xx', actual: String(response.status), matched }
    }
  } catch (error) {
    return {
      status: 'error',
      raw: error instanceof Error ? error.message : '网页读取失败',
      evidence: { kind: 'http-status', target: url, expected: '2xx', actual: '失败', matched: false }
    }
  }
}
