import type { ToolRun } from './terminal'
export function browserDecision(url: string): 'allow' | 'denied' {
  try { const parsed = new URL(url); return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password ? 'allow' : 'denied' } catch { return 'denied' }
}
export async function readVisiblePage(url: string, fetchImpl: typeof fetch = fetch, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<ToolRun> {
  const result = (status: ToolRun['status'], raw: string, actual: string, matched = false): ToolRun => ({ status, raw, evidence: { kind: 'http-status', target: url, expected: '2xx', actual, matched } })
  if (browserDecision(url) === 'denied') return result('error', '只读取公开网页，不携带登录状态', '拒绝')
  const controller = new AbortController(); const abort = (): void => controller.abort(options.signal?.reason)
  options.signal?.addEventListener('abort', abort, { once: true }); if (options.signal?.aborted) abort()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 8000)
  try {
    if (controller.signal.aborted) return result('aborted', '网页读取已取消', '取消')
    let target = url
    let response: Response | undefined
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      if (browserDecision(target) === 'denied') return result('error', '重定向地址超出公开网页范围', '拒绝')
      response = await fetchImpl(target, { signal: controller.signal, headers: { Accept: 'text/html' }, redirect: 'manual', credentials: 'omit' })
      if (![301, 302, 303, 307, 308].includes(response.status)) break
      const location = response.headers.get('location'); if (!location || redirects === 5) return result('error', '网页重定向无效或次数过多', String(response.status))
      target = new URL(location, target).href
    }
    if (!response) return result('error', '网页没有响应', '失败')
    const text = (await response.text()).replace(/\s+/g, ' ').trim().slice(0, 4000)
    if (controller.signal.aborted) return result(options.signal?.aborted ? 'aborted' : 'timeout', '网页读取已停止', '中止')
    const matched = response.status >= 200 && response.status < 300 && text.length > 0
    return result(matched ? 'ok' : 'error', text || `status=${response.status}`, String(response.status), matched)
  } catch (error) { return result(controller.signal.aborted ? options.signal?.aborted ? 'aborted' : 'timeout' : 'error', error instanceof Error ? error.message : '网页读取失败', '失败') }
  finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort) }
}
