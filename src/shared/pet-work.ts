import { pickPetActivity, type PetActivitySource } from './pet-activity'
import type { ActivityStatus } from './types'

export interface PetWorkState {
  key: string
  source: 'chat' | 'task' | 'autonomy'
  phase: 'waiting' | 'working' | 'reviewing' | 'ready' | 'failed' | 'stopping'
  label: string
  detail: string
  busy: boolean
  targetPath: string
}

export interface PetActivityMotion {
  key: string
  motion: string
  expression: string | null
  loop: boolean
}

interface PetWorkInput {
  tasks: readonly PetActivitySource[]
  dismissed: ReadonlySet<string>
  sending: boolean
  autonomy: ActivityStatus | null
}

function taskWork(task: PetActivitySource): PetWorkState {
  const states: Partial<Record<PetActivitySource['status'], [PetWorkState['phase'], string, boolean]>> = {
    待确认: ['waiting', '等你确认', false],
    等待批准: ['waiting', '等你确认', false],
    正在停止: ['stopping', '正在停止', true],
    执行中: ['working', '正在执行', true],
    规划中: ['waiting', '正在规划', true],
    已确认: ['waiting', '等待执行', true],
    失败: ['failed', '任务未完成', false],
    已中断: ['failed', '任务已中断', false],
    部分完成: ['ready', '做了一部分', false],
    已完成: ['ready', '做完了', false]
  }
  const [phase, label, busy] = states[task.status]!
  const detail = pickPetActivity([task], new Set())?.detail || task.result.trim() || task.summary.trim() || task.title
  return { key: `task:${task.id}:${phase}`, source: 'task', phase, label, detail, busy, targetPath: `/tasks?focus=${encodeURIComponent(task.id)}` }
}

function autonomyWork(activity: ActivityStatus | null): PetWorkState | null {
  if (!activity || activity.phase === 'stopped' || activity.phase === 'idle') return null
  const creation = activity.creation
  const isCreation = activity.kind === 'office' || activity.kind === 'code'
  const activityId = 'activityId' in activity && typeof activity.activityId === 'string' ? activity.activityId : activity.kind ?? 'manual'
  const state = (phase: PetWorkState['phase'], label: string, busy: boolean, detail = activity.reason): PetWorkState => ({
    key: `autonomy:${activityId}:${phase}${phase === 'ready' && creation?.artifact ? `:${creation.artifact.id}` : ''}`,
    source: 'autonomy', phase, label, detail, busy, targetPath: '/autonomy'
  })
  // Lifecycle state outranks retained creation evidence after cancellation/cleanup.
  if (activity.phase === 'stopping') return state('stopping', '正在结束活动', true)
  if (activity.phase === 'preparing') return state('waiting', '正在准备隔离环境', true)
  if (activity.phase === 'failed' || (isCreation && creation?.phase === 'failed')) {
    return state('failed', isCreation ? '创作未完成' : '隔离活动未完成', false, creation?.message || activity.reason)
  }
  if (!activity.running && !activity.busy && !activity.canStop) return null
  if (isCreation) {
    const detail = creation?.message || activity.reason
    const saved = creation?.saved
    const savedArtifact = saved && saved.path.trim() && saved.artifactId === creation?.artifact?.id && saved.bytes === creation.artifact.bytes && saved.sha256 === creation.artifact.sha256
    switch (creation?.phase) {
      case 'drafting': return state('waiting', '等待创作内容', true, detail)
      case 'executing': return state('working', activity.kind === 'code' ? '正在运行代码' : '正在制作文档', true, detail)
      case 'reviewing': return state('reviewing', '正在核对产物', true, detail)
      case 'ready': return creation.artifact
        ? state('ready', savedArtifact ? '产物已保存' : '产物已核验，待保存', false, savedArtifact ? saved.path : detail || creation.artifact.name)
        : state('waiting', '等待产物确认', Boolean(activity.busy), detail)
      default: return state('waiting', '等待创作开始', Boolean(activity.busy), detail)
    }
  }
  const label = activity.kind === 'browse' ? '浏览活动' : activity.kind === 'video' ? '视频活动' : '隔离桌面'
  return state(activity.busy ? 'working' : 'waiting', label, Boolean(activity.busy))
}

/** Input order breaks ties; terminal notifications cannot conceal current work. */
export function derivePetWork({ tasks, dismissed, sending, autonomy }: PetWorkInput): PetWorkState | null {
  const confirmation = tasks.find(task => task.status === '待确认' || task.status === '等待批准')
  if (confirmation) return taskWork(confirmation)
  if (sending) return { key: 'chat:waiting', source: 'chat', phase: 'waiting', label: '等待回复', detail: '正在等待本次对话的回复。', busy: true, targetPath: '/chat' }
  for (const status of ['正在停止', '执行中', '规划中', '已确认'] as const) {
    const active = tasks.find(task => task.status === status)
    if (active) return taskWork(active)
  }
  const isolated = autonomyWork(autonomy)
  if (isolated) return isolated
  const visible = tasks.filter(task => !dismissed.has(task.id))
  const failed = visible.find(task => task.status === '失败' || task.status === '已中断')
  if (failed) return taskWork(failed)
  const completed = visible.find(task => task.status === '部分完成' || task.status === '已完成')
  return completed ? taskWork(completed) : null
}

export function petWorkMotion(work: PetWorkState | null, presetId: string, imported: boolean): PetActivityMotion | null {
  if (!work || imported || work.phase === 'stopping') return null
  let motion: string
  let expression: string | null = null
  const loop = work.phase === 'waiting' || work.phase === 'working' || work.phase === 'reviewing'
  switch (presetId) {
    case 'naiwa':
      motion = work.phase === 'working' ? 'WorkingLoop' : work.phase === 'ready' ? 'Agree' : work.phase === 'failed' ? 'Confused' : 'Think'
      break
    case 'nailong':
      motion = work.phase === 'working' ? 'Working' : work.phase === 'ready' ? 'Agree' : work.phase === 'failed' ? 'Confused' : 'Think'
      break
    case 'tororo':
      motion = work.phase === 'ready' ? 'FlickUp' : work.phase === 'failed' ? 'FlickDown' : 'Idle'
      break
    case 'whale-girl':
      motion = work.phase === 'ready' ? 'aidale' : 'idle'
      expression = work.phase === 'ready' ? '开心兴奋' : work.phase === 'failed' ? '悲伤' : work.phase === 'working' ? null : '问号'
      break
    default: return null
  }
  if (work.source === 'task' && work.phase === 'ready' && work.label === '做了一部分') {
    motion = presetId === 'whale-girl' ? 'idle' : 'Idle'
    expression = null
  }
  return { key: `${presetId}:${work.key}:${motion}`, motion, expression, loop }
}
