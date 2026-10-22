import { spawnSync } from 'node:child_process'
import type { ToolRun } from './terminal'
import { resolveInside } from './filesystem'

const readCommands = new Set(['status', 'diff', 'log', 'show'])

export function gitDecision(args: readonly string[]): 'allow' | 'denied' {
  const verb = args[0] ?? ''
  if (!readCommands.has(verb)) return 'denied'
  if (args.some((arg) => /\b(commit|push|reset|clean|rebase|merge|checkout)\b/.test(arg) || arg.includes('..'))) return 'denied'
  return 'allow'
}

export function runGit(root: string, args: readonly string[]): ToolRun {
  const command = `git ${args.join(' ')}`.trim()
  if (gitDecision(args) === 'denied') {
    return {
      status: 'error',
      raw: 'Git 只允许查看状态与差异',
      evidence: { kind: 'exit-code', target: command, expected: '0', actual: '拒绝', matched: false }
    }
  }
  let cwd: string
  try {
    cwd = resolveInside(root, '.')
  } catch (error) {
    return {
      status: 'error',
      raw: error instanceof Error ? error.message : '授权目录无效',
      evidence: { kind: 'exit-code', target: command, expected: '0', actual: '拒绝', matched: false }
    }
  }
  const result = spawnSync('git', [...args], { cwd, encoding: 'utf8', timeout: 8000, windowsHide: true, shell: false })
  const code = result.status
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
  return {
    status: code === 0 ? 'ok' : 'error',
    raw: output || `exit=${code ?? result.error?.message ?? '失败'}`,
    evidence: { kind: 'exit-code', target: command, expected: '0', actual: String(code ?? '失败'), matched: code === 0 }
  }
}
