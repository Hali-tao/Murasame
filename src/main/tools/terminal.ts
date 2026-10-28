import type { AwaitingExport, DeclaredOutput } from '../task/staging'
import type { FileEffect } from './filesystem'
import type { Evidence } from '../../shared/evidence'
import { resolveInside } from './filesystem'
export interface ToolRun { status: 'ok' | 'error' | 'timeout' | 'aborted'; raw: string; evidence: Evidence; artifacts?: string[]; effects?: FileEffect[]; awaitingExport?: AwaitingExport; outcomeKnown?: boolean }
export interface IsolatedRequest { root: string; executable: string; args: readonly string[]; signal?: AbortSignal; timeoutMs: number; readOnly?: boolean; taskId?: string; ticketId?: string; network?: 'none' | 'bridge'; outputs?: DeclaredOutput[]; resumeStageId?: string; assertAllowed?: (boundary?: 'execute' | 'export') => void }
export interface IsolatedResult { status: ToolRun['status']; raw: string; exitCode?: number; artifacts?: string[]; effects?: FileEffect[]; awaitingExport?: AwaitingExport; outcomeKnown?: boolean }
export type IsolatedRunner = (request: IsolatedRequest) => Promise<IsolatedResult>
export interface RunOptions { runner?: IsolatedRunner; signal?: AbortSignal; timeoutMs?: number; readOnly?: boolean; taskId?: string; ticketId?: string; network?: 'none' | 'bridge'; outputs?: DeclaredOutput[]; resumeStageId?: string; assertAllowed?: (boundary?: 'execute' | 'export') => void }
export function terminalDecision(executable: string, args: readonly string[]): 'allow' | 'denied' {
  return !executable.trim() || [executable, ...args].some((arg) => arg.includes('\0')) || /[\r\n]/.test(executable) || args.some((arg) => /^\.\.[\\/]/.test(arg)) ? 'denied' : 'allow'
}
export async function runTerminal(root: string, executable: string, args: readonly string[] = [], options: RunOptions = {}): Promise<ToolRun> {
  const command = [executable, ...args].join(' ')
  const result = (status: ToolRun['status'], raw: string, actual: string, matched = false): ToolRun => ({ status, raw, evidence: { kind: 'exit-code', target: command, expected: '0', actual, matched } })
  if (options.signal?.aborted) return result('aborted', '已取消，未执行', '取消')
  if (terminalDecision(executable, args) === 'denied') return result('error', '命令参数无效', '拒绝')
  if (!options.runner) return result('error', '隔离运行器未配置，没有在宿主执行', '隔离不可用')
  const controller = new AbortController()
  const abort = (): void => controller.abort(options.signal?.reason)
  options.signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => controller.abort(new Error('执行超时')), options.timeoutMs ?? 8000)
  try {
    const output = await options.runner({ root: resolveInside(root, '.'), executable, args: [...args], signal: controller.signal, timeoutMs: options.timeoutMs ?? 8000, readOnly: options.readOnly, taskId: options.taskId, ticketId: options.ticketId, network: options.network, outputs: options.outputs, resumeStageId: options.resumeStageId, assertAllowed: options.assertAllowed })
    if (controller.signal.aborted) return { ...output, ...result(options.signal?.aborted ? 'aborted' : 'timeout', output.raw || '执行已停止', '中止') }
    return { ...output, ...result(output.status, output.raw, String(output.exitCode ?? (output.status === 'ok' ? 0 : '失败')), output.status === 'ok' && output.exitCode === 0) }
  } catch (error) {
    return result(controller.signal.aborted ? options.signal?.aborted ? 'aborted' : 'timeout' : 'error', error instanceof Error ? error.message : String(error), '失败')
  } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort) }
}
