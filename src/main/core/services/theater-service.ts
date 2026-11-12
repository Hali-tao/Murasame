import type { Task, TaskStatus, TheaterScene } from '../../../shared/types'

/** 只有任务终态才有一幕（执行中/等待批准等不演）。 */
const LINES: Partial<Record<TaskStatus, (title: string) => string>> = {
  已完成: (title) => `任务「${title}」已经完成，结果留在任务里。`,
  部分完成: (title) => `任务「${title}」只完成了一部分，剩下的还在任务里。`,
  失败: (title) => `任务「${title}」没有成功，原因已记在任务里，没有假装完成。`,
  已取消: (title) => `任务「${title}」已取消，没有继续执行。`,
  已中断: (title) => `任务「${title}」中途停了，当前状态已保存。`
}

const INTENTS: Partial<Record<TaskStatus, TheaterScene['intent']>> = {
  已完成: '开心',
  部分完成: '思考',
  失败: '困惑',
  已取消: '思考',
  已中断: '思考'
}

/**
 * F-04 任务幕：把真实的任务终态排成一句可读的事实（本地模板，不调用模型）。
 * 表现姿态与真实状态对齐：失败/取消不庆祝。
 */
export function theaterSceneForTask(task: Task, now: () => number = Date.now): TheaterScene | null {
  const line = LINES[task.status]
  if (!line) return null
  return {
    id: `${task.id}:${task.status}`,
    kind: 'task',
    taskId: task.id,
    status: task.status,
    title: task.title,
    line: line(task.title),
    intent: INTENTS[task.status] ?? '思考',
    createdAt: new Date(now()).toISOString()
  }
}

/** F-04：「今天不再演」只对当天有效，跨天自动恢复。 */
export function isTheaterMuted(muteDate: string, today: string): boolean {
  return muteDate !== '' && muteDate === today
}
