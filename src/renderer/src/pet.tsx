import { Mic, Minus, Plus, RotateCcw, Send, X } from 'lucide-react'
import { StrictMode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { DEFAULT_PET_PRESET, getPetPreset } from '@shared/pet-presets'
import type { Conversation, PerformanceCue, PetChatLayout, PetState } from '@shared/types'
import { Live2DPet, type Live2DPetHandle } from './components/Live2DPet'
import { ErrorBoundary } from './components/ErrorBoundary'
import { allowHitSample, targetFps } from '@shared/render-budget'
import { chooseLayer, idlePresentation, mouthEnvelope, type PerformanceLayer } from './avatar/orchestrator'
import { idleFromPad, baselinePad } from '@shared/avatar/pad'
import { playSamples, startRecording, type Recording } from './lib/audio'
import './styles.css'

function clipBubble(text: string, expanded: boolean): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (expanded || flat.length <= 72) return flat
  return `${flat.slice(0, 72)}…`
}

function PetApp(): React.JSX.Element {
  const [pet, setPet] = useState<PetState>({
    visible: true,
    scale: 0.9,
    x: 0,
    y: 0,
    preset: DEFAULT_PET_PRESET,
    importedModelUrl: ''
  })
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [streaming, setStreaming] = useState('')
  const [pendingUser, setPendingUser] = useState('')
  const [proactiveText, setProactiveText] = useState('')
  const [bubbleExpanded, setBubbleExpanded] = useState(false)
  const [dimmedText, setDimmedText] = useState('')
  const [chat, setChat] = useState<PetChatLayout>({ open: false, side: 'right' })
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [recording, setRecording] = useState(false)
  const [notice, setNotice] = useState('')
  const [voiceNote, setVoiceNote] = useState('')
  const [microphone, setMicrophone] = useState(false)
  const [speakReplies, setSpeakReplies] = useState(true)
  const [dragging, setDragging] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const lastTapAt = useRef(0)
  const live2dRef = useRef<Live2DPetHandle>(null)
  const ignoringRef = useRef(true)
  const lastHitAt = useRef(0)
  const layerRef = useRef<PerformanceLayer>('idle')
  const [pad, setPad] = useState(baselinePad())
  const dragDistanceRef = useRef(0)
  const dragRef = useRef<{
    pointerId: number
    pointerX: number
    pointerY: number
    windowX: number
    windowY: number
    ready: boolean
    started: boolean
  } | null>(null)
  const rafRef = useRef<number | null>(null)
  const latestPosition = useRef<{ x: number; y: number } | null>(null)
  const chatRef = useRef(chat)
  const conversationRef = useRef(conversation)
  const recordingRef = useRef<Recording | null>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const openChatRef = useRef<() => Promise<void>>(async () => undefined)
  const speakRef = useRef(true)
  const speakingRef = useRef(false)
  const queuedSpeech = useRef<string | null>(null)
  const seenAssistantId = useRef<string | null | undefined>(undefined)
  const logRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    speakRef.current = speakReplies
    chatRef.current = chat
    conversationRef.current = conversation
  })

  const preset = useMemo(() => {
    const base = getPetPreset(pet.preset)
    if (!pet.importedModelUrl) return base
    return { ...base, modelUrl: pet.importedModelUrl, name: '导入的形象' }
  }, [pet.importedModelUrl, pet.preset])

  const lastAssistant = [...(conversation?.messages ?? [])].reverse().find((item) => item.role === 'assistant')
  const bubbleText = streaming || proactiveText || lastAssistant?.text || ''

  useEffect(() => {
    if (!window.murasame) return
    void window.murasame.pet.getState().then(setPet)
    const unsubscribe = window.murasame.pet.onStateChanged(setPet)
    return unsubscribe
  }, [])

  useEffect(() => {
    if (!window.murasame) return
    let cancelled = false
    const applyConversation = (next: Conversation | null): void => {
      setConversation(next)
      setStreaming('')
      setPendingUser((pending) => {
        if (!pending || !next) return ''
        const saved = next.messages.some((item) => item.role === 'user' && item.text === pending)
        return saved ? '' : pending
      })
      setProactiveText('')
    }
    void window.murasame.core.getBootstrap().then((result) => {
      if (cancelled || !result.ok) return
      const id = result.data.activeConversationId ?? result.data.conversations[0]?.id ?? null
      setMicrophone(result.data.settings.permissions.microphone)
      setSpeakReplies(result.data.settings.speakReplies)
      applyConversation(result.data.conversations.find((item) => item.id === id) ?? null)
    })
    const stopUpdated = window.murasame.events.onConversationUpdated((next) => {
      if (conversationRef.current && conversationRef.current.id !== next.id) return
      applyConversation(next)
    })
    const stopActive = window.murasame.events.onActiveConversation(({ id }) => {
      if (conversationRef.current?.id === id) return
      void window.murasame.core.getBootstrap().then((result) => {
        if (cancelled || !result.ok) return
        applyConversation(result.data.conversations.find((item) => item.id === id) ?? null)
      })
    })
    const stopDelta = window.murasame.events.onMessageDelta((payload) => {
      const currentId = conversationRef.current?.id
      if (currentId && payload.conversationId !== currentId) return
      setProactiveText('')
      setStreaming((value) => `${value}${payload.delta}`)
    })
    const stopStarted = window.murasame.events.onMessageStarted((payload) => {
      const currentId = conversationRef.current?.id
      if (currentId && payload.conversationId !== currentId) return
      setPendingUser((value) => (value === payload.userText ? value : payload.userText))
      setStreaming('')
    })
    const stopFailed = window.murasame.events.onMessageFailed((payload) => {
      const currentId = conversationRef.current?.id
      if (currentId && payload.conversationId !== currentId) return
      setPendingUser('')
      setStreaming('')
      if (chatRef.current.open) setNotice(payload.error)
    })
    const stopFocus = window.murasame.pet.onFocusChat(() => {
      void openChatRef.current()
    })
    return () => {
      cancelled = true
      stopUpdated()
      stopActive()
      stopDelta()
      stopStarted()
      stopFailed()
      stopFocus()
    }
  }, [])

  useEffect(() => {
    if (!window.murasame) return
    return window.murasame.pet.onPerformance((cue: PerformanceCue) => {
      setPad(cue.pad)
      layerRef.current = chooseLayer(layerRef.current, 'emotion')
      if (cue.motion) live2dRef.current?.playNamedMotion(cue.motion, cue.expression)
      if (cue.text?.trim()) {
        setProactiveText(cue.text.trim())
        setBubbleExpanded(false)
      }
      layerRef.current = 'idle'
    })
  }, [])

  useEffect(() => {
    if (!window.murasame) return
    return window.murasame.settings.onChanged((settings) => {
      setSpeakReplies(settings.speakReplies)
      setMicrophone(settings.permissions.microphone)
    })
  }, [])

  useEffect(() => {
    const last = [...(conversation?.messages ?? [])].reverse().find((item) => item.role === 'assistant')
    if (seenAssistantId.current === undefined) {
      if (!conversation) return
      seenAssistantId.current = last?.id ?? null
      return
    }
    if (!last || last.id === seenAssistantId.current) return
    seenAssistantId.current = last.id
    if (!speakRef.current) return
    const speak = async (text: string): Promise<void> => {
      speakingRef.current = true
      try {
        const spoken = await window.murasame.voice.speak(text)
        if (!spoken.played || spoken.samples.length === 0) {
          setVoiceNote(spoken.message || '这次没有出声，文字还在。')
          live2dRef.current?.setMouth(null)
          return
        }
        setVoiceNote('')
        const frames = mouthEnvelope(spoken.samples, spoken.sampleRate)
        await playSamples(spoken.samples, spoken.sampleRate, (seconds) => {
          const index = Math.min(frames.length - 1, Math.floor(seconds * 30))
          live2dRef.current?.setMouth(frames[index] ?? 0)
        })
        live2dRef.current?.setMouth(0)
        window.setTimeout(() => live2dRef.current?.setMouth(null), 120)
      } catch (error) {
        setVoiceNote(error instanceof Error ? error.message : '朗读失败，文字还在。')
        live2dRef.current?.setMouth(null)
      } finally {
        speakingRef.current = false
        const next = queuedSpeech.current
        queuedSpeech.current = null
        if (next) void speak(next)
      }
    }
    if (speakingRef.current) {
      queuedSpeech.current = last.text
      return
    }
    void speak(last.text)
  }, [conversation])

  useEffect(() => {
    if (!bubbleText || chat.open || bubbleExpanded) return
    const timer = window.setTimeout(() => setDimmedText(bubbleText), 6000)
    return () => window.clearTimeout(timer)
  }, [bubbleText, chat.open, bubbleExpanded])
  const bubbleDim = Boolean(bubbleText) && dimmedText === bubbleText && !chat.open && !bubbleExpanded

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [conversation?.messages.length, streaming, pendingUser, chat.open])

  useEffect(() => {
    const handleMove = (event: MouseEvent): void => {
      if (dragRef.current) return
      const now = performance.now()
      if (!allowHitSample(now, lastHitAt.current)) return
      lastHitAt.current = now
      const target = event.target as HTMLElement | null
      const overHitArea = Boolean(target?.closest('[data-pet-hit]'))
      const shouldIgnore = !overHitArea
      if (shouldIgnore !== ignoringRef.current) {
        ignoringRef.current = shouldIgnore
        void window.murasame.pet.setIgnoreMouseEvents(shouldIgnore)
      }
    }
    window.addEventListener('mousemove', handleMove, true)
    return () => window.removeEventListener('mousemove', handleMove, true)
  }, [])

  const changeScale = async (delta: number): Promise<void> => {
    const next = Math.min(1.4, Math.max(0.6, Math.round((pet.scale + delta) * 10) / 10))
    setPet(await window.murasame.pet.setScale(next))
  }

  const openChat = async (): Promise<void> => {
    if (!window.murasame.pet.setChatOpen) {
      setNotice('对话框还没接上，请重启应用后再试。')
      return
    }
    const layout = await window.murasame.pet.setChatOpen(true)
    setChat(layout)
    setDimmedText('')
    window.setTimeout(() => composerRef.current?.focus(), 30)
  }
  useLayoutEffect(() => {
    openChatRef.current = openChat
  })

  const closeChat = async (): Promise<void> => {
    const layout = await window.murasame.pet.setChatOpen(false)
    setChat(layout)
  }

  const send = async (text: string): Promise<void> => {
    const content = text.trim()
    if (!content || sending) return
    setNotice('')
    setSending(true)
    setDraft('')
    setPendingUser(content)
    setStreaming('')
    setProactiveText('')
    try {
      let id = conversationRef.current?.id
      if (!id) {
        const created = await window.murasame.core.createConversation()
        if (!created.ok) {
          setNotice(created.error)
          setDraft(content)
          setPendingUser('')
          return
        }
        id = created.data.id
        setConversation(created.data)
      }
      const result = await window.murasame.core.sendMessage(id, content)
      if (!result.ok) {
        setNotice(result.error)
        setDraft(content)
        setPendingUser('')
        setStreaming('')
        return
      }
      setConversation(result.data)
      setPendingUser('')
      setStreaming('')
    } finally {
      setSending(false)
    }
  }

  const beginVoice = async (): Promise<void> => {
    if (recordingRef.current || sending) return
    if (!microphone) {
      setNotice('录音授权被拒绝。文字输入仍然可用，这次没有生成内容。')
      return
    }
    const readiness = await window.murasame.voice.readiness()
    if (!readiness.stt) {
      setNotice(readiness.detail)
      return
    }
    try {
      recordingRef.current = await startRecording()
      setRecording(true)
      setNotice('')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '无法打开麦克风')
    }
  }

  const endVoice = async (): Promise<void> => {
    const current = recordingRef.current
    if (!current) return
    recordingRef.current = null
    setRecording(false)
    const samples = await current.stop()
    const result = await window.murasame.voice.transcribe(samples)
    if (!result.accepted || !result.text.trim()) {
      setNotice(result.message || '没有识别到内容。文字输入仍然可用。')
      return
    }
    await send(result.text)
  }

  const startDrag = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragDistanceRef.current = 0
    void window.murasame.pet.setIgnoreMouseEvents(false)
    ignoringRef.current = false
    dragRef.current = {
      pointerId: event.pointerId,
      pointerX: event.screenX,
      pointerY: event.screenY,
      windowX: 0,
      windowY: 0,
      ready: false,
      started: false
    }
    void window.murasame.pet.getBounds().then((bounds) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      drag.windowX = bounds.x
      drag.windowY = bounds.y
      drag.ready = true
    })
  }

  const moveDrag = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragDistanceRef.current = Math.max(
      dragDistanceRef.current,
      Math.hypot(event.screenX - drag.pointerX, event.screenY - drag.pointerY)
    )
    if (!drag.started && dragDistanceRef.current > 4) {
      drag.started = true
      setDragging(true)
    }
    if (!drag.started || !drag.ready) return
    latestPosition.current = {
      x: Math.round(drag.windowX + event.screenX - drag.pointerX),
      y: Math.round(drag.windowY + event.screenY - drag.pointerY)
    }
    if (rafRef.current !== null) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      const position = latestPosition.current
      if (position) void window.murasame.pet.setPosition(position.x, position.y)
    })
  }

  const endDrag = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const moved = drag.started
    const verticalDelta = event.screenY - drag.pointerY
    dragRef.current = null
    setDragging(false)
    if (moved) {
      live2dRef.current?.playMotion(verticalDelta < -18 ? 'dragUp' : verticalDelta > 18 ? 'dragDown' : 'drag')
    } else if (performance.now() - lastTapAt.current > 700) {
      lastTapAt.current = performance.now()
      const bounds = event.currentTarget.getBoundingClientRect()
      const upper = event.clientY - bounds.top < bounds.height * 0.42
      live2dRef.current?.playMotion(upper ? 'tap' : 'drag')
      if (!chatRef.current.open) void openChat()
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const hidden = !pet.visible
  const idle = idlePresentation({ hidden, blinkMs: idleFromPad(pad, hidden)?.blinkMs ?? 4200 })
  const fps = targetFps({ hidden, interacting: dragging || chat.open || sending, idleMs: idle ? 120_000 : 0 })
  if (hidden) return <div className="pet-hidden-root" />

  const recent = conversation?.messages.slice(-8) ?? []
  const anchor = chat.open && chat.side === 'left' ? 'anchor-right' : 'anchor-left'

  return (
    <div className={`pet-stage${dragging ? ' dragging' : ''}${chat.open ? ' chat-open' : ''}`}>
      <div className={`pet-column ${anchor}`}>
        {bubbleText ? (
          <button
            type="button"
            className={`pet-bubble${bubbleDim ? ' is-dim' : ''}`}
            data-pet-hit
            onClick={() => setBubbleExpanded((value) => !value)}
          >
            {clipBubble(bubbleText, bubbleExpanded || chat.open)}
          </button>
        ) : null}
        {voiceNote ? <p className="pet-voice-note" data-pet-hit>{voiceNote}</p> : null}
        <div
          className="pet-character"
          data-pet-hit
          style={{ transform: `scale(${pet.scale})` }}
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onContextMenu={(event) => {
          event.preventDefault()
          setMenuOpen(true)
        }}
        role="button"
          tabIndex={0}
          aria-label="拖动桌宠，单击打开对话"
        >
          <ErrorBoundary compact resetKey={`${preset.id}:${preset.modelUrl}`}>
            <Live2DPet
              key={`${preset.id}:${preset.modelUrl}`}
              ref={live2dRef}
              preset={preset}
              paused={hidden}
              fps={fps}
              blinkMs={idle?.blinkMs ?? 4200}
              breath={idleFromPad(pad, hidden)?.breath ?? 0.5}
            />
          </ErrorBoundary>
        </div>
        <div className="pet-controls" data-pet-hit>
          <button type="button" onClick={() => void changeScale(-0.1)} aria-label="缩小桌宠"><Minus size={14} /></button>
          <span>{Math.round(pet.scale * 100)}%</span>
          <button type="button" onClick={() => void changeScale(0.1)} aria-label="放大桌宠"><Plus size={14} /></button>
          <button type="button" onClick={() => void window.murasame.pet.resetPosition()} aria-label="复位桌宠位置"><RotateCcw size={14} /></button>
          <button type="button" onClick={() => void window.murasame.pet.hide()} aria-label="隐藏桌宠"><X size={14} /></button>
        </div>
        <div className="pet-brand" data-pet-hit><span />MURASAME</div>
        {menuOpen ? (
          <div className="pet-menu" data-pet-hit role="menu">
            <button type="button" onClick={() => { setMenuOpen(false); void openChat() }}>打开对话</button>
            <button type="button" onClick={() => { setMenuOpen(false); void window.murasame.window.showMain() }}>打开控制台</button>
            <button type="button" onClick={() => { setMenuOpen(false); void window.murasame.window.showMain(); void window.murasame.core.analyzeScreen() }}>截图提问</button>
            <button type="button" onClick={() => { setMenuOpen(false); void changeScale(0.1) }}>放大</button>
            <button type="button" onClick={() => { setMenuOpen(false); void changeScale(-0.1) }}>缩小</button>
            <button type="button" onClick={() => { setMenuOpen(false); void window.murasame.pet.hide() }}>隐藏</button>
            <button type="button" onClick={() => { setMenuOpen(false); void window.murasame.settings.update({ doNotDisturb: true }) }}>勿扰</button>
            <button type="button" onClick={() => { setMenuOpen(false); void window.murasame.app.quit() }}>退出</button>
            <button type="button" onClick={() => setMenuOpen(false)}>关闭菜单</button>
          </div>
        ) : null}
      </div>
      {chat.open ? (
        <section className={`pet-chat ${chat.side}`} data-pet-hit data-testid="pet-chat">
          <header className="pet-chat-head">
            <strong>对话</strong>
            <button type="button" onClick={() => void closeChat()} aria-label="收起对话"><X size={14} /></button>
          </header>
          <div className="pet-chat-log" ref={logRef}>
            {recent.map((message) => (
              <p key={message.id} className={`pet-chat-line ${message.role}`}>{message.text}</p>
            ))}
            {pendingUser ? <p className="pet-chat-line user">{pendingUser}</p> : null}
            {streaming ? <p className="pet-chat-line assistant">{streaming}</p> : null}
            {!recent.length && !pendingUser && !streaming ? <p className="pet-chat-empty">说点什么，控制台里能看到同一段对话。</p> : null}
          </div>
          {notice ? <p className="pet-chat-notice">{notice}</p> : null}
          <form
            className="pet-chat-form"
            onSubmit={(event) => {
              event.preventDefault()
              void send(draft)
            }}
          >
            <textarea
              ref={composerRef}
              value={draft}
              aria-label="对桌宠说"
              placeholder="说点什么…"
              rows={2}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void send(draft)
                }
              }}
            />
            <div className="pet-chat-actions">
              <button
                type="button"
                aria-label="按住说话"
                className={recording ? 'is-recording' : ''}
                onPointerDown={() => void beginVoice()}
                onPointerUp={() => void endVoice()}
                onPointerCancel={() => void endVoice()}
              >
                <Mic size={14} />
              </button>
              <button type="submit" aria-label="发送" disabled={sending || !draft.trim()}>
                <Send size={14} />
              </button>
            </div>
          </form>
        </section>
      ) : null}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary compact>
      <PetApp />
    </ErrorBoundary>
  </StrictMode>
)
