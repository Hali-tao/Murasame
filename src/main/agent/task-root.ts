import { isAbsolute, normalize, parse, win32 } from 'node:path'

function windowsAbsolute(path: string): boolean { return /^[A-Za-z]:[\\/]/.test(path) || /^(?:\\\\|\/\/)[^\\/]+[\\/][^\\/]+/.test(path) }

/** A task root must never inherit a drive or working directory from the process. */
export function normalizeTaskRoot(value: string): string {
  const path = value.trim()
  if (!path || [...path].some(char => char.charCodeAt(0) < 32) || /^(?:\\\\|\/\/)[?.][\\/]/.test(path)) throw new Error('请提供完整的绝对目录路径，或使用“选择目录”')
  const windows = windowsAbsolute(path)
  if (!windows && (process.platform === 'win32' || !isAbsolute(path))) throw new Error('请提供完整的绝对目录路径，不能使用驱动器相对路径或进程工作目录')
  const canonical = windows ? win32.normalize(path) : normalize(path)
  const root = windows ? win32.parse(canonical).root : parse(canonical).root
  return canonical.length === root.length ? root : canonical.replace(/[\\/]+$/, '')
}

export function taskRootsEqual(left: string, right: string): boolean {
  const a = normalizeTaskRoot(left); const b = normalizeTaskRoot(right)
  return windowsAbsolute(a) && windowsAbsolute(b) ? a.toLowerCase() === b.toLowerCase() : a === b
}

export function extractTaskRoot(goal: string): string | null {
  // One ordered scan: a later quoted output path cannot replace an earlier source directory.
  const tokens = /"([^"\r\n]+)"|'([^'\r\n]+)'|“([^”\r\n]+)”|([A-Za-z]:[\\/][^\s"'“”，。；;]*)|(\\\\[^\\/\s]+[\\/][^\s"'“”，。；;]+)/g
  for (const match of goal.matchAll(tokens)) {
    const candidate = match.slice(1).find(value => value !== undefined)
    if (candidate && windowsAbsolute(candidate)) return normalizeTaskRoot(candidate)
  }
  return null
}
