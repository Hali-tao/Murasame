import { expect, it } from 'vitest'
import { currentTaskCalls } from '../../src/shared/task-call-presentation'
import type { ToolCallRecord } from '../../src/shared/evidence'
const call = (id: string, role: ToolCallRecord['agentRole'], phase: string, traceId: string): ToolCallRecord => ({ id, taskId: 'task', stepId: 'step', toolId: 'browser', agentRole: role, declared: { intent: '', args: { phase, traceId } }, execution: { status: phase === 'started' ? 'error' : 'ok', raw: '', startedAt: '', endedAt: '' }, verification: { method: '', evidence: [], verdict: 'inconclusive' } })
it('shows old or new unfinished receipts as running, then replaces them only with their own final outcome', () => {
  const started = call('start', 'Worker', 'started', 'one')
  expect(currentTaskCalls([started])[0].execution.status).toBe('running')
  const critic = call('critic', 'Critic', 'result', 'one')
  expect(currentTaskCalls([started, critic])).toHaveLength(2)
  const result = call('result', 'Worker', 'result', 'one')
  const other = call('other', 'Worker', 'started', 'two')
  expect(currentTaskCalls([started, critic, result, other]).map(item => item.id)).toEqual(['critic', 'result', 'other'])
  expect(started.execution.status).toBe('error')
  expect(currentTaskCalls([started], '已中断')[0].execution.status).toBe('unknown')
  expect(currentTaskCalls([started], '正在停止')[0].execution.status).toBe('running')
})
