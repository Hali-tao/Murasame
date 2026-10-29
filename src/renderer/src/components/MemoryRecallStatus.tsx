import type { MemoryRecallStatus as RecallStatus, Tone } from '@shared/types'
import { Pill } from './ui'

const notices: Record<RecallStatus, { label: string; detail: string; tone: Tone }> = {
  complete: { label: '已使用记忆', detail: '该次检索已完成，下方列出实际提供给回复的记忆。', tone: 'green' },
  limited: { label: '记忆检索受限', detail: '该次回复未能完整检索长期记忆，可能遗漏相关记录。已找到的内容仍可参考。', tone: 'amber' },
  unavailable: { label: '记忆检索暂不可用', detail: '该次回复未能检索长期记忆，已有条目没有因此删除。', tone: 'amber' },
  disabled: { label: '该次未启用记忆', detail: '生成该次回复时，长期记忆处于关闭状态。', tone: 'gray' },
  'not-used': { label: '该次未检索记忆', detail: '该次回复用于处理任务或工具请求，没有检索长期记忆。', tone: 'gray' },
  unknown: { label: '历史状态未记录', detail: '这条回复未保存可识别的检索状态，无法确认当时是否完整。', tone: 'gray' }
}

export function MemoryRecallStatus({ status, recorded, count }: {
  status?: RecallStatus; recorded: boolean; count: number
}): React.JSX.Element {
  const notice = !recorded
    ? { label: '尚无检索记录', detail: '完成一次对话后，这里会显示该次回复的记忆使用情况。', tone: 'gray' as const }
    : status === 'complete' && count === 0
      ? { label: '未找到相关记忆', detail: '该次检索已完成，没有找到可用于这次回复的相关记忆。', tone: 'gray' as const }
      : notices[status ?? 'unknown']
  return (
    <div className="memory-recall-status" role="status" data-testid="memory-recall-status" aria-live="polite">
      <Pill tone={notice.tone}>{notice.label}</Pill>
      <p className="muted">{notice.detail}</p>
    </div>
  )
}
