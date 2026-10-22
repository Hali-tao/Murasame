import { ArrowUpRight, CheckCircle2, CircleDot, LockKeyhole, Sparkles } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { activity } from '@shared/mock-data'
import { useAppStore } from '../store'
import { greeting, weekdayLabel, dateLabel } from '../lib/utils'
import { Button, Card, CardHead, Pill, StatTile } from '../components/ui'

export function DashboardPage(): React.JSX.Element {
  const navigate = useNavigate()
  const data = useAppStore((state) => state.data)!
  const characterName = data.character.name
  const activeTask = data.tasks.find((task) => task.status === '执行中' || task.status === '等待批准') ?? data.tasks[0]
  const runningTasks = data.tasks.filter((task) => task.status === '执行中' || task.status === '等待批准').length
  const conversationMessages = data.conversations.reduce((sum, conversation) => sum + conversation.count, 0)
  const enabledTools = data.tools.filter((tool) => tool.enabled).length
  const selectedConversation = data.conversations[0]

  return (
    <div className="page dashboard-page">
      <section className="hero-card">
        <div className="hero-copy">
          <div className="hero-date">{weekdayLabel()} · {dateLabel()}</div>
          <h2>{greeting()}，林澈。</h2>
          <p>村雨已准备好继续昨天的对话，长期记忆正在使用。所有敏感动作仍会在执行前单独确认。</p>
          <div className="hero-pills">
            <Pill tone="green"><i className="tiny-dot" />模型服务在线</Pill>
            <Pill tone="violet">{data.settings.memoryEnabled ? '记忆已启用' : '记忆已停用'}</Pill>
            <Pill tone="blue">{data.settings.permissions.screen ? '屏幕权限已授权' : '屏幕权限未授权'}</Pill>
          </div>
          <div className="hero-actions">
            <Button variant="primary" onClick={() => navigate('/chat')} icon={<Sparkles size={16} />}>
              继续交流
            </Button>
            <Button variant="dark" onClick={() => navigate('/tasks')}>查看今日任务</Button>
          </div>
        </div>
        <div className="hero-orbit" aria-hidden="true">
          <div className="orbit-ring ring-one" />
          <div className="orbit-ring ring-two" />
          <div className="orbit-ring ring-three" />
          <span className="orbit-satellite sat-one" />
          <span className="orbit-satellite sat-two" />
          <div className="orbit-core">雨</div>
        </div>
      </section>

      <div className="stat-grid four">
        <StatTile label="进行中任务" value={runningTasks} caption={`${data.tasks.filter((task) => task.status === '等待批准').length} 项等待批准`} tone="blue" />
        <StatTile label="长期记忆" value={data.memories.length} caption="今天更新 3 条" tone="violet" />
        <StatTile label="今日对话" value={conversationMessages} caption="约 2,400 字上下文" tone="coral" />
        <StatTile label="可用能力" value={`${enabledTools} / ${data.tools.length}`} caption={`${data.tools.length - enabledTools} 项权限停用`} tone="green" />
      </div>

      <div className="dashboard-columns">
        <Card className="dashboard-activity">
          <CardHead title="正在发生" subtitle="来自对话、任务、屏幕与工具的最近记录" />
          <div className="activity-list">
            {activity.map((item) => (
              <div className="activity-row" key={`${item.time}-${item.text}`}>
                <time>{item.time}</time>
                <Pill tone={item.tone}>{item.category}</Pill>
                <div className="activity-copy">
                  <span>{item.text}</span>
                  <small>{item.ago}</small>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <div className="dashboard-side">
          <Card>
            <CardHead
              title="当前任务"
              subtitle="执行期间仍可继续交流"
              aside={activeTask ? <Pill tone={activeTask.tone}>{activeTask.status}</Pill> : null}
            />
            {activeTask ? (
              <div className="active-task">
                <h3>{activeTask.title}</h3>
                <p>{activeTask.summary}</p>
                <div className="progress-line">
                  <div className="progress-track"><span style={{ width: `${activeTask.progress}%` }} /></div>
                  <small>{activeTask.progress}%</small>
                </div>
                <p className="muted small">当前：{activeTask.steps.find((step) => step.state === '进行中')?.title ?? '等待下一步安排'}</p>
                <Button onClick={() => navigate('/tasks')} icon={<ArrowUpRight size={15} />}>打开任务详情</Button>
              </div>
            ) : (
              <p className="muted">当前没有运行中的任务。</p>
            )}
          </Card>

          <Card>
            <CardHead title="运行状态" subtitle="本地能力不受在线服务短暂波动影响" />
            <div className="runtime-list">
              <div><span><CircleDot size={14} />桌面应用</span><strong>运行中 · 资源占用低</strong></div>
              <div><span><LockKeyhole size={14} />本地数据</span><strong>已加密 · 仅此设备</strong></div>
              <div><span><CheckCircle2 size={14} />屏幕采集</span><strong>{data.settings.permissions.screen ? '已授权 · 单次分析' : '已关闭'}</strong></div>
            </div>
          </Card>
        </div>
      </div>

      <div className="dashboard-footnote">
        <span>{characterName} 正在本地运行。</span>
        <span>{selectedConversation ? `最近会话：${selectedConversation.title}` : '尚未创建会话'}</span>
        <button type="button" onClick={() => navigate('/chat')}>继续上次工作 →</button>
      </div>
    </div>
  )
}
