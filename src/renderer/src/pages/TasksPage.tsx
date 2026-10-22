import { Check, Circle, Clock3, FileOutput, Plus, RefreshCw, ShieldAlert, X } from 'lucide-react'
import { useState } from 'react'
import type { Task } from '@shared/types'
import { ApprovalDialog, TaskCreateDialog } from '../components/dialogs'
import { Button, Card, CardHead, ConfirmDialog, EmptyState, Pill } from '../components/ui'
import { executionLabel, roleLabel, toolLabel, verdictPresentation } from '../lib/status'
import { useAppStore } from '../store'

type TaskFilter = '全部任务' | '执行中' | '等待批准' | '已完成' | '已取消'

export function TasksPage(): React.JSX.Element {
  const data = useAppStore((state) => state.data)!
  const selectedId = useAppStore((state) => state.selectedTaskId)
  const selectTask = useAppStore((state) => state.selectTask)
  const cancelTask = useAppStore((state) => state.cancelTask)
  const busyCancel = useAppStore((state) => Boolean(state.busy['task:cancel']))
  const notify = useAppStore((state) => state.notify)
  const [filter, setFilter] = useState<TaskFilter>('全部任务')
  const [createOpen, setCreateOpen] = useState(false)
  const [approvalOpen, setApprovalOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)

  const filtered = data.tasks.filter((task) => filter === '全部任务' || task.status === filter)
  const selected = data.tasks.find((task) => task.id === selectedId) ?? filtered[0] ?? data.tasks[0]

  const confirmCancel = async (): Promise<void> => {
    if (!selected) return
    const result = await cancelTask(selected.id)
    if (result) setCancelOpen(false)
  }

  return (
    <div className="page tasks-page">
      <div className="tasks-layout">
        <Card className="tasks-list-card">
          <CardHead
            title="任务"
            subtitle="确认后才执行 · 可随时取消"
            aside={<Button size="sm" onClick={() => setCreateOpen(true)} icon={<Plus size={15} />} aria-label="新建任务" data-testid="new-task" />}
          />
          <select className="select" value={filter} onChange={(event) => setFilter(event.target.value as TaskFilter)} aria-label="筛选任务">
            {(['全部任务', '执行中', '等待批准', '已完成', '已取消'] as TaskFilter[]).map((option) => <option key={option}>{option}</option>)}
          </select>
          <Pill tone={selected?.status === '等待批准' ? 'amber' : 'blue'}>{selected?.status ?? '暂无任务'}</Pill>
          <div className="task-list">
            {filtered.map((task) => (
              <button
                type="button"
                key={task.id}
                data-testid="task-item"
                className={`task-list-item${task.id === selected?.id ? ' active' : ''}`}
                onClick={() => selectTask(task.id)}
              >
                <div className="task-list-head">
                  <strong>{task.title}</strong>
                  <Pill tone={task.tone}>{task.status}</Pill>
                </div>
                <div className="task-list-meta"><span>{task.id}</span><span>{task.progress}%</span></div>
                <div className="progress-track"><span style={{ width: `${task.progress}%` }} /></div>
              </button>
            ))}
            {!filtered.length ? <EmptyState title="这个分类里还没有任务" description="创建任务后，执行进度和审批状态会显示在这里。" /> : null}
          </div>
        </Card>

        <Card className="task-detail-card">
          {selected ? (
            <>
              <div className="task-detail-top">
                <div className="task-detail-titleline">
                  <Pill tone={selected.tone}>{selected.status}</Pill>
                  <span className="mono-id">{selected.id}</span>
                </div>
                <div className="task-actions">
                  <Button size="sm" icon={<RefreshCw size={14} />} onClick={() => notify(`${selected.status} · ${selected.progress}% · ${selected.summary || '还没有进度'}`)}>查询进度</Button>
                  {selected.approval ? (
                    <Button size="sm" variant="primary" icon={<ShieldAlert size={14} />} onClick={() => setApprovalOpen(true)} data-testid="approve-task">
                      处理审批
                    </Button>
                  ) : null}
                  <Button size="sm" variant="danger" icon={<X size={14} />} disabled={['已取消', '已完成', '失败', '部分完成', '已中断', '正在停止'].includes(selected.status)} onClick={() => setCancelOpen(true)} data-testid="cancel-task">
                    取消任务
                  </Button>
                </div>
              </div>
              <h2>{selected.title}</h2>
              <p className="task-summary">{selected.summary}</p>
              <div className="task-meta-grid">
                <div><span>创建</span><strong>{selected.created}</strong></div>
                <div><span>模型</span><strong>{selected.model}</strong></div>
                <div><span>授权范围</span><strong>{selected.scope}</strong></div>
              </div>

              {selected.approval ? (
                <div className="approval-required">
                  <div className="approval-icon"><ShieldAlert size={19} /></div>
                  <div>
                    <strong>等待批准：{selected.approval.target}</strong>
                    <p>{selected.approval.impact}</p>
                  </div>
                  <Button size="sm" variant="primary" onClick={() => setApprovalOpen(true)}>查看并批准</Button>
                </div>
              ) : null}

              <div className="task-progress-card">
                <div><span>任务进度</span><span>{selected.progress}% · {selected.status}</span></div>
                <div className="progress-track"><span style={{ width: `${selected.progress}%` }} /></div>
              </div>

              <div className="detail-section-head">
                <div><h3>执行计划</h3><p>每一步都以实际工具结果核验。</p></div>
              </div>
              <div className="step-list">
                {selected.steps.map((step) => (
                  <div className={`step-row step-${step.tone}`} key={step.id}>
                    <span className="step-node">{step.state === '完成' ? <Check size={13} /> : step.state === '进行中' ? <Circle size={8} fill="currentColor" /> : <Circle size={9} />}</span>
                    <div className="step-copy"><strong>{step.title}</strong><span>{step.detail}</span></div>
                    <div className="step-side"><time>{step.time}</time><Pill tone={step.tone}>{step.state}</Pill></div>
                  </div>
                ))}
              </div>

              <div className="detail-section-head">
                <div><h3>调用链</h3><p>声明、执行和核验对照。不展示完整密钥。</p></div>
              </div>
              <div className="step-list">
                {selected.toolCalls.length ? selected.toolCalls.map((call) => {
                  const hide = (value: string): string => value.replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-••••')
                  const actual = call.verification.evidence.map((item) => item.actual).join('、') || call.execution.status
                  return (
                    <div className="step-row" key={call.id}>
                      <span className="step-node"><Circle size={9} /></span>
                      <div className="step-copy">
                        <strong>{roleLabel(call.agentRole)} · {toolLabel(call.toolId)}</strong>
                        <span>声明：{hide(call.declared.intent)}</span>
                        <span>执行：{executionLabel(String(call.execution.status))}</span>
                        <span>核验：{verdictPresentation[call.verification.verdict]?.label ?? call.verification.verdict}</span>
                        {call.verification.verdict !== 'confirmed' ? <span>模型声称 {hide(call.declared.intent)}，核验发现 {hide(actual)}</span> : null}
                      </div>
                    </div>
                  )
                }) : <span className="muted">还没有工具调用。</span>}
              </div>

              <div className="detail-section-head">
                <div><h3>产物</h3><p>只展示可检查的实际结果。</p></div>
              </div>
              <div className="artifact-row">
                {selected.artifacts.length ? selected.artifacts.map((artifact) => (
                  <button type="button" key={artifact} onClick={() => notify(artifact)}>
                    <FileOutput size={14} />{artifact}
                  </button>
                )) : <span className="muted">尚未生成可检查的产物。</span>}
              </div>

              <div className={`result-card${selected.status === '等待批准' ? ' amber' : ''}`}>
                <strong><Clock3 size={14} />结果核验</strong>
                <p>{selected.result}</p>
              </div>
            </>
          ) : (
            <EmptyState title="选择一个任务" description="任务详情会显示步骤、审批与产物。" />
          )}
        </Card>
      </div>

      <TaskCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
      <ApprovalDialog open={approvalOpen} onOpenChange={setApprovalOpen} task={selected ?? null} />
      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="取消这个任务？"
        description="已完成的步骤和产物会保留，但任务不会被标记为成功。"
        confirmLabel="取消任务"
        tone="red"
        onConfirm={confirmCancel}
        busy={busyCancel}
      >
        {selected ? <TaskCancelSummary task={selected} /> : null}
      </ConfirmDialog>
    </div>
  )
}

function TaskCancelSummary({ task }: { task: Task }): React.JSX.Element {
  return (
    <div className="cancel-summary">
      <strong>{task.title}</strong>
      <p>当前状态：{task.status} · 已完成 {task.steps.filter((step) => step.state === '完成').length} 个步骤</p>
      <p>取消只会停止后续安排，不会删除已经生成的文件。</p>
    </div>
  )
}
