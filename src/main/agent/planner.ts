export interface IntentDecision {
  kind: 'chat' | 'task'
  confirmed: boolean
  execute: boolean
  question: string | null
}

export function recognizeIntent(text: string, confirmed: boolean | null): IntentDecision {
  const taskLike = /整理|移动|删除|写入|创建任务|修复/.test(text)
  if (!taskLike) return { kind: 'chat', confirmed: false, execute: false, question: null }
  if (text.trim().length < 4) {
    return { kind: 'task', confirmed: false, execute: false, question: '要处理哪个目录或文件？' }
  }
  if (confirmed !== true) {
    return { kind: 'task', confirmed: false, execute: false, question: '要创建这个任务吗？未确认前不会执行。' }
  }
  return { kind: 'task', confirmed: true, execute: true, question: null }
}
