export type TaskPhase =
  | '待确认'
  | '已确认'
  | '规划中'
  | '执行中'
  | '等待批准'
  | '正在停止'
  | '已完成'
  | '部分完成'
  | '失败'
  | '已取消'
  | '已中断'

const allowed: Record<TaskPhase, readonly TaskPhase[]> = {
  待确认: ['已确认', '已取消'],
  已确认: ['规划中', '已取消'],
  规划中: ['执行中', '失败', '已取消'],
  执行中: ['等待批准', '正在停止', '已完成', '部分完成', '失败', '已中断'],
  等待批准: ['执行中', '已取消'],
  正在停止: ['已取消'],
  已完成: [],
  部分完成: [],
  失败: [],
  已取消: [],
  已中断: []
}

export function transition(from: TaskPhase, to: TaskPhase): TaskPhase {
  if (!allowed[from].includes(to)) throw new Error(`非法状态迁移：${from} → ${to}`)
  return to
}

const terminal = new Set<TaskPhase>(['已完成', '部分完成', '失败', '已取消', '已中断'])

export function interruptOnRestart(status: TaskPhase): TaskPhase {
  if (terminal.has(status)) return status
  return '已中断'
}
