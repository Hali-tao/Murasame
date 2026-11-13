import type { Task, TaskStatus, TheaterScene } from '../../../shared/types'

/** 只有任务终态才有一幕（执行中/等待批准等不演）。 */
const LINES: Partial<Record<TaskStatus, (title: string) => string>> = {
  已完成: (title) => `任务「${title}」已经完成，结果留在任务里。`,
  部分完成: (title) => `任务「${title}」只完成了一部分，剩下的还在任务里。`,
  失败: (title) => `任务「${title}」没有成功，原因已记在任务里，没有假装完成。`,
  已取消: (title) => `任务「${title}」已取消，没有继续执行。`,
  已中断: (title) => `任务「${title}」中途停了，当前状态已保存。`
}

const clipText = (value: string, max: number): string => {
  // 去掉 C0/C1 控制符、零宽字符与双向控制符：气泡是单行摘要，不应被 Unicode 控制符重排/隐藏内容。
  // eslint-disable-next-line no-control-regex
  const clean = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\u061c]/g, '').replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max)}…` : clean
}

/** 同一时段只保留最高优先级的一幕：失败/部分完成必须压过完成与见闻。 */
const PRIORITIES: Partial<Record<TaskStatus, number>> = {
  已完成: 1,
  部分完成: 5,
  失败: 5,
  已取消: 2,
  已中断: 3
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
  const template = LINES[task.status]
  if (!template) return null
  // 气泡是桌宠脚边的一句摘要：任务名可能长达数千字符，必须有界，否则会撑出窗口。
  const title = clipText(task.title, 80)
  return {
    id: `${task.id}:${task.status}`,
    kind: 'task',
    taskId: task.id,
    status: task.status,
    title,
    line: clipText(template(title), 160),
    intent: INTENTS[task.status] ?? '思考',
    priority: PRIORITIES[task.status] ?? 1,
    createdAt: new Date(now()).toISOString()
  }
}

/** F-04：「今天不再演」只对当天有效，跨天自动恢复。 */
export function isTheaterMuted(muteDate: string, today: string): boolean {
  return muteDate !== '' && muteDate === today
}

/**
 * F-04 见闻幕：自主活动结束且有真实观察时，用本地模板陈述「发生了什么」。
 * 隐私边界：不展示网页原文/截图内容，只给出目标摘要与观察数量；失败/取消不演。
 */
export function theaterSceneForObservation(
  result: { activityId: string; status: string; goal: string; observations: Array<{ text: string }>; finishedAt: string } | undefined,
  now: () => number = Date.now
): TheaterScene | null {
  if (!result || result.observations.length === 0) return null
  if (result.status !== 'completed' && result.status !== 'partial' && result.status !== 'limited') return null
  const goal = clipText(result.goal, 60)
  const line = clipText(goal
    ? `刚在隔离桌面里看了一会儿：${goal}。共有 ${result.observations.length} 条观察记录。`
    : `刚在隔离桌面里看了一会儿，共有 ${result.observations.length} 条观察记录。`, 160)
  return {
    id: `observation-${result.activityId}-${result.finishedAt}`,
    kind: 'observation',
    taskId: result.activityId,
    status: '已完成',
    title: goal || '自主活动',
    line,
    intent: '思考',
    priority: 2,
    viewPath: '/autonomy',
    createdAt: new Date(now()).toISOString()
  }
}
