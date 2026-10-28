import { useEffect, useRef, useState } from 'react'
import type { DeleteScope, MemoryEntry, Task } from '@shared/types'
import { Button, ConfirmDialog, Field, Input, Modal, Textarea } from './ui'
import { useAppStore } from '../store'
import { ApprovalDetails } from './ApprovalDetails'

const scopeOptions: Array<{ value: DeleteScope; title: string; hint: string }> = [
  { value: 'history', title: '对话历史', hint: '删除所选会话与消息正文。' },
  { value: 'memory', title: '相关长期记忆', hint: '只删除由本次选择产生的可识别条目。' },
  { value: 'cache', title: '本地缓存', hint: '清除界面缩略图、分析缓存和检索索引。导出的备份不在范围内。' },
  { value: 'logs', title: '运行日志', hint: '清除包含诊断信息的本地日志文件。' }
]

export function ClearScopeDialog({
  open,
  onOpenChange,
  title = '清除本地数据',
  description = '清除前请确认范围。默认不会触碰未勾选的内容。',
  confirmLabel = '按范围清除',
  onConfirm,
  busy,
  restrictedScopes
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title?: string
  description?: string
  confirmLabel?: string
  onConfirm: (scopes: DeleteScope[]) => void | Promise<void>
  busy?: boolean
  restrictedScopes?: DeleteScope[]
}): React.JSX.Element {
  const [scopes, setScopes] = useState<DeleteScope[]>(['history'])
  const available = restrictedScopes ?? scopeOptions.map((item) => item.value)

  const handleOpenChange = (next: boolean): void => {
    if (!next) setScopes([available[0] ?? 'history'])
    onOpenChange(next)
  }

  const toggle = (scope: DeleteScope): void => {
    setScopes((current) =>
      current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope]
    )
  }

  return (
    <Modal
      open={open}
      onOpenChange={handleOpenChange}
      title={title}
      description={description}
      footer={
        <>
          <Button onClick={() => handleOpenChange(false)} disabled={busy}>取消</Button>
          <Button
            variant="danger"
            disabled={!scopes.length || busy}
            onClick={() => void onConfirm(scopes)}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="scope-list">
        {scopeOptions.filter((option) => available.includes(option.value)).map((option) => {
          const checked = scopes.includes(option.value)
          return (
            <label key={option.value} className={`scope-option${checked ? ' checked' : ''}`}>
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(option.value)}
              />
              <span>
                <strong>{option.title}</strong>
                <small>{option.hint}</small>
              </span>
            </label>
          )
        })}
      </div>
      <div className="inline-note">清除操作不可撤销。导出的文件与手动创建的备份不在范围内。</div>
    </Modal>
  )
}

export function TaskCreateDialog({
  open,
  onOpenChange,
  initialTitle = ''
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialTitle?: string
}): React.JSX.Element {
  const [title, setTitle] = useState(initialTitle)
  const [root, setRoot] = useState('')
  const [picking, setPicking] = useState(false)
  const selectionVersion = useRef(0)
  const notify = useAppStore((state) => state.notify)
  const createTask = useAppStore((state) => state.createTask)
  const busy = useAppStore((state) => Boolean(state.busy['task:create']))

  useEffect(() => () => { selectionVersion.current += 1 }, [open])

  const handleOpenChange = (next: boolean): void => {
    if (!next) {
      selectionVersion.current += 1
      setTitle(initialTitle)
      setRoot('')
      setPicking(false)
    }
    onOpenChange(next)
  }

  const pickDirectory = async (): Promise<void> => {
    if (busy || picking) return
    const version = ++selectionVersion.current
    setPicking(true)
    try {
      const path = await window.murasame.app.pickOpen({ title: '选择任务的工作目录', directory: true })
      if (version === selectionVersion.current && path) setRoot(path)
    } catch { if (version === selectionVersion.current) notify('暂时无法选择目录，请重试', 'red') }
    finally { if (version === selectionVersion.current) setPicking(false) }
  }

  const submit = async (): Promise<void> => {
    if (!title.trim() || busy || picking) return
    const task = await createTask(title.trim(), root || undefined)
    if (task) handleOpenChange(false)
  }

  return (
    <Modal
      open={open}
      onOpenChange={handleOpenChange}
      title="确认新任务"
      description="任务会先拆成可核验的步骤。涉及文件写入、终端或外部应用时仍会单独请求批准。"
      footer={
        <>
          <Button onClick={() => handleOpenChange(false)} disabled={busy}>取消</Button>
          <Button variant="primary" onClick={() => void submit()} disabled={!title.trim() || busy || picking}>
            创建并开始
          </Button>
        </>
      }
    >
      <Field label="任务目标" hint="写清楚对象、范围和期望产物。">
        <Input
          autoFocus
          value={title}
          maxLength={4000}
          placeholder="例如：整理本周任务记录并生成周报初稿"
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void submit()
          }}
          data-testid="task-title-input"
        />
      </Field>
      <Field label="工作目录" hint="文件任务可先选目录。选择范围后，具体写入和移动仍需批准。">
        <Input value={root} readOnly aria-label="已选择的工作目录" placeholder="可选；也可以在任务中写明完整目录" />
        <Button disabled={busy || picking} onClick={() => void pickDirectory()} data-testid="pick-task-directory">{picking ? '正在选择…' : '选择目录'}</Button>
        {root ? <Button disabled={busy || picking} onClick={() => setRoot('')}>清除选择</Button> : null}
      </Field>
      <div className="info-grid compact">
        <div><span>模型</span><strong>当前默认服务</strong></div>
        <div><span>范围</span><strong>{root ? '所选工作目录' : '以明确确认的目录为准'}</strong></div>
        <div><span>审批</span><strong>敏感动作逐次确认</strong></div>
      </div>
    </Modal>
  )
}

