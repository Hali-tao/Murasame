import type { ToolCallRecord } from './evidence'
import type { TaskStatus } from './types'

/** Keep the persisted start receipt for recovery, but show one current row per invocation. */
export function currentTaskCalls(calls: readonly ToolCallRecord[], taskStatus: TaskStatus = '执行中'): ToolCallRecord[] {
  const metadata = (call: ToolCallRecord): { phase?: string; traceId?: string } => call.declared.args && typeof call.declared.args === 'object' ? call.declared.args : {}
  const finished = new Set(calls.filter(call => metadata(call).phase === 'result').map(call => `${call.agentRole}:${metadata(call).traceId}`))
  return calls.filter(call => {
    const args = metadata(call)
    return args.phase !== 'started' || !args.traceId || !finished.has(`${call.agentRole}:${args.traceId}`)
  }).map(call => metadata(call).phase === 'started' ? { ...call, execution: { ...call.execution, status: taskStatus === '执行中' || taskStatus === '正在停止' ? 'running' : 'unknown' } } : call)
}
