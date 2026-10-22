import { spawnSync } from 'node:child_process'
import type { Evidence } from '../../shared/evidence'
import { resolveInside } from './filesystem'

export interface ToolRun {
  status: 'ok' | 'error' | 'timeout' | 'aborted'
  raw: string
  evidence: Evidence
}

function evidence(command: string, actual: string, matched: boolean): Evidence {
  return { kind: 'exit-code', target: command, expected: '0', actual, matched }
}

export function terminalDecision(executable: string, args: readonly string[]): 'allow' | 'denied' {
  const blob = `${executable} ${args.join(' ')}`
  if (!executable.trim() || blob.includes('..') || /[;&|<>`\n]/.test(blob)) return 'denied'
  return 'allow'
}

export function runTerminal(root: string, executable: string, args: readonly string[] = []): ToolRun {
  const command = [executable, ...args].join(' ')
  if (terminalDecision(executable, args) === 'denied') {
    return { status: 'error', raw: '命令超出授权范围', evidence: evidence(command, '拒绝', false) }
  }
  let cwd: string
  try {
    cwd = resolveInside(root, '.')
  } catch (error) {
    return { status: 'error', raw: error instanceof Error ? error.message : '授权目录无效', evidence: evidence(command, '拒绝', false) }
  }
  const result = spawnSync(executable, [...args], {
    cwd,
    encoding: 'utf8',
    timeout: 8000,
    windowsHide: true,
    shell: false
  })
  if (result.error && (result.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') {
    return { status: 'timeout', raw: '', evidence: evidence(command, '超时', false) }
  }
  const code = result.status
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
  const raw = output || `exit=${code ?? 'unknown'}`
  return {
    status: code === 0 ? 'ok' : 'error',
    raw,
    evidence: evidence(command, String(code ?? result.error?.message ?? '失败'), code === 0)
  }
}
