import { ArrowRight, AudioLines, MonitorUp, Plus, Search, Send, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Message } from '@shared/types'
import { TaskCreateDialog } from '../components/dialogs'
import { Button, Card, CardHead, EmptyState, Pill, Spinner } from '../components/ui'
import { clockLabel } from '../lib/utils'
import { useAppStore } from '../store'

export function ChatPage(): React.JSX.Element {
  const navigate = useNavigate()
  const data = useAppStore((state) => state.data)!
  const selectedId = useAppStore((state) => state.selectedConversationId)
  const selectConversation = useAppStore((state) => state.selectConversation)
  const createConversation = useAppStore((state) => state.createConversation)
  const sendMessage = useAppStore((state) => state.sendMessage)
  const busy = useAppStore((state) => Boolean(state.busy['chat:send']))
  const notify = useAppStore((state) => state.notify)
  const [search, setSearch] = useState('')
  const [draft, setDraft] = useState('')
  const [optimistic, setOptimistic] = useState<Message[]>([])
  const [streaming, setStreaming] = useState<Record<string, string>>({})
  const [taskDialog, setTaskDialog] = useState(false)
  const [voiceMode, setVoiceMode] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  const conversation = data.conversations.find((item) => item.id === selectedId) ?? data.conversations[0]
  const filtered = data.conversations.filter((item) =>
    `${item.title}${item.preview}`.toLowerCase().includes(search.trim().toLowerCase())
  )
  const currentTask = data.tasks.find((task) => task.status === '执行中' || task.status === '等待批准')
  const defaultModel = data.models.find((model) => model.default)
  const displayMessages = conversation ? [...conversation.messages, ...optimistic] : []
  const streamingText = conversation ? streaming[conversation.id] ?? '' : ''

  useEffect(() => {
    if (!selectedId && data.conversations[0]) selectConversation(data.conversations[0].id)
  }, [selectedId, data.conversations, selectConversation])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [displayMessages.length, busy, streamingText])

  useEffect(() => {
    if (!window.murasame) return
    return window.murasame.events.onMessageDelta((payload) => {
      setStreaming((current) => ({
        ...current,
        [payload.conversationId]: `${current[payload.conversationId] ?? ''}${payload.delta}`
      }))
    })
  }, [])

  const handleSend = async (): Promise<void> => {
    if (!conversation || !draft.trim() || busy) return
    const text = draft.trim()
    setDraft('')
    setStreaming((current) => ({ ...current, [conversation.id]: '' }))
    setOptimistic([{ id: `optimistic-${Date.now()}`, role: 'user', text, time: clockLabel() }])
    try {
      await sendMessage(conversation.id, text)
    } finally {
      setOptimistic([])
      setStreaming((current) => {
        const next = { ...current }
        delete next[conversation.id]
        return next
      })
    }
  }

  const quickSend = async (text: string): Promise<void> => {
    if (!conversation || busy) return
    setStreaming((current) => ({ ...current, [conversation.id]: '' }))
    setOptimistic([{ id: `optimistic-${Date.now()}`, role: 'user', text, time: clockLabel() }])
    try {
      await sendMessage(conversation.id, text)
    } finally {
      setOptimistic([])
      setStreaming((current) => {
        const next = { ...current }
        delete next[conversation.id]
        return next
      })
    }
  }

  const newConversation = async (): Promise<void> => {
    const next = await createConversation()
    if (next) setDraft('')
  }

  const toggleVoice = (): void => {
    if (!data.settings.permissions.microphone) {
      notify('麦克风尚未授权，请到「运行与隐私」开启', 'amber')
      navigate('/settings')
      return
    }
    setVoiceMode((value) => !value)
    notify(voiceMode ? '语音输入已暂停' : '语音输入已就绪 · 演示模式', 'blue')
  }

  return (
    <div className="page chat-page">
      <div className="chat-layout">
        <Card className="chat-conversations">
          <CardHead
            title="会话"
            subtitle="本地保存 · 已加密"
            aside={<Button size="sm" onClick={() => void newConversation()} icon={<Plus size={15} />} aria-label="新建会话" />}
          />
          <div className="search-box">
            <Search size={15} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索会话…" aria-label="搜索会话" />
          </div>
          <div className="conversation-list">
            {filtered.map((item) => (
              <button
                type="button"
                key={item.id}
                className={`conversation-item${item.id === conversation?.id ? ' active' : ''}`}
                onClick={() => {
                  setOptimistic([])
                  selectConversation(item.id)
                }}
              >
                <div className="conversation-title-row">
                  <strong>{item.title}</strong>
                  <time>{item.time}</time>
                </div>
                <p>{item.preview}</p>
              </button>
            ))}
          </div>
        </Card>

        <Card className="chat-thread-card">
          {conversation ? (
            <>
              <div className="chat-thread-head">
                <div>
                  <h2>{conversation.title}</h2>
                  <span>{conversation.count} 条消息 · 仅保存在此设备</span>
                </div>
                <div className="chat-thread-badges">
                  <Pill tone="green">记忆已开启</Pill>
                  <Pill tone="gray">文字</Pill>
                </div>
              </div>
              <div className="chat-messages">
                {displayMessages.map((message) => (
                  <div className={`message-row ${message.role}`} key={message.id}>
                    {message.role === 'assistant' ? <div className="message-avatar">雨</div> : null}
                    <div className="message-wrap">
                      <div className="message-meta">
                        <strong>{message.role === 'assistant' ? data.character.name : '林澈'}</strong>
                        <time>{message.time}</time>
                      </div>
                      <div className="message-bubble">
                        {message.text.split('\n').map((line, index) => (
                          <span key={`${message.id}-${index}`}>{line || '\u00A0'}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
                {streamingText ? (
                  <div className="message-row assistant">
                    <div className="message-avatar">雨</div>
                    <div className="message-wrap">
                      <div className="message-meta"><strong>{data.character.name}</strong><time>正在回复</time></div>
                      <div className="message-bubble">
                        {streamingText.split('\n').map((line, index) => (
                          <span key={`stream-${index}`}>{line || '\u00A0'}</span>
                        ))}
                        <span className="streaming-cursor" />
                      </div>
                    </div>
                  </div>
                ) : busy ? (
                  <div className="message-row assistant">
                    <div className="message-avatar">雨</div>
                    <div className="thinking-bubble"><Spinner size={13} />正在连接 {defaultModel?.model || '模型'}…</div>
                  </div>
                ) : null}
                <div ref={bottomRef} />
              </div>
              <div className="chat-composer">
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                      event.preventDefault()
                      void handleSend()
                    }
                  }}
                  placeholder="和村雨说点什么… Enter 发送，Shift + Enter 换行"
                  data-testid="chat-input"
                  rows={2}
                />
                <div className="composer-tools">
                  <button type="button" className={voiceMode ? 'composer-tool active' : 'composer-tool'} onClick={toggleVoice}>
                    <AudioLines size={15} />语音
                  </button>
                  <button type="button" className="composer-tool" onClick={() => navigate('/screen')}>
                    <MonitorUp size={15} />屏幕
                  </button>
                  <button type="button" className="composer-tool" onClick={() => setTaskDialog(true)}>
                    <Sparkles size={15} />转任务
                  </button>
                  <span className="composer-model">{defaultModel?.model ?? 'gpt-5.1'} · 上下文 2.4k</span>
                  <Button
                    variant="primary"
                    onClick={() => void handleSend()}
                    disabled={!draft.trim() || busy}
                    data-testid="chat-send"
                    icon={<Send size={15} />}
                  >
                    发送
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <EmptyState
              title="还没有会话"
              description="从一个小问题开始，村雨会保留本地上下文，并在敏感操作前询问你。"
              action={<Button variant="primary" onClick={() => void newConversation()}>新建会话</Button>}
            />
          )}
        </Card>

        <div className="chat-context">
          <Card>
            <CardHead title="本轮上下文" subtitle="村雨会结合当前会话与有效记忆回答" aside={<Pill tone="green">已同步</Pill>} />
            <div className="context-list">
              <div><span>角色</span><strong>{data.character.style}</strong></div>
              <div><span>模型</span><strong>{defaultModel?.name ?? 'OpenAI · 主模型'}</strong></div>
              <div><span>有效记忆</span><strong>{data.memories.length} 条 · 本轮 3 条相关</strong></div>
              <div><span>屏幕</span><strong>{data.settings.permissions.screen ? '按需附加画面' : '未附加入口'}</strong></div>
            </div>
            <div className="subheading">已召回的记忆</div>
            <div className="memory-chips">
              {data.memories.slice(0, 3).map((memory) => (
                <Pill key={memory.id} tone="coral">{memory.text}</Pill>
              ))}
            </div>
            <div className="subheading">快捷动作</div>
            <div className="quick-actions">
              <Button size="sm" onClick={() => void quickSend('总结这段对话，保留结论、待办和仍然不确定的部分。')}>总结这段对话</Button>
              <Button size="sm" onClick={() => void quickSend('解释刚才代码片段的错误，并给出最小修改。')}>解释这段代码</Button>
              <Button size="sm" onClick={() => setTaskDialog(true)}>把讨论整理成任务</Button>
            </div>
          </Card>
          {currentTask ? (
            <Card className="chat-task-card">
              <span>1 个任务正在执行</span>
              <strong>{currentTask.title} · {currentTask.progress}%</strong>
              <button type="button" onClick={() => navigate('/tasks')}>查看任务 <ArrowRight size={14} /></button>
            </Card>
          ) : null}
        </div>
      </div>
      <TaskCreateDialog
        key={conversation?.title ?? 'empty'}
        open={taskDialog}
        onOpenChange={setTaskDialog}
        initialTitle={conversation ? `整理并跟进：${conversation.title}` : ''}
      />
    </div>
  )
}
