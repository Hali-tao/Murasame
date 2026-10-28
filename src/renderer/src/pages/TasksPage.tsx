import { Check, Circle, Clock3, FileOutput, Plus, RefreshCw, ShieldAlert, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Task, TaskStatus } from '@shared/types'
import { approvalSummary } from '@shared/task-approval'
import { currentTaskCalls } from '@shared/task-call-presentation'
import { ApprovalDialog, TaskCreateDialog } from '../components/dialogs'
import { Button, Card, CardHead, ConfirmDialog, EmptyState, Pill } from '../components/ui'
import { executionLabel, roleLabel, toolLabel, verdictPresentation } from '../lib/status'
import { useAppStore } from '../store'

type TaskFilter = '全部任务' | TaskStatus
const taskFilters: TaskFilter[] = ['全部任务', '待确认', '已确认', '规划中', '执行中', '等待批准', '正在停止', '已完成', '部分完成', '失败', '已取消', '已中断']

export function TasksPage(): React.JSX.Element {
  const data = useAppStore((state) => state.data)!
  const selectedId = useAppStore((state) => state.selectedTaskId)
  const selectTask = useAppStore((state) => state.selectTask)
  const [params] = useSearchParams()
  const cancelTask = useAppStore((state) => state.cancelTask)
  const busyCancel = useAppStore((state) => Boolean(state.busy['task:cancel']))
  const notify = useAppStore((state) => state.notify)
  const focus = params.get('focus')
  const [filterChoice, setFilterChoice] = useState<{ focus: string | null; value: TaskFilter }>({ focus, value: '全部任务' })
  const filter = filterChoice.focus === focus ? filterChoice.value : '全部任务'
  const setFilter = (value: TaskFilter): void => setFilterChoice({ focus, value })
  const [createOpen, setCreateOpen] = useState(false)
  const [approvalTaskId, setApprovalTaskId] = useState<string | null>(null)
  const [cancelTaskId, setCancelTaskId] = useState<string | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [continuing, setContinuing] = useState(false)

  useEffect(() => {
    if (focus) selectTask(focus)
  }, [focus, selectTask])

  const filtered = data.tasks.filter((task) => filter === '全部任务' || task.status === filter)
  const selected = filtered.find((task) => task.id === selectedId) ?? filtered[0]
  const approvalOpen = Boolean(selected && approvalTaskId === selected.id)
  const cancelOpen = Boolean(selected && cancelTaskId === selected.id)
  const setApprovalOpen = (open: boolean): void => setApprovalTaskId(open && selected ? selected.id : null)
  const setCancelOpen = (open: boolean): void => setCancelTaskId(open && selected ? selected.id : null)
  const answer = answers[selected?.id ?? ''] ?? ''
  const setAnswer = (value: string): void => { if (selected) setAnswers(current => ({ ...current, [selected.id]: value })) }
  const continueSelected = async (value: string): Promise<void> => {
    if (!selected || continuing || !value.trim()) return
    const id = selected.id
    setContinuing(true)
    try {
      const result = await window.murasame.core.continueTask(id, value.trim())
      if (!result.ok) notify(result.error, 'red')
      else setAnswers(current => ({ ...current, [id]: '' }))
    } catch (error) { notify(error instanceof Error ? error.message : '暂时无法继续，请重试', 'red') }
    finally { setContinuing(false) }
  }

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
          <select className="select" value={filter} onChange={(event) => { setFilter(event.target.value as TaskFilter); setApprovalOpen(false); setCancelOpen(false) }} aria-label="筛选任务">
            {taskFilters.map((option) => <option key={option}>{option}</option>)}
          </select>
          <Pill tone={selected?.status === '等待批准' ? 'amber' : 'blue'}>{selected?.status ?? '暂无任务'}</Pill>
          <div className="task-list">
            {filtered.map((task) => (
              <button
                type="button"
                key={task.id}
                data-testid="task-item"
                className={`task-list-item${task.id === selected?.id ? ' active' : ''}`}
                onClick={() => { setApprovalOpen(false); setCancelOpen(false); selectTask(task.id) }}
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
              {['待确认', '已中断', '失败', '部分完成', '已取消'].includes(selected.status) ? (
                <form className="task-clarification" onSubmit={async event => {
                  event.preventDefault()
                  await continueSelected(answer)
                }}>
                  <label htmlFor="task-answer">补充任务信息</label>
                  <textarea id="task-answer" value={answer} onChange={event => setAnswer(event.target.value)} placeholder="回答上方问题，补充目录、目标或限制" />
                  <Button type="submit" disabled={continuing || !answer.trim()}>继续规划</Button>
                  <Button type="button" disabled={continuing} onClick={() => void continueSelected('继续')} data-testid="resume-task">核对并继续</Button>
                  <p className="muted">先核对已有成果，再为未完成的操作申请批准；结果未知的调用不会自动重做。</p>
                </form>
              ) : null}
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
                    <p>{approvalSummary(selected.approval)}</p>
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
                {selected.toolCalls.length ? currentTaskCalls(selected.toolCalls, selected.status).map((call) => {
                  const hide = (value: string): string => value.replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-••••')
                  const actual = call.verification.evidence.map((item) => item.actual).join('、') || call.execution.status
                  return (
                    <div className="step-row" key={call.id}>
                      <span className="step-node"><Circle size={9} /></span>
                      <div className="step-copy">
                        <strong>{roleLabel(call.agentRole)} · {toolLabel(call.toolId)}</strong>
                        <span>声明：{hide(call.declared.intent)}</span>
                        <span>执行：{executionLabel(String(call.execution.status))}</span>
                        <span>核验：{call.execution.status === 'running' ? '等待执行结果' : call.execution.status === 'unknown' ? '需要核对实际影响，不会自动重做' : verdictPresentation[call.verification.verdict]?.label ?? call.verification.verdict}</span>
                        {!['running', 'unknown'].includes(call.execution.status) && call.verification.verdict !== 'confirmed' ? <span>模型声称 {hide(call.declared.intent)}，核验发现 {hide(actual)}</span> : null}
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
                  <button type="button" key={artifact} onClick={async () => {
                    const result = await window.murasame.core.openArtifact(selected.id, artifact)
                    if (!result.ok) notify(result.error, 'red')
                  }}>
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
