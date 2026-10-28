import { runTerminal, type RunOptions, type ToolRun } from './terminal'
const readCommands = new Set(['status', 'diff', 'log', 'show'])
export function gitDecision(args: readonly string[]): 'allow' | 'denied' {
  if (!readCommands.has(args[0] ?? '')) return 'denied'
  if (args.slice(1).some((arg) => /[\r\n\0]/.test(arg) || arg.includes('..') || /^(?:--output(?:=|$)|--ext-diff$|--textconv$|--config-env(?:=|$)|-c$)/.test(arg))) return 'denied'
  return 'allow'
}
export async function runGit(root: string, args: readonly string[], options: RunOptions = {}): Promise<ToolRun> {
  if (gitDecision(args) === 'denied') return { status: 'error', raw: 'Git 只允许受控只读参数', evidence: { kind: 'exit-code', target: `git ${args.join(' ')}`, expected: '0', actual: '拒绝', matched: false } }
  return runTerminal(root, 'git', ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', ...args, ...(args[0] === 'diff' || args[0] === 'show' ? ['--no-ext-diff', '--no-textconv'] : [])], { ...options, readOnly: true })
}
