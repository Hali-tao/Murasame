export type Verdict = 'confirmed' | 'refuted' | 'inconclusive'

export interface Evidence {
  kind: 'fs-stat' | 'fs-hash' | 'exit-code' | 'http-status' | 'dom-query' | 'screenshot-diff' | 'schema-check'
  target: string
  expected: string
  actual: string
  matched: boolean
}

export interface ToolCallRecord {
  id: string
  taskId: string
  stepId: string
  toolId: string
  agentRole?: 'Planner' | 'Worker' | 'Critic'

  /** 1. 声明：模型打算做什么（不可信） */
  declared: { intent: string; args: unknown }
  /** 2. 执行：工具的真实返回 */
  execution: {
    status: 'running' | 'unknown' | 'ok' | 'error' | 'timeout' | 'aborted'
    raw: unknown
    startedAt: string
    endedAt: string
  }
  /** 3. 核验：由 Verifier 独立复查得到的证据，不经过模型 */
  verification: { method: string; evidence: Evidence[]; verdict: Verdict }
}
