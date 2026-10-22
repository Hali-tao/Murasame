export interface ToolContract {
  id: string
  name: string
  kind: '工具' | '插件' | '内置'
  ability: string
  parameters: Record<string, unknown>
  sensitive: boolean
  enabled: boolean
  running: boolean
}

export interface ToolAvailability {
  canStart: boolean
  runningVisible: boolean
  note: string
}

export function availability(tool: Pick<ToolContract, 'enabled' | 'running'>): ToolAvailability {
  if (!tool.enabled && tool.running) {
    return { canStart: false, runningVisible: true, note: '不再接受新调用，进行中的操作仍单独显示' }
  }
  if (!tool.enabled) return { canStart: false, runningVisible: false, note: '未启用，不参与执行' }
  return { canStart: true, runningVisible: tool.running, note: '可调用' }
}
