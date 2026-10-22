export const SENSITIVE_PROCESSES = ['keepass', '1password', 'bitwarden', 'lastpass', 'dashlane', '密码']

export interface WindowFacts {
  title: string
  processName: string
  passwordField: boolean
  displayAffinity: number
  tree: string
  selectedText: string
  /** 窗口在屏幕上的物理像素矩形，用来从整屏截图里裁出目标窗口。 */
  bounds?: { x: number; y: number; width: number; height: number }
}

/** 窗口矩形和截图对得上才裁剪，否则（例如窗口在副屏）用整屏，不裁出错位的画面。 */
export function cropRect(
  bounds: WindowFacts['bounds'],
  image: { width: number; height: number }
): { x: number; y: number; width: number; height: number } | null {
  if (!bounds || bounds.width < 40 || bounds.height < 40) return null
  const x = Math.max(0, Math.round(bounds.x))
  const y = Math.max(0, Math.round(bounds.y))
  const width = Math.min(image.width - x, Math.round(bounds.width + Math.min(0, bounds.x)))
  const height = Math.min(image.height - y, Math.round(bounds.height + Math.min(0, bounds.y)))
  if (width < 40 || height < 40) return null
  return { x, y, width, height }
}

export function isSensitiveWindow(window: Pick<WindowFacts, 'title' | 'processName' | 'passwordField' | 'displayAffinity'>): { sensitive: boolean; reason: string } {
  if (window.displayAffinity === 0x11) return { sensitive: true, reason: '该窗口声明不参与系统截图，已跳过采集' }
  if (window.passwordField) return { sensitive: true, reason: '前台正在输入密码，已跳过采集' }
  const name = `${window.processName} ${window.title}`.toLowerCase()
  if (SENSITIVE_PROCESSES.some((item) => name.includes(item))) return { sensitive: true, reason: '敏感应用不采集，请改用文字描述' }
  return { sensitive: false, reason: '' }
}

export function captureAllowed(input: { authorized: boolean; window: WindowFacts; revoked: boolean }): { capture: boolean; reason: string } {
  if (!input.authorized || input.revoked) return { capture: false, reason: '没有屏幕读取授权，不会采集' }
  const sensitive = isSensitiveWindow(input.window)
  if (sensitive.sensitive) return { capture: false, reason: sensitive.reason }
  return { capture: true, reason: '' }
}

export interface WatchInput {
  enabled: boolean
  intervalSeconds: 5 | 15 | 60
  hidden: boolean
  doNotDisturb: boolean
  locked: boolean
  authorized: boolean
  failures: number
}

export function watchDecision(input: WatchInput): { run: boolean; status: 'off' | 'running' | 'paused' | 'fused'; reason: string } {
  if (!input.enabled) return { run: false, status: 'off', reason: '持续观察默认关闭' }
  if (![5, 15, 60].includes(input.intervalSeconds)) return { run: false, status: 'paused', reason: '采样间隔只能是 5、15 或 60 秒' }
  if (input.failures >= 3) return { run: false, status: 'fused', reason: '连续 3 次采集失败，持续观察已停止' }
  if (!input.authorized) return { run: false, status: 'paused', reason: '授权已撤销，采集已停止' }
  if (input.hidden) return { run: false, status: 'paused', reason: '主窗口已隐藏，持续观察已暂停' }
  if (input.doNotDisturb) return { run: false, status: 'paused', reason: '勿扰模式已开启，持续观察已暂停' }
  if (input.locked) return { run: false, status: 'paused', reason: '系统已锁屏，持续观察已暂停' }
  return { run: true, status: 'running', reason: `每 ${input.intervalSeconds} 秒采样一次` }
}

export function operationIntent(text: string): boolean {
  return /修复|修改|删除|移动|运行|点击|保存文件|创建任务/.test(text)
}

export function screenInstructionIsExecutable(_source: 'screen' | 'ocr' | 'web' | 'tool'): boolean {
  return false
}