export function MemoryEditDialog({
  open,
  onOpenChange,
  entry
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  entry: MemoryEntry | null
}): React.JSX.Element {
  const [category, setCategory] = useState(entry?.category ?? '偏好')
  const [text, setText] = useState(entry?.text ?? '')
  const addMemory = useAppStore((state) => state.addMemory)
  const updateMemory = useAppStore((state) => state.updateMemory)
  const busy = useAppStore((state) => Boolean(state.busy['memory:save']))

  const handleOpenChange = (next: boolean): void => {
    if (!next) {
      setCategory(entry?.category ?? '偏好')
      setText(entry?.text ?? '')
    }
    onOpenChange(next)
  }

  const submit = async (): Promise<void> => {
    if (!category.trim() || !text.trim()) return
    const result = entry
      ? await updateMemory(entry.id, category.trim(), text.trim())
      : await addMemory(category.trim(), text.trim())
    if (result) handleOpenChange(false)
  }

  return (
    <Modal
      open={open}
      onOpenChange={handleOpenChange}
      title={entry ? '编辑长期记忆' : '添加长期记忆'}
      description="稳定的偏好才值得长期保留。不要把一次性任务细节或完整密钥写入记忆。"
      footer={
        <>
          <Button onClick={() => handleOpenChange(false)} disabled={busy}>取消</Button>
          <Button variant="primary" onClick={() => void submit()} disabled={!category.trim() || !text.trim() || busy}>
            {entry ? '保存更正' : '添加记忆'}
          </Button>
        </>
      }
    >
      <Field label="类别">
        <Input value={category} maxLength={30} onChange={(event) => setCategory(event.target.value)} data-testid="memory-category" />
      </Field>
      <Field label="记忆内容" hint="最多 1000 字，保存后可在列表中逐条删除。">
        <Textarea value={text} rows={5} maxLength={1000} onChange={(event) => setText(event.target.value)} data-testid="memory-text" />
      </Field>
    </Modal>
  )
}

export function ApprovalDialog({
  open,
  onOpenChange,
  task
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  task: Task | null
}): React.JSX.Element {
  return <ApprovalDialogContent key={`${task?.id}:${task?.approval?.impact}:${open}`} open={open} onOpenChange={onOpenChange} task={task} />
}

function ApprovalDialogContent({ open, onOpenChange, task }: { open: boolean; onOpenChange: (open: boolean) => void; task: Task | null }): React.JSX.Element {
  const approveTask = useAppStore((state) => state.approveTask)
  const denyTask = useAppStore((state) => state.denyTask)
  const busy = useAppStore((state) => Boolean(state.busy['task:approve'] || state.busy['task:deny']))

  const [scope, setScope] = useState<'once' | 'task'>('once')

  const approve = async (): Promise<void> => {
    if (!task?.approval) return
    const next = await approveTask(task.id, scope)
    if (next) onOpenChange(false)
  }

  const deny = async (): Promise<void> => {
    if (!task) return
    const next = await denyTask(task.id)
    if (next) onOpenChange(false)
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="批准敏感操作"
      description="先核对操作对象与影响。批准有效期为 10 分钟；过期后可重新核对并申请。"
      confirmLabel="批准并继续"
      cancelLabel="拒绝"
      onConfirm={approve}
      onCancel={deny}
      busy={busy}
    >
      {task?.approval ? (
        <div className="approval-card">
          <label className="approval-row">范围
            <select value={scope} onChange={(event) => setScope(event.target.value as 'once' | 'task')}>
              <option value="once">仅这一次</option>
              <option value="task">本任务内有效</option>
            </select>
          </label>
          <ApprovalDetails approval={task.approval} scope={scope} />
        </div>
      ) : (
        <p className="muted">当前任务没有待批准操作。</p>
      )}
      <div className="inline-note amber-note">拒绝后任务受阻，不会执行，也不会标记为失败。批准后仍受原授权范围约束。</div>
    </ConfirmDialog>
  )
}
