import { shell, type WebContents } from 'electron'

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self' https: http://127.0.0.1:* http://localhost:*",
  "frame-src http://127.0.0.1:* http://localhost:*"
].join('; ')

/**
 * 开发服务器会注入内联的 React 预置脚本，严格的 script-src 会把它挡掉导致白屏。
 * 只在开发模式放行内联脚本与开发服务器来源，打包版一律使用严格策略。
 */
export function contentSecurityPolicy(isDevelopment: boolean): string {
  if (!isDevelopment) return CONTENT_SECURITY_POLICY
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' http://localhost:* http://127.0.0.1:*",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self' https: ws://localhost:* ws://127.0.0.1:* http://127.0.0.1:* http://localhost:*",
    "frame-src http://127.0.0.1:* http://localhost:*"
  ].join('; ')
}

export const ISOLATION_FRAME_ALLOWLIST = ['127.0.0.1', 'localhost']

export function navigationDecision(currentUrl: string, targetUrl: string): 'allow' | 'external' | 'block' {
  if (targetUrl === currentUrl || targetUrl.startsWith('devtools://') || targetUrl.startsWith('murasame://')) return 'allow'
  if (/^https?:\/\//i.test(targetUrl)) return 'external'
  return 'block'
}

export function markUntrusted(text: string, source: string): string {
  return `[不可信:${source}] ${text}`
}

export function hardenWebContents(contents: WebContents, openExternal: typeof shell.openExternal): void {
  contents.setWindowOpenHandler(({ url }) => {
    if (navigationDecision(contents.getURL(), url) === 'external') void openExternal(url)
    return { action: 'deny' }
  })
  contents.on('will-navigate', (event, url) => {
    const decision = navigationDecision(contents.getURL(), url)
    if (decision === 'allow') return
    event.preventDefault()
    if (decision === 'external') void openExternal(url)
  })
}
