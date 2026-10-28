import type { Verdict } from '@shared/evidence'

export type RuntimeStatus =
  | 'waiting-input'
  | 'service-wait'
  | 'task-running'
  | 'awaiting-approval'
  | 'finished'
  | 'unimplemented'
  | 'unverified'
  | 'degraded'
  | 'saved'
  | 'unsaved'
  | 'in-use'
  | 'not-in-use'
  | 'memory-on'
  | 'memory-off'
  | 'memory-waiting'
  | 'activity-running'
  | 'activity-idle'
  | 'granted'
  | 'denied'
  | 'single-capture'
  | 'watching'
  | 'app-running'
  | 'enabled'
  | 'disabled'
  | 'verified'
  | 'not-started'

export interface StatusPresentation {
  label: string
  tone: 'gray' | 'blue' | 'amber' | 'green' | 'red'
  motion: 'static' | 'pulse'
}

export const statusPresentation: Record<RuntimeStatus, StatusPresentation> = {
  'waiting-input': { label: '等待输入', tone: 'gray', motion: 'static' },
  'service-wait': { label: '服务等待', tone: 'blue', motion: 'pulse' },
  'task-running': { label: '任务执行', tone: 'blue', motion: 'pulse' },
  'awaiting-approval': { label: '等待批准', tone: 'amber', motion: 'pulse' },
  finished: { label: '执行结束', tone: 'green', motion: 'static' },
  unimplemented: { label: '未实现', tone: 'gray', motion: 'static' },
  unverified: { label: '未验证', tone: 'amber', motion: 'static' },
  degraded: { label: '功能受限', tone: 'red', motion: 'static' },
  saved: { label: '已保存', tone: 'green', motion: 'static' },
  unsaved: { label: '未保存', tone: 'amber', motion: 'static' },
  'in-use': { label: '正在使用', tone: 'green', motion: 'static' },
  'not-in-use': { label: '未在使用', tone: 'amber', motion: 'static' },
  'memory-on': { label: '记忆已开启', tone: 'green', motion: 'static' },
  'memory-off': { label: '记忆已关闭', tone: 'gray', motion: 'static' },
  'memory-waiting': { label: '记忆未就绪', tone: 'amber', motion: 'static' },
  'activity-running': { label: '活动进行中', tone: 'green', motion: 'pulse' },
  'activity-idle': { label: '活动未开始', tone: 'gray', motion: 'static' },
  granted: { label: '已授权', tone: 'green', motion: 'static' },
  denied: { label: '未授权', tone: 'red', motion: 'static' },
  'single-capture': { label: '单次截取', tone: 'blue', motion: 'static' },
  watching: { label: '持续观察中', tone: 'blue', motion: 'pulse' },
  'app-running': { label: '正在运行', tone: 'green', motion: 'static' },
  enabled: { label: '已启用', tone: 'green', motion: 'static' },
  disabled: { label: '已停用', tone: 'red', motion: 'static' },
  verified: { label: '验证成功', tone: 'green', motion: 'static' },
  'not-started': { label: '未开始使用', tone: 'amber', motion: 'static' }
}

export const verdictPresentation: Record<Verdict, StatusPresentation> = {
  confirmed: { label: '核验通过', tone: 'green', motion: 'static' },
  refuted: { label: '核验不符', tone: 'red', motion: 'static' },
  inconclusive: { label: '无法核验', tone: 'amber', motion: 'static' }
}

const ROLE_LABELS: Record<'Planner' | 'Worker' | 'Critic', string> = {
  Planner: '计划',
  Worker: '执行',
  Critic: '检查结果'
}

export function roleLabel(role: 'Planner' | 'Worker' | 'Critic' | undefined): string {
  return ROLE_LABELS[role ?? 'Worker']
}

const SOURCE_LABELS: Record<string, string> = {
  模型: '看图模型判断',
  规则: '按已知报错规则',
  观察: '仅读取了文字'
}

const TOOL_LABELS: Record<string, string> = {
  filesystem: '文件整理',
  terminal: '终端命令',
  git: 'Git 查看',
  browser: '读取网页',
  model: '模型出计划',
  rules: '按规则出计划',
  critic: '核对证据'
}

const EXECUTION_LABELS: Record<string, string> = {
  ok: '已执行',
  error: '执行出错',
  timeout: '超时',
  aborted: '已中止'
}

export function toolLabel(id: string): string {
  return TOOL_LABELS[id] ?? id
}

export function executionLabel(status: string): string {
  if (status === 'running') return '进行中'
  if (status === 'unknown') return '上次结果未知，未恢复执行'
  return EXECUTION_LABELS[status] ?? status
}

export function analysisSourceLabel(confidence: string): string {
  return SOURCE_LABELS[confidence] ?? confidence
}

export function formatOperationalError(reason: string, action: string): string {
  return `${reason} ${action}`.trim()
}
