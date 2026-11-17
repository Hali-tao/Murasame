import { ArrowUpRight, MessageCircle, Plus, ScanLine } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '../store'
import { greeting, weekdayLabel, dateLabel } from '../lib/utils'
import { Button, Card, CardHead, Pill } from '../components/ui'
import { AffectWeatherCard } from '../components/AffectWeatherCard'
import { DailyRecapCard } from '../components/DailyRecapCard'
import type { TaskStatus } from '@shared/types'

const pendingStatuses: TaskStatus[] = ['待确认', '等待批准']
const runningStatuses: TaskStatus[] = ['已确认', '规划中', '执行中', '正在停止']

export function DashboardPage(): React.JSX.Element {
  const navigate = useNavigate()
  const data = useAppStore((state) => state.data)!
  const selectConversation = useAppStore((state) => state.selectConversation)
  const pending = data.tasks.filter(task => pendingStatuses.includes(task.status))
  const running = data.tasks.filter(task => runningStatuses.includes(task.status))
  const activeTasks = [...pending, ...running]
  const conversations = data.conversations.filter(item => item.messages.some(message => message.role === 'user'))
  const latest = conversations[0]
  const recent = conversations.slice(1, 4)
  const createConversation = useAppStore(state => state.createConversation)
  const [creating, setCreating] = useState(false)
  const startConversation = async (): Promise<void> => {
    if (creating) return
    setCreating(true)
    try {
      const conversation = await createConversation()
      if (conversation) navigate('/chat')
    } finally { setCreating(false) }
  }
  const defaultModel = data.models.find(model => model.default)
  const openConversation = (id?: string): void => {
    if (id) selectConversation(id)
    navigate('/chat')
  }

  return (
    <div className="page dashboard-page">
      <header className="dashboard-heading">
          <div className="dashboard-date">{dateLabel()} · {weekdayLabel()}</div>
          <h2>{greeting()}，{data.settings.userName.trim() || '你'}。</h2>
      </header>

      {(!defaultModel || defaultModel.status !== '在线') && <div className="dashboard-service" role="status">
        <span>{!defaultModel ? '开始交流前，请先配置模型服务。' : `${defaultModel.name} · ${defaultModel.status}，可到模型服务检查连接。`}</span>
        <Button size="sm" onClick={() => navigate('/models')}>{defaultModel ? '检查连接' : '配置模型服务'}</Button>
      </div>}

      <div className="dashboard-layout">
        <div className="dashboard-primary">
          <section className="dashboard-resume">
            <span className="dashboard-eyebrow">{latest ? '继续上次交流' : '开始一段交流'}</span>
            <h2>{latest?.title || '有什么想聊的？'}</h2>
            <p className="dashboard-resume-preview">{latest?.preview || '提出一个问题，或说说你正在做的事。'}</p>
            {latest && <div className="dashboard-conversation-meta"><time>{latest.time}</time><span>{latest.count} 条消息</span></div>}
            <div className="dashboard-actions">
              {latest ? <Button variant="primary" onClick={() => openConversation(latest.id)} icon={<MessageCircle size={16} />}>继续交流</Button> : <Button variant="primary" onClick={() => void startConversation()} disabled={creating} icon={<Plus size={16} />}>开始交流</Button>}
              {latest && <Button onClick={() => void startConversation()} disabled={creating} icon={<Plus size={16} />}>新对话</Button>}
            </div>
          </section>

          {recent.length > 0 && <section className="dashboard-recent">
            <div className="dashboard-section-heading"><h2>其他最近会话</h2><Button size="sm" onClick={() => navigate('/history')}>全部历史</Button></div>
            <div className="dashboard-conversations">{recent.map(conversation => (
              <button type="button" key={conversation.id} className="dashboard-conversation" onClick={() => openConversation(conversation.id)}>
                <span className="dashboard-item-heading"><strong>{conversation.title}</strong><ArrowUpRight size={15} /></span>
                <span className="dashboard-preview">{conversation.preview}</span>
                <span className="dashboard-conversation-meta"><time>{conversation.time}</time></span>
              </button>
            ))}</div>
          </section>}
          <div className="dashboard-shortcuts"><Button size="sm" onClick={() => navigate('/screen')} icon={<ScanLine size={15} />}>框选屏幕并分析</Button><Button size="sm" onClick={() => navigate('/history')}>查看聊天历史</Button></div>
        </div>

        <aside className="dashboard-secondary">
        {activeTasks.length > 0 ? <Card className={pending.length ? 'dashboard-needs-attention' : ''}>
          <CardHead title={pending.length ? '需要你确认' : '进行中的任务'} subtitle={`${pending.length} 项待确认 · ${running.length} 项进行中`} aside={<Button size="sm" onClick={() => navigate('/tasks')}>全部任务</Button>} />
          <div className="dashboard-card-body">
            <div className="dashboard-task-list">{activeTasks.slice(0, 3).map(task => (
              <div className="dashboard-task" key={task.id}>
                <div className="dashboard-item-heading"><h3>{task.title}</h3><Pill tone={task.tone}>{task.status}</Pill></div>
                <p>{task.summary}</p>
                {runningStatuses.includes(task.status) && <div className="progress-line">
                  <div className="progress-track"><span style={{ width: `${Math.min(100, Math.max(0, task.progress))}%` }} /></div>
                  <small>{Number(task.progress.toFixed(1))}%</small>
                </div>}
                <Button size="sm" onClick={() => navigate(`/tasks?focus=${encodeURIComponent(task.id)}`)} icon={<ArrowUpRight size={14} />}>{pendingStatuses.includes(task.status) ? '查看并确认' : '查看进度'}</Button>
              </div>
            ))}</div>
          </div>
        </Card> : <div className="dashboard-task-idle"><span>暂无待处理任务</span><button type="button" onClick={() => navigate('/tasks')}>全部任务 →</button></div>}
        <DailyRecapCard />
        <AffectWeatherCard />
        </aside>
      </div>
      <div className="dashboard-stats" aria-label="数据与设置入口">
        <button type="button" onClick={() => navigate('/history')}>聊天记录 <strong>{data.conversations.length}</strong> 个会话</button>
        <button type="button" onClick={() => navigate('/memory')}>长期记忆 <strong>{data.memories.length}</strong> 条</button>
        <button type="button" onClick={() => navigate('/tools')}>已启用工具 <strong>{data.tools.filter(tool => tool.enabled).length} / {data.tools.length}</strong></button>
        <button type="button" onClick={() => navigate('/models')}>模型服务 · {defaultModel?.name || '未配置'}</button>
      </div>
    </div>
  )
}
