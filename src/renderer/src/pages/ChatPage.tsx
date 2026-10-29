import { ArrowRight, AudioLines, MonitorUp, Plus, Search, Send, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Message } from '@shared/types'
import { TaskCreateDialog } from '../components/dialogs'
import { Button, Card, CardHead, EmptyState, Pill, Spinner } from '../components/ui'
import { StatusPill } from '../components/StatusPill'
import { MemoryRecallStatus } from '../components/MemoryRecallStatus'
import { clockLabel } from '../lib/utils'
import { playSamples, startRecording, type Recording } from '../lib/audio'
import { onWindowHidden } from '../lib/window-visibility'
import { useAppStore } from '../store'

export function ChatPage(): React.JSX.Element {
  const navigate = useNavigate()
  const data = useAppStore((state) => state.data)!
  const selectedId = useAppStore((state) => state.selectedConversationId)
  const selectConversation = useAppStore((state) => state.selectConversation)
  const createConversation = useAppStore((state) => state.createConversation)
  const sendMessage = useAppStore((state) => state.sendMessage)
  const busy = useAppStore((state) => {
    const id = state.selectedConversationId ?? state.data?.conversations[0]?.id
    return Boolean(state.busy[`chat:send:${id}`] || state.busy[`chat:remote:${id}`])
  })
  const notify = useAppStore((state) => state.notify)
  const [search, setSearch] = useState('')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [optimistic, setOptimistic] = useState<Record<string, Message[]>>({})
  const [contextOpen, setContextOpen] = useState(true)
  const [streaming, setStreaming] = useState<Record<string, string>>({})
  const [taskDialog, setTaskDialog] = useState(false)
  const [voiceMode, setVoiceMode] = useState(false)
  const recordingController = useRef<AbortController | null>(null)
  const playbackController = useRef<AbortController | null>(null)
  const recordingRef = useRef<Recording | null>(null)
  const recordingConversationRef = useRef<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const cancelVoiceInput = useCallback((): void => {
    recordingController.current?.abort()
    recordingController.current = null
    const active = recordingRef.current
    recordingRef.current = null
    recordingConversationRef.current = null
    void active?.stop().catch(() => undefined)
    setVoiceMode(false)
  }, [])
  useEffect(() => onWindowHidden(cancelVoiceInput), [cancelVoiceInput])
  useEffect(() => window.murasame?.settings.onChanged(settings => {
    if (!settings.speakReplies) playbackController.current?.abort()
    if (!settings.permissions.microphone) recordingController.current?.abort()
    if (!settings.permissions.microphone && recordingRef.current) {
      const active = recordingRef.current; recordingRef.current = null
      void active.stop().catch(() => undefined)
      setVoiceMode(false)
    }
  }), [])

  useEffect(() => () => {
    recordingController.current?.abort()
    playbackController.current?.abort()
    void recordingRef.current?.stop().catch(() => undefined)
  }, [])

  useEffect(() => { playbackController.current?.abort() }, [selectedId])

  const conversation = data.conversations.find((item) => item.id === selectedId) ?? data.conversations[0]
  const filtered = data.conversations.filter((item) =>
    `${item.title}${item.preview}`.toLowerCase().includes(search.trim().toLowerCase())
  )
  const currentTask = data.tasks.find((task) => task.status === '执行中' || task.status === '等待批准')
  const defaultModel = data.models.find((model) => model.default)
  const draft = conversation ? drafts[conversation.id] ?? '' : ''
  const displayMessages = conversation ? [...conversation.messages, ...(optimistic[conversation.id] ?? [])] : []
  const recalledIds = new Set(conversation?.recalledMemoryIds ?? [])
  const recalledMemories = data.memories.filter((memory) => recalledIds.has(memory.id))
  const setDraftFor = (id: string, value: string): void => { setDrafts((current) => ({ ...current, [id]: value })) }
  const streamingText = conversation ? streaming[conversation.id] ?? '' : ''

  useEffect(() => {
    if (!selectedId && data.conversations[0]) selectConversation(data.conversations[0].id)
  }, [selectedId, data.conversations, selectConversation])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [displayMessages.length, busy, streamingText])

  useEffect(() => {
    if (!window.murasame) return
    const stopDelta = window.murasame.events.onMessageDelta((payload) => {
      setStreaming((current) => ({
        ...current,
        [payload.conversationId]: `${current[payload.conversationId] ?? ''}${payload.delta}`
      }))
    })
    const stopStarted = window.murasame.events.onMessageStarted((payload) => {
      setOptimistic((current) => {
        const pending = current[payload.conversationId] ?? []
        if (pending.some((item) => item.text === payload.userText)) return current
        return { ...current, [payload.conversationId]: [...pending, { id: `pending-${payload.conversationId}`, role: 'user', text: payload.userText, time: clockLabel() }] }
      })
    })
    const dropStreaming = (conversationId: string): void => {
      setStreaming((current) => {
        if (!(conversationId in current)) return current
        const next = { ...current }
        delete next[conversationId]
        return next
      })
    }
    const stopUpdated = window.murasame.events.onConversationUpdated((next) => {
      setOptimistic((current) => ({ ...current, [next.id]: (current[next.id] ?? []).filter((item) => !next.messages.some((message) => message.role === 'user' && message.text === item.text)) }))
      dropStreaming(next.id)
    })
    const stopFailed = window.murasame.events.onMessageFailed((payload) => {
      setOptimistic((current) => ({ ...current, [payload.conversationId]: [] }))
      dropStreaming(payload.conversationId)
    })
    return () => {
      stopDelta()
      stopStarted()
      stopUpdated()
      stopFailed()
    }
  }, [])

  const sendInConversation = async (id: string, text: string): Promise<void> => {
    setDraftFor(id, '')
    setStreaming((current) => ({ ...current, [id]: '' }))
    setOptimistic((current) => ({ ...current, [id]: [...(current[id] ?? []), { id: `optimistic-${Date.now()}`, role: 'user', text, time: clockLabel() }] }))
    try {
      const saved = await sendMessage(id, text)
      if (!saved) setDrafts((current) => ({ ...current, [id]: current[id] || text }))
    } finally {
      setOptimistic((current) => ({ ...current, [id]: [] }))
      setStreaming((current) => { const next = { ...current }; delete next[id]; return next })
    }
  }

  const handleSend = async (): Promise<void> => {
    if (!conversation || !draft.trim() || busy) return
    await sendInConversation(conversation.id, draft.trim())
  }

  const quickSend = async (text: string): Promise<void> => {
    if (!conversation || busy) return
    await sendInConversation(conversation.id, text)
  }

  const newConversation = async (): Promise<void> => { await createConversation() }

  const toggleVoice = async (): Promise<void> => {
    if (document.hidden) { cancelVoiceInput(); return }
    if (recordingRef.current) {
      const recording = recordingRef.current
      const controller = recordingController.current
      const id = recordingConversationRef.current
      recordingRef.current = null
      setVoiceMode(false)
      const samples = await recording.stop()
      if (controller?.signal.aborted || recordingController.current !== controller) return
      const result = await window.murasame.voice.transcribe(samples)
      if (controller?.signal.aborted || recordingController.current !== controller) return
      if (!result.accepted) {
        notify(result.message, 'amber')
        return
      }
      if (id) setDrafts((current) => ({ ...current, [id]: current[id] ? `${current[id]} ${result.text}` : result.text }))
      return
    }
    if (!data.settings.permissions.microphone) {
      notify('录音授权被拒绝。文字输入仍然可用，这次没有生成内容。', 'amber')
      navigate('/settings')
      return
    }
    recordingController.current?.abort()
    const controller = new AbortController()
    recordingController.current = controller
    const readiness = await window.murasame.voice.readiness()
    if (controller.signal.aborted || recordingController.current !== controller) return
    if (!readiness.stt) {
      notify(readiness.detail, 'red')
      return
    }
    try {
      recordingConversationRef.current = conversation?.id ?? null
      const recording = await startRecording(controller.signal)
      if (controller.signal.aborted || recordingController.current !== controller) { await recording.stop(); return }
      recordingRef.current = recording
      setVoiceMode(true)
      notify('正在录音，再点一次结束并识别', 'blue')
    } catch (error) {
      if (controller.signal.aborted || recordingController.current !== controller) return
      notify(error instanceof Error ? error.message : '无法打开麦克风', 'red')
    }
  }

  const readAloud = async (text: string): Promise<void> => {
    playbackController.current?.abort()
    const controller = new AbortController()
    playbackController.current = controller
    const spoken = await window.murasame.voice.speak(text)
    if (controller.signal.aborted) return
    if (!spoken.played) {
      notify(spoken.message, 'amber')
      return
    }
    await playSamples(spoken.samples, spoken.sampleRate, undefined, controller.signal)
  }

  return (
    <div className="page chat-page">
      <div className={`chat-layout${contextOpen ? '' : ' context-collapsed'}`}>
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
                  <StatusPill status={!data.settings.memoryEnabled ? 'memory-off' : data.memoryReady ? 'memory-on' : 'memory-waiting'} />
                  <Button size="sm" aria-expanded={contextOpen} aria-controls="chat-context-panel" onClick={() => setContextOpen((open) => !open)}>{contextOpen ? '收起上下文' : '展开上下文'}</Button>
                  <Pill tone="gray">文字</Pill>
                </div>
              </div>
              <div className="chat-messages">
                {displayMessages.map((message) => (
                  <div className={`message-row ${message.role}`} key={message.id}>
                    {message.role === 'assistant' ? <div className="message-avatar">雨</div> : null}
                    <div className="message-wrap">
                      <div className="message-meta">
                        <strong>{message.role === 'assistant' ? (data.character.name.trim() || '桌宠') : (data.settings.userName.trim() || '你')}</strong>
                        <time>{message.time}</time>
                        {message.role === 'assistant' ? (
                          <button type="button" className="text-button" onClick={() => void readAloud(message.text)}>朗读</button>
                        ) : null}
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
                  onChange={(event) => setDraftFor(conversation.id, event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                      event.preventDefault()
                      void handleSend()
                    }
                  }}
                  placeholder={`和${data.character.name.trim() || '桌宠'}说点什么… Enter 发送，Shift + Enter 换行`}
                  data-testid="chat-input"
                  rows={2}
                />
                <div className="composer-tools">
                  <button type="button" className={voiceMode ? 'composer-tool active' : 'composer-tool'} onClick={toggleVoice}>
                    <AudioLines size={15} />{voiceMode ? '结束并识别' : '语音'}
                  </button>
                  <button type="button" className="composer-tool" onClick={() => navigate('/screen')}>
                    <MonitorUp size={15} />屏幕
                  </button>
                  <button type="button" className="composer-tool" onClick={() => setTaskDialog(true)}>
                    <Sparkles size={15} />转任务
                  </button>
                  <span className="composer-model">{defaultModel?.model || '尚未配置模型'}</span>
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
              description="从一个小问题开始。对话只保存在这台电脑上，敏感操作会先问你。"
              action={<Button variant="primary" onClick={() => void newConversation()}>新建会话</Button>}
            />
          )}
        </Card>

        <div className="chat-context" id="chat-context-panel" hidden={!contextOpen}>
          <Card>
            <CardHead title="本轮上下文" subtitle="显示最近一次已完成回复的记忆使用情况" aside={<Pill tone="gray">仅本机</Pill>} />
            <div className="context-list">
              <div><span>角色</span><strong>{data.character.name.trim() || '未命名'}{data.character.style ? ` · ${data.character.style}` : ''}</strong></div>
              <div><span>模型</span><strong>{defaultModel?.name ?? '尚未配置'}</strong></div>
              <div><span>已保存记忆</span><strong>{data.memories.length} 条</strong></div>
              <div><span>屏幕</span><strong>{data.settings.permissions.screen ? '按需附加画面' : '未附加入口'}</strong></div>
            </div>
            <div className="subheading">已召回的记忆</div>
            <MemoryRecallStatus status={conversation?.memoryRecallStatus} recorded={Boolean(conversation?.recalledAtMessageId)} count={recalledIds.size} />
            <div className="memory-chips">
              {recalledMemories.map((memory) => (
                <Pill key={memory.id} tone="coral">{memory.text}</Pill>
              ))}
              {recalledIds.size === 0 ? <p className="muted">本轮未注入长期记忆</p> : null}
              {recalledIds.size > recalledMemories.length ? <p className="muted">部分曾注入的记忆已更正或删除，当前列表不再展示。</p> : null}
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
