import type { ApprovalRequest } from './types'

type RecordValue = Record<string, unknown>
type ApprovalSource = Pick<ApprovalRequest, 'target' | 'impact'> & { tool?: string }
export interface ApprovalChange { kind: string; from?: string; to: string; warning?: string }
export interface ApprovalStep {
  id: string; title: string; tool: string; description: string; workspace: string; network: string
  changes: ApprovalChange[]; executable?: string; argv: string[]; command?: string; content?: string
  expected: string; staged: boolean
}
export interface ApprovalPresentation {
  structured: boolean; target: string; steps: ApprovalStep[]; otherSteps: number; warning: string; raw: string
  summary?: { stage: 'sources' | 'draft'; sources: Array<{ path: string; bytes: number; modified: string; hash: string }>; recipient: string; endpoint: string; purpose: string; outputPath: string; markdown?: string; draftHash: string }
}
const record = (value: unknown): RecordValue | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : null
const text = (value: unknown): string => typeof value === 'string' ? value : ''
const records = (value: unknown): RecordValue[] => Array.isArray(value) ? value.map(record).filter((item): item is RecordValue => item !== null) : []
const toolNames: Record<string, string> = { filesystem: '文件操作', terminal: '隔离命令', git: '版本管理', browser: '访问网页', 'copy-image': '复制图片' }

function presentStep(step: RecordValue, plan: RecordValue): ApprovalStep {
  const args = record(step.args) ?? {}; const staged = record(step.staged)
  const tool = text(step.tool) || text(plan.tool)
  const action = text(args.action)
  const changes: ApprovalChange[] = []
  if (staged) {
    for (const change of records(staged.changes)) changes.push({ kind: change.kind === 'delete' ? '删除' : change.baselineHash == null ? '新建' : '覆盖', to: text(change.path) })
  } else {
    if (action === 'organize') for (const file of records(args.files)) changes.push({ kind: '移动', from: text(file.source), to: text(file.destination), warning: text(file.blocked) || (file.conflict ? '目标已存在，发生冲突时不会覆盖' : undefined) })
    else if (action === 'move') changes.push({ kind: '移动', from: text(args.from), to: text(args.to) })
    else if (action === 'write') changes.push({ kind: '新建', to: text(args.path), warning: '目标已存在时拒绝覆盖' })
    else if (action === 'read' || action === 'list') changes.push({ kind: action === 'read' ? '读取' : '列出目录', to: text(args.path) || '.' })
    for (const output of records(step.outputs)) changes.push({ kind: output.kind === 'delete' ? '删除' : output.overwrite ? '覆盖' : '新建', to: text(output.path) })
    if (tool === 'browser') changes.push({ kind: '访问', to: text(args.url) || text(plan.url) })
  }
  const title = text(step.title) || (action === 'organize' ? '按类型整理文件' : toolNames[tool] || tool || '待确认操作')
  return {
    id: text(step.id), title, tool: toolNames[tool] || tool,
    description: staged ? '仅导出已经生成的暂存文件，不会重跑命令。' : text(step.detail),
    workspace: text(step.workspace) || '.', network: tool === 'browser' || step.network === 'bridge' ? '允许联网' : step.network === undefined || step.network === 'none' ? '不联网' : '网络范围需核对完整声明',
    changes, executable: text(args.executable) || undefined, argv: Array.isArray(args.argv) ? args.argv.map(value => text(value)) : [],
    command: tool === 'terminal' && !args.executable ? text(plan.command) || undefined : undefined,
    content: typeof args.content === 'string' ? args.content : undefined, expected: text(step.expected), staged: Boolean(staged)
  }
}

/** Presentation only: the main process remains authoritative for scope and execution. */
export function approvalPresentation(approval: ApprovalSource, scope: 'once' | 'task'): ApprovalPresentation {
  const fallback: ApprovalPresentation = { structured: false, target: approval.target, steps: [], otherSteps: 0, warning: '该请求没有可识别的操作清单，请核对完整声明后决定是否批准。', raw: approval.impact }
  let payload: RecordValue | null
  try { payload = record(JSON.parse(approval.impact)) } catch { return fallback }
  if (!payload || !Array.isArray(payload.next) || payload.next.length === 0 || payload.next.some(item => !record(item) || !text(record(item)?.id) || !text(record(item)?.tool))) return fallback
  const next = records(payload.next); const first = next[0]; const plan = record(payload.plan) ?? {}
  const remaining = Array.isArray(payload.remaining) ? records(payload.remaining) : next
  const key = text(first.scopeKey)
  const selected = scope === 'task' && key ? remaining.filter(step => step.scopeKey === key) : [first]
  const steps = selected.map(step => presentStep(step, plan))
  let summary: ApprovalPresentation['summary']
  if (payload.workflowKind === 'summarize-files') {
    const sources = records(payload.sourceManifest); const to = record(payload.recipient); const draft = record(payload.draft)
    if (!sources.length || !to || !['awaiting-source-approval', 'awaiting-write-approval'].includes(text(payload.stage)) || sources.some(source => !text(source.relativePath) || typeof source.bytes !== 'number')) return fallback
    const writing = payload.stage === 'awaiting-write-approval'
    if (writing && typeof draft?.markdown !== 'string') return fallback
    summary = { stage: writing ? 'draft' : 'sources', sources: sources.map(source => ({ path: text(source.relativePath), bytes: source.bytes as number, modified: typeof source.mtimeMs === 'number' && Number.isFinite(source.mtimeMs) ? new Date(source.mtimeMs).toLocaleString('zh-CN') : '未知', hash: text(source.sha256) })), recipient: [text(to.name), text(to.provider), text(to.model)].filter(Boolean).join(' · '), endpoint: text(to.endpoint), purpose: text(payload.instruction), outputPath: text(payload.outputPath), markdown: writing ? text(draft?.markdown) : undefined, draftHash: text(payload.draftHash) }
    if (!writing) for (const step of steps) step.changes = summary.sources.map(source => ({ kind: '读取并发送正文', to: source.path }))
  }
  return { structured: true, target: approval.target, steps, summary, otherSteps: Math.max(0, remaining.length - selected.length), raw: approval.impact,
    warning: scope === 'task' && !key ? '当前声明未提供可核对的任务内范围；此处仅列出下一步，请核对完整声明。' : '' }
}

export function approvalSummary(approval: ApprovalSource): string {
  const view = approvalPresentation(approval, 'once'); const step = view.steps[0]
  if (!step) return view.structured ? '等待核对操作范围' : `${toolNames[approval.tool ?? ''] || '操作'}需要确认：${approval.target}`
  return `${step.staged ? '导出暂存成果' : step.title}${step.changes.length ? ` · ${step.changes.length} 项对象` : ''} · ${approval.target}`
}
