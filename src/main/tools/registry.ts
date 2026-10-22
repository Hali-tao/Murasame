import { availability, type ToolContract } from './types'

const seed: ToolContract[] = [
  { id: 'filesystem', name: '文件系统', kind: '工具', ability: '读取与写入授权目录', parameters: { type: 'object' }, sensitive: true, enabled: true, running: false },
  { id: 'terminal', name: '终端命令', kind: '工具', ability: '在授权目录中执行命令', parameters: { type: 'object' }, sensitive: true, enabled: true, running: false },
  { id: 'git', name: 'Git', kind: '工具', ability: '查看状态与差异', parameters: { type: 'object' }, sensitive: false, enabled: true, running: false },
  { id: 'browser', name: '浏览器', kind: '插件', ability: '读取网页可见内容', parameters: { type: 'object' }, sensitive: true, enabled: true, running: false },
  { id: 'obsidian', name: 'Obsidian', kind: '插件', ability: '检索本地知识库', parameters: { type: 'object' }, sensitive: false, enabled: false, running: false },
  { id: 'calendar', name: '日历', kind: '插件', ability: '读取空闲时间', parameters: { type: 'object' }, sensitive: false, enabled: false, running: false }
]

export class ToolRegistry {
  constructor(private tools: ToolContract[] = seed.map((tool) => ({ ...tool }))) {}

  list(): ToolContract[] {
    return this.tools.map((tool) => ({ ...tool }))
  }

  setEnabled(id: string, enabled: boolean): ToolContract {
    const tool = this.tools.find((item) => item.id === id)
    if (!tool) throw new Error('能力不存在')
    tool.enabled = enabled
    return { ...tool }
  }

  assertCallable(id: string): void {
    const tool = this.tools.find((item) => item.id === id)
    if (!tool || !availability(tool).canStart) throw new Error('未启用的能力不参与执行')
  }

  register(tool: ToolContract): void {
    if (this.tools.some((item) => item.id === tool.id)) return
    this.tools.push({ ...tool })
  }
}
