import { useState } from 'react'
import type { DeleteScope, MemoryEntry, Task } from '@shared/types'
import { Button, ConfirmDialog, Field, Input, Modal, Textarea } from './ui'
import { useAppStore } from '../store'

const scopeOptions: Array<{ value: DeleteScope; title: string; hint: string }> = [
  { value: 'history', title: '对话历史', hint: '删除所选会话与消息正文。' },
  { value: 'memory', title: '相关长期记忆', hint: '只删除由本次选择产生的可识别条目。' },
  { value: 'cache', title: '本地缓存', hint: '清除界面缩略图与分析缓存。' },
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
  const createTask = useAppStore((state) => state.createTask)
  const busy = useAppStore((state) => Boolean(state.busy['task:create']))

  const handleOpenChange = (next: boolean): void => {
    if (!next) setTitle(initialTitle)
    onOpenChange(next)
  }

  const submit = async (): Promise<void> => {
    if (!title.trim()) return
    const task = await createTask(title.trim())
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
          <Button variant="primary" onClick={() => void submit()} disabled={!title.trim() || busy}>
            创建并开始
          </Button>
        </>
      }
    >
      <Field label="任务目标" hint="写清楚对象、范围和期望产物。">
        <Input
          autoFocus
          value={title}
          maxLength={120}
          placeholder="例如：整理本周任务记录并生成周报初稿"
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void submit()
          }}
          data-testid="task-title-input"
        />
      </Field>
      <div className="info-grid compact">
        <div><span>模型</span><strong>当前默认服务</strong></div>
        <div><span>范围</span><strong>已授权目录与本地记录</strong></div>
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
  const approveTask = useAppStore((state) => state.approveTask)
  const busy = useAppStore((state) => Boolean(state.busy['task:approve']))

  const approve = async (): Promise<void> => {
    if (!task) return
    const next = await approveTask(task.id)
    if (next) onOpenChange(false)
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="批准敏感操作"
      description="本次批准只对下面列出的动作生效，不会扩大工具权限。"
      confirmLabel="批准并继续"
      onConfirm={approve}
      busy={busy}
    >
      {task?.approval ? (
        <div className="approval-card">
          <div className="approval-row"><span>调用能力</span><strong>{task.approval.tool}</strong></div>
          <div className="approval-row"><span>操作对象</span><strong>{task.approval.target}</strong></div>
          <div className="approval-row"><span>可能影响</span><p>{task.approval.impact}</p></div>
        </div>
      ) : (
        <p className="muted">当前任务没有待批准操作。</p>
      )}
      <div className="inline-note amber-note">批准后执行仍受沙箱和原授权范围约束。拒绝不会把任务标记为完成。</div>
    </ConfirmDialog>
  )
}
