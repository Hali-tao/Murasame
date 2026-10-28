import type { PlanStep, TaskTool } from '../agent/executor'
export interface GraphNode { id: string; index: number; dependsOn: string[]; step: PlanStep }
export function taskGraph(steps: readonly PlanStep[]): GraphNode[] {
  const explicit = steps.some((step) => step.id !== undefined || step.dependsOn !== undefined)
  const nodes = steps.map((step, index) => ({ id: step.id ?? `step-${index}`, index, step, dependsOn: step.dependsOn ?? (!explicit && index > 0 ? [`step-${index - 1}`] : []) }))
  const ids = new Set(nodes.map((node) => node.id))
  if (ids.size !== nodes.length || nodes.some((node) => !/^[a-zA-Z0-9_-]{1,60}$/.test(node.id))) throw new Error('计划步骤 ID 必须唯一且有效')
  for (const node of nodes) if (node.dependsOn.some((id) => id === node.id || !ids.has(id))) throw new Error('步骤依赖不存在或依赖自身')
  const visited = new Set<string>(); const visiting = new Set<string>()
  const visit = (id: string): void => { if (visiting.has(id)) throw new Error('计划包含循环依赖'); if (visited.has(id)) return; visiting.add(id); nodes.find((node) => node.id === id)!.dependsOn.forEach(visit); visiting.delete(id); visited.add(id) }
  nodes.forEach((node) => visit(node.id)); return nodes
}
export function readOnlyStep(step: PlanStep, tool: TaskTool): boolean { return tool === 'git' || tool === 'browser' || tool === 'filesystem' && (step.args?.action === 'list' || step.args?.action === 'read') }
