import type { TaskStatus } from './types'

/** 桌宠上要让人看见的一件事。优先级对齐 Codex 桌宠：等你确认 > 没做成 > 正在做 > 做完了。 */
export type PetActivityKind = 'needs-input' | 'blocked' | 'running' | 'ready'

export interface PetActivitySource {
  id: string
  title: string
  status: TaskStatus
  summary: string
  result: string
  approval: { target: string; impact: string } | null
}

export interface PetActivity {
  id: string
  kind: PetActivityKind
  label: string
  detail: string
  /** 只有「等待批准」能在桌宠上直接允许或拒绝，其余打开控制台看。 */
  canApprove: boolean
  /** 同样在等确认的件数，含当前这一件。 */
  waiting: number
}

const KIND_RANK: Record<PetActivityKind, number> = {
  'needs-input': 0,
  blocked: 1,
  running: 2,
  ready: 3
}

function kindOf(status: TaskStatus): PetActivityKind | null {
  if (status === '等待批准' || status === '待确认') return 'needs-input'
  if (status === '失败') return 'blocked'
  if (status === '规划中' || status === '执行中' || status === '正在停止' || status === '已确认') return 'running'
  if (status === '已完成' || status === '部分完成') return 'ready'
  return null
}

function labelOf(status: TaskStatus): string {
  switch (status) {
    case '等待批准':
    case '待确认':
      return '等你确认'
    case '失败':
      return '没做成'
    case '正在停止':
      return '正在停'
    case '部分完成':
      return '做了一部分'
    case '已完成':
      return '做完了'
    default:
      return '正在做'
  }
}

function detailOf(task: PetActivitySource): string {
  const impact = task.approval?.impact.trim()
  if (task.status === '等待批准' && impact) return impact
  const summary = task.summary.trim()
  if (summary && summary !== '执行中') return summary
  const result = task.result.trim()
  if (result) return result
  return task.title
}

/**
 * 列表按最近更新在前。同一优先级里留最新的一件。
 * 做完和失败可以被收起；正在做和等确认不会被收起盖住。
 */
export function pickPetActivity(
  tasks: readonly PetActivitySource[],
  dismissed: ReadonlySet<string>
): PetActivity | null {
  const ranked = tasks
    .map((task) => {
      const kind = kindOf(task.status)
      if (!kind) return null
      if ((kind === 'ready' || kind === 'blocked') && dismissed.has(task.id)) return null
      return { task, kind }
    })
    .filter((item): item is { task: PetActivitySource; kind: PetActivityKind } => item !== null)
    .sort((left, right) => KIND_RANK[left.kind] - KIND_RANK[right.kind])

  const top = ranked[0]
  if (!top) return null
  const waiting = ranked.filter((item) => item.kind === 'needs-input').length
  return {
    id: top.task.id,
    kind: top.kind,
    label: labelOf(top.task.status),
    detail: detailOf(top.task),
    canApprove: top.task.status === '等待批准',
    waiting
  }
}
