import { Mic, Minus, Plus, RotateCcw, Send, SquarePen, X } from 'lucide-react'
import { StrictMode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { DEFAULT_PET_PRESET, getPetPreset } from '@shared/pet-presets'
import { listPetActivities, type PetActivity } from '@shared/pet-activity'
import { petDimensions } from '@shared/pet-geometry'
import { petSpeech } from '@shared/pet-speech'
import { derivePetWork, petWorkMotion } from '@shared/pet-work'
import type { ActivityStatus, Conversation, PerformanceCue, PetChatLayout, PetState, Task, TheaterScene } from '@shared/types'
import { Live2DPet, type Live2DPetHandle } from './components/Live2DPet'
import { MeshPet } from './components/MeshPet'
import { ErrorBoundary } from './components/ErrorBoundary'
import { allowHitSample, targetFps } from '@shared/render-budget'
import { chooseLayer, idlePresentation, mouthEnvelope, type PerformanceLayer } from './avatar/orchestrator'
import { idleFromPad, baselinePad } from '@shared/avatar/pad'
import { playSamples, startRecording, type Recording } from './lib/audio'
import { onWindowHidden } from './lib/window-visibility'
import { followAutonomyStatus } from './lib/autonomy-status'
import './styles.css'

function clipBubble(text: string, expanded: boolean): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (expanded || flat.length <= 72) return flat
  return `${flat.slice(0, 72)}…`
}

function isolationViewSrc(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.searchParams.set('autoconnect', '1')
    parsed.searchParams.set('resize', 'scale')
    return parsed.toString()
  } catch {
    return url
  }
}

function readDismissed(): Set<string> {
  try {
    const raw = window.localStorage.getItem('murasame-pet-dismissed')
    const parsed = raw ? JSON.parse(raw) as unknown : []
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [])
  } catch {
    return new Set()
  }
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
  const [theater, setTheater] = useState<TheaterScene | null>(null)
  const theaterTimerRef = useRef<number | null>(null)
  const [bubbleExpanded, setBubbleExpanded] = useState(false)
  const [dimmedText, setDimmedText] = useState('')
  const [chat, setChat] = useState<PetChatLayout>({ open: false, side: 'right' })
  const [draft, setDraft] = useState('')
  const [sendingIds, setSendingIds] = useState<Record<string, boolean>>({})
  const sending = Boolean(sendingIds[conversation?.id ?? 'new'])
  const [recording, setRecording] = useState(false)
  const [notice, setNotice] = useState('')
  const [voiceNote, setVoiceNote] = useState('')
  const [microphone, setMicrophone] = useState(false)
  const [fileApproval, setFileApproval] = useState<'ask' | 'allow'>('ask')
  const [speakReplies, setSpeakReplies] = useState(true)
  const [dragging, setDragging] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [tasks, setTasks] = useState<Task[]>([])
  const [dismissedActivity, setDismissedActivity] = useState<ReadonlySet<string>>(() => readDismissed())
  const [activityBusy, setActivityBusy] = useState(false)
  const [isolationStopping, setIsolationStopping] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)
  const [isolation, setIsolation] = useState<ActivityStatus | null>(null)
  const [doNotDisturb, setDoNotDisturb] = useState(false)
  const isoUrl = isolation?.viewUrl || ''
  const [isoOpen, setIsoOpen] = useState(true)
  const lastTapAt = useRef(0)
  const lastInteraction = useRef(0)
  const [idleMs, setIdleMs] = useState(0)
  const [speaking, setSpeaking] = useState(false)
  const live2dRef = useRef<Live2DPetHandle>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const characterRef = useRef<HTMLDivElement | null>(null)
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
  const conversationRef = useRef(conversation)
  const activeIdRef = useRef<string | null>(null)
  const selectionVersion = useRef(0)
  const deletedConversationIds = useRef(new Set<string>())
  const settingsVersion = useRef(0)
  const recordingRef = useRef<Recording | null>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const openChatRef = useRef<() => Promise<void>>(async () => undefined)
  const speakRef = useRef(true)
  const speechController = useRef<AbortController | null>(null)
  const recordingController = useRef<AbortController | null>(null)
  const recordingOrigin = useRef<{ id: string | null; version: number } | null>(null)
  const seenAssistantId = useRef<string | null | undefined>(undefined)
  const logRef = useRef<HTMLDivElement>(null)
  const cancelVoiceInput = useCallback((): void => {
    recordingController.current?.abort()
    recordingController.current = null
    const active = recordingRef.current
    recordingRef.current = null
    recordingOrigin.current = null
    void active?.stop().catch(() => undefined)
    setRecording(false)
  }, [])
  useEffect(() => onWindowHidden(cancelVoiceInput), [cancelVoiceInput])
  useLayoutEffect(() => {
    speakRef.current = speakReplies
    conversationRef.current = conversation
  })

  const preset = useMemo(() => {
    const base = getPetPreset(pet.preset)
    if (!pet.importedModelUrl) return base
    return { ...base, modelUrl: pet.importedModelUrl, name: '导入的形象' }
  }, [pet.importedModelUrl, pet.preset])

  const lastAssistant = [...(conversation?.messages ?? [])].reverse().find((item) => item.role === 'assistant')
  const bubbleText = streaming || proactiveText || petSpeech(lastAssistant?.text || '')
  useEffect(() => {
    lastInteraction.current = Date.now()
    const touched = (): void => { lastInteraction.current = Date.now(); setIdleMs(0) }
    window.addEventListener('pointerdown', touched)
    window.addEventListener('keydown', touched)
    const timer = window.setInterval(() => setIdleMs(Date.now() - lastInteraction.current), 1000)
    return () => { window.clearInterval(timer); window.removeEventListener('pointerdown', touched); window.removeEventListener('keydown', touched) }
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    // 菜单打开后焦点进入第一个菜单项；Esc 关闭并把焦点还给桌宠（键盘用户不能被困在菜单里）。
    menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setMenuOpen(false)
      characterRef.current?.focus()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [menuOpen])

  useEffect(() => {
    if (!window.murasame) return
    const applyState = (next: PetState): void => {
      if (!next.visible) cancelVoiceInput()
      setPet(next)
    }
    void window.murasame.pet.getState().then(applyState)
    const unsubscribe = window.murasame.pet.onStateChanged(applyState)
    return unsubscribe
  }, [cancelVoiceInput])

  useEffect(() => {
    if (!window.murasame) return
    let cancelled = false
    const deletedIds = deletedConversationIds.current
    const applyConversation = (next: Conversation | null): void => {
      if (next && deletedIds.has(next.id)) return
      if (conversationRef.current?.id !== next?.id) {
        speechController.current?.abort()
        recordingController.current?.abort()
        recordingRef.current = null
        setRecording(false)
        seenAssistantId.current = [...(next?.messages ?? [])].reverse().find(item => item.role === 'assistant')?.id ?? null
      }
      activeIdRef.current = next?.id ?? null
      conversationRef.current = next
      setConversation(next)
      setStreaming('')
      setPendingUser((pending) => {
        if (!pending || !next) return ''
        const saved = next.messages.some((item) => item.role === 'user' && item.text === pending)
        return saved ? '' : pending
      })
      setProactiveText('')
    }
    const initialVersion = selectionVersion.current
    const initialSettingsVersion = settingsVersion.current
    void window.murasame.core.getBootstrap().then((result) => {
      if (cancelled || !result.ok) return
      if (settingsVersion.current === initialSettingsVersion) {
        setMicrophone(result.data.settings.permissions.microphone)
        setFileApproval(result.data.settings.fileApproval ?? 'ask')
        setSpeakReplies(result.data.settings.speakReplies)
        setDoNotDisturb(result.data.settings.doNotDisturb)
      }
      if (selectionVersion.current !== initialVersion) return
      const id = result.data.activeConversationId ?? result.data.conversations[0]?.id ?? null
      applyConversation(result.data.conversations.find((item) => item.id === id) ?? null)
    })
    const stopUpdated = window.murasame.events.onConversationUpdated((next) => {
      if (deletedIds.has(next.id)) return
      setSendingIds(current => ({ ...current, [next.id]: false }))
      if (activeIdRef.current && activeIdRef.current !== next.id) return
      applyConversation(next)
    })
    const stopActive = window.murasame.events.onActiveConversation(({ id }) => {
      if (deletedIds.has(id)) return
      if (activeIdRef.current === id) return
      speechController.current?.abort()
      recordingController.current?.abort()
      recordingRef.current = null
      setRecording(false)
      activeIdRef.current = id
      const version = ++selectionVersion.current
      setPendingUser(''); setStreaming(''); setDraft('')
      void window.murasame.core.getBootstrap().then((result) => {
        if (cancelled || !result.ok || selectionVersion.current !== version) return
        applyConversation(result.data.conversations.find((item) => item.id === id) ?? null)
      })
    })
    const stopDelta = window.murasame.events.onMessageDelta((payload) => {
      if (deletedIds.has(payload.conversationId)) return
      const currentId = activeIdRef.current
      if (currentId && payload.conversationId !== currentId) return
      setProactiveText('')
      setStreaming((value) => `${value}${payload.delta}`)
    })
    const stopStarted = window.murasame.events.onMessageStarted((payload) => {
      if (deletedIds.has(payload.conversationId)) return
      setSendingIds(current => ({ ...current, [payload.conversationId]: true }))
      const currentId = activeIdRef.current
      if (currentId && payload.conversationId !== currentId) return
      setPendingUser((value) => (value === payload.userText ? value : payload.userText))
      setStreaming('')
    })
    const stopFailed = window.murasame.events.onMessageFailed((payload) => {
      if (deletedIds.has(payload.conversationId)) return
      setSendingIds(current => ({ ...current, [payload.conversationId]: false }))
      const currentId = activeIdRef.current
      if (currentId && payload.conversationId !== currentId) return
      setPendingUser('')
      setStreaming('')
      setNotice(payload.error)
    })
    const stopFocus = window.murasame.pet.onFocusChat(() => {
      void openChatRef.current()
    })
    const stopDeleted = window.murasame.events.onConversationDeleted?.(({ id, activeConversationId }) => {
      deletedIds.add(id)
      setSendingIds(current => { const next = { ...current }; delete next[id]; return next })
      // The displayed history can differ from the target while a switch is loading.
      const target = activeIdRef.current
      if (target && target !== id && conversationRef.current?.id !== id) return
      const nextId = target && target !== id ? target : activeConversationId
      const version = ++selectionVersion.current
      applyConversation(null)
      setPendingUser(''); setDraft(''); setNotice('')
      activeIdRef.current = nextId
      if (!nextId) return
      void window.murasame.core.getBootstrap().then(result => {
        if (cancelled || !result.ok || selectionVersion.current !== version) return
        applyConversation(result.data.conversations.find(item => item.id === nextId) ?? null)
      })
    })
    return () => {
      cancelled = true
      stopUpdated()
      stopActive()
      stopDelta()
      stopStarted()
      stopFailed()
      stopFocus()
      stopDeleted?.()
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

  const dismissTheater = useCallback((): void => {
    if (theaterTimerRef.current) {
      window.clearTimeout(theaterTimerRef.current)
      theaterTimerRef.current = null
    }
    setTheater(null)
  }, [])

  useEffect(() => {
    if (!window.murasame) return
    return window.murasame.pet.onTheater((scene) => {
      setTheater(scene)
      if (theaterTimerRef.current) window.clearTimeout(theaterTimerRef.current)
      theaterTimerRef.current = window.setTimeout(() => {
        theaterTimerRef.current = null
        setTheater(null)
      }, 8000)
    })
  }, [])

  useEffect(() => {
    if (!theater) return
    const skipOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') dismissTheater()
    }
    window.addEventListener('keydown', skipOnEscape)
    return () => window.removeEventListener('keydown', skipOnEscape)
  }, [theater, dismissTheater])

  useEffect(() => () => {
    if (theaterTimerRef.current) window.clearTimeout(theaterTimerRef.current)
  }, [])

  useEffect(() => {
    if (!window.murasame) return
    let disposed = false
    const updated = new Map<string, Task>()
    void window.murasame.core.getBootstrap().then((result) => {
      if (!disposed && result.ok) setTasks([
        ...[...updated.values()].reverse(),
        ...result.data.tasks.filter(task => !updated.has(task.id))
      ])
    }).catch(() => undefined)
    const stop = window.murasame.events.onTaskUpdated((task) => {
      if (disposed) return
      updated.delete(task.id)
      updated.set(task.id, task)
      setTasks((current) => [task, ...current.filter((item) => item.id !== task.id)])
      if (task.status === '执行中' || task.status === '规划中' || task.status === '等待批准' || task.status === '待确认' || task.status === '正在停止') {
        setDismissedActivity((current) => {
          if (!current.has(task.id)) return current
          const next = new Set(current)
          next.delete(task.id)
          return next
        })
      }
    })
    return () => { disposed = true; stop() }
  }, [])

  useEffect(() => {
    if (!window.murasame) return
    return window.murasame.settings.onChanged((settings) => {
      settingsVersion.current++
      speakRef.current = settings.speakReplies
      setSpeakReplies(settings.speakReplies)
      setDoNotDisturb(settings.doNotDisturb)
      if (!settings.speakReplies) speechController.current?.abort()
      if (!settings.permissions.microphone) recordingController.current?.abort()
      setMicrophone(settings.permissions.microphone)
      if (!settings.permissions.microphone && recordingRef.current) {
        const active = recordingRef.current; recordingRef.current = null
        void active.stop().catch(() => undefined)
        setRecording(false); setNotice('麦克风授权已撤销，录音已停止。')
      }
      setFileApproval(settings.fileApproval ?? 'ask')
    })
  }, [])

  useEffect(() => {
    const last = [...(conversation?.messages ?? [])].reverse().find(item => item.role === 'assistant')
    if (seenAssistantId.current === undefined) { if (conversation) seenAssistantId.current = last?.id ?? null; return }
    if (!last || last.id === seenAssistantId.current) return
    seenAssistantId.current = last.id
    if (!speakRef.current) return
    speechController.current?.abort()
    const controller = new AbortController()
    speechController.current = controller
    const id = conversation?.id
    const valid = (): boolean => !controller.signal.aborted && speakRef.current && activeIdRef.current === id
    void (async () => {
      setSpeaking(true)
      try {
        const spoken = await window.murasame.voice.speak(petSpeech(last.text))
        if (!valid()) return
        if (!spoken.played || !spoken.samples.length) { setVoiceNote(spoken.message || '这次没有出声，文字还在。'); return }
        setVoiceNote('')
        const frames = mouthEnvelope(spoken.samples, spoken.sampleRate)
        await playSamples(spoken.samples, spoken.sampleRate, seconds => {
          if (valid()) live2dRef.current?.setMouth(frames[Math.min(frames.length - 1, Math.floor(seconds * 30))] ?? 0)
        }, controller.signal)
      } catch (error) { if (valid()) setVoiceNote(error instanceof Error ? error.message : '朗读失败，文字还在。') }
      finally { if (speechController.current === controller) { setSpeaking(false); live2dRef.current?.setMouth(null) } }
    })()
  }, [conversation])

  useEffect(() => {
    const timer = window.setInterval(() => { void window.murasame.pet.getAffect().then(setPad).catch(() => undefined) }, 5000)
    return () => { window.clearInterval(timer); speechController.current?.abort(); recordingController.current?.abort(); void recordingRef.current?.stop() }
  }, [])

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
      const hit = target?.closest('[data-pet-hit]')
      const overHitArea = Boolean(hit && (!hit.classList.contains('pet-character') || live2dRef.current?.hitTest(event.clientX, event.clientY)))
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

  const startFresh = async (): Promise<void> => {
    const version = selectionVersion.current
    const created = await window.murasame.core.createConversation()
    if (!created.ok) {
      if (selectionVersion.current === version) setNotice(created.error)
      return
    }
    if (deletedConversationIds.current.has(created.data.id)
      || (activeIdRef.current !== created.data.id && (activeIdRef.current || selectionVersion.current !== version))) return
    setConversation(created.data)
    setDraft('')
    setNotice('')
    setPendingUser('')
    setStreaming('')
    setProactiveText('')
  }

  const send = async (text: string): Promise<void> => {
    const content = text.trim()
    if (!content || sending) return
    setNotice('')
    const pendingId = conversationRef.current?.id ?? 'new'
    const version = selectionVersion.current
    let sentId = pendingId
    setSendingIds(current => ({ ...current, [pendingId]: true }))
    setDraft('')
    setPendingUser(content)
    setStreaming('')
    setProactiveText('')
    try {
      let id = conversationRef.current?.id
      if (!id) {
        const created = await window.murasame.core.createConversation()
        if (selectionVersion.current !== version) return
        if (!created.ok) {
          setNotice(created.error)
          setDraft(content)
          setPendingUser('')
          return
        }
        id = created.data.id
        if (deletedConversationIds.current.has(id) || (activeIdRef.current && activeIdRef.current !== id)) return
        setConversation(created.data)
      }
      sentId = id
      setSendingIds(current => ({ ...current, [id]: true }))
      const result = await window.murasame.core.sendMessage(id, content)
      if (selectionVersion.current !== version || deletedConversationIds.current.has(id) || (activeIdRef.current && activeIdRef.current !== id)) return
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
      setSendingIds(current => ({ ...current, [pendingId]: false, [sentId]: false }))
    }
  }

  const beginVoice = async (): Promise<void> => {
    if (document.hidden || !pet.visible) { cancelVoiceInput(); return }
    if (recordingRef.current || sending) return
    if (!microphone) {
      setNotice('录音授权被拒绝。文字输入仍然可用，这次没有生成内容。')
      return
    }
    recordingController.current?.abort()
    const controller = new AbortController()
    recordingController.current = controller
    recordingOrigin.current = { id: activeIdRef.current, version: selectionVersion.current }
    const readiness = await window.murasame.voice.readiness()
    if (controller.signal.aborted || recordingController.current !== controller) return
    if (!readiness.stt) {
      setNotice(readiness.detail)
      return
    }
    try {
      const recording = await startRecording(controller.signal)
      if (controller.signal.aborted || recordingController.current !== controller) { await recording.stop(); return }
      recordingRef.current = recording
      setRecording(true)
      setNotice('')
    } catch (error) {
      if (controller.signal.aborted || recordingController.current !== controller) return
      setNotice(error instanceof Error ? error.message : '无法打开麦克风')
    }
  }

  const endVoice = async (): Promise<void> => {
    const current = recordingRef.current
    const controller = recordingController.current
    const origin = recordingOrigin.current
    if (!current) { controller?.abort(); return }
    recordingRef.current = null
    setRecording(false)
    const samples = await current.stop()
    const valid = (): boolean => Boolean(controller && !controller.signal.aborted && recordingController.current === controller && origin && origin.version === selectionVersion.current && origin.id === activeIdRef.current)
    if (!valid()) return
    const result = await window.murasame.voice.transcribe(samples)
    if (!valid()) return
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
      ready: true,
      started: false
    }
  }

  const moveDrag = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (event.movementX === 0 && event.movementY === 0) return
    dragDistanceRef.current = Math.max(
      dragDistanceRef.current,
      Math.hypot(event.screenX - drag.pointerX, event.screenY - drag.pointerY)
    )
    if (!drag.started && dragDistanceRef.current > 4) {
      drag.started = true
      setDragging(true)
      void window.murasame.pet.beginDrag(event.screenX, event.screenY)
    }
    if (!drag.started) return
    void window.murasame.pet.dragMove(event.screenX, event.screenY)
  }

  const endDrag = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const moved = drag.started
    dragRef.current = null
    setDragging(false)
    void window.murasame.pet.endDrag()
    if (moved) {
      live2dRef.current?.playMotion('drag')
    } else if (performance.now() - lastTapAt.current > 700) {
      lastTapAt.current = performance.now()
      live2dRef.current?.playMotion('tap')
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  useEffect(() => {
    if (!window.murasame) return
    return followAutonomyStatus(window.murasame.autonomy, setIsolation)
  }, [])

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = (): void => setReducedMotion(media.matches)
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [])

  useEffect(() => {
    window.localStorage.setItem('murasame-pet-dismissed', JSON.stringify([...dismissedActivity]))
  }, [dismissedActivity])

  const activities = listPetActivities(tasks, dismissedActivity)

  const chooseFileApproval = (mode: 'ask' | 'allow'): void => {
    setFileApproval(mode)
    void window.murasame.settings.update({ fileApproval: mode })
  }

  const decideActivity = async (item: PetActivity, allow: boolean): Promise<void> => {
    if (activityBusy) return
    setActivityBusy(true)
    setNotice('')
    const result = allow
      ? await window.murasame.core.approveTask(item.id, 'once')
      : await window.murasame.core.cancelTask(item.id)
    setActivityBusy(false)
    if (!result.ok) setNotice(result.error)
  }

  const openActivity = (id: string): void => {
    setIsoOpen(true)
    void window.murasame.window.openPath(`/tasks?focus=${encodeURIComponent(id)}`)
  }

  const dismissActivity = (id: string): void => {
    setDismissedActivity((current) => new Set(current).add(id))
  }

  const stopIsolation = async (): Promise<void> => {
    if (isolationStopping) return
    setIsolationStopping(true)
    try {
      const result = await window.murasame.autonomy.stop()
      if (!result.ok) setNotice(result.error)
    } catch (error) { setNotice(error instanceof Error ? error.message : '结束活动失败，请在自主活动页重试。') }
    finally { setIsolationStopping(false) }
  }

  const hidden = !pet.visible
  const idle = idlePresentation({ hidden, blinkMs: idleFromPad(pad, hidden)?.blinkMs ?? 4200 })
  const work = derivePetWork({ tasks, dismissed: dismissedActivity, sending, autonomy: isolation })
  const isolationWork = derivePetWork({ tasks: [], dismissed: dismissedActivity, sending: false, autonomy: isolation })
  const activityMotion = doNotDisturb || speaking || recording ? null : petWorkMotion(work, pet.preset, Boolean(pet.importedModelUrl))
  const working = Boolean(work?.busy)
  const fps = reducedMotion ? 0 : targetFps({ hidden, interacting: dragging || chat.open || sending || working || speaking, idleMs })
  const dimensions = petDimensions(pet.scale, chat.open)
  if (hidden) return <div className="pet-hidden-root" />

  const recent = conversation?.messages.slice(-8) ?? []

  return (
    <div className={`pet-stage${dragging ? ' dragging' : ''}${chat.open ? ` chat-open side-${chat.side}` : ''}`} data-work-phase={work?.phase ?? 'idle'} data-work-source={work?.source ?? 'none'} style={{ '--pet-column-width': `${dimensions.columnWidth}px`, '--pet-height': `${dimensions.height}px`, '--character-width': `${dimensions.characterWidth}px`, '--character-height': `${dimensions.characterHeight}px` } as React.CSSProperties}>
      <div className="pet-column">
        {theater ? (
          <aside className="pet-theater" data-testid="pet-theater" data-pet-hit role="status" aria-live="polite">
            <span className="pet-theater-tag">任务</span>
            <p>{theater.line}</p>
            <div className="pet-theater-foot">
              <span>{theater.status}</span>
              <button type="button" data-testid="pet-theater-skip" onClick={dismissTheater}>跳过</button>
            </div>
          </aside>
        ) : null}
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
          ref={characterRef}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void openChat() }
            // 桌宠没有系统菜单栏：F10 / 菜单键打开右键菜单，保证键盘可用。
            else if (event.key === 'F10' || event.key === 'ContextMenu') { event.preventDefault(); setMenuOpen(true) }
          }}
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
          aria-label="拖动桌宠，单击互动，右键打开菜单，F10 打开菜单"
        >
          <ErrorBoundary compact resetKey={`${preset.id}:${preset.modelUrl}`}>
            {preset.format.startsWith('Mesh') ? (
              <MeshPet
                key={`${preset.id}:${preset.modelUrl}`}
                ref={live2dRef}
                preset={preset}
                paused={hidden}
                fps={fps}
                blinkMs={idle?.blinkMs ?? 4200}
                breath={idleFromPad(pad, hidden)?.breath ?? 0.5}
                activityMotion={activityMotion}
              />
            ) : (
              <Live2DPet
                key={`${preset.id}:${preset.modelUrl}`}
                ref={live2dRef}
                preset={preset}
                paused={hidden}
                fps={fps}
                blinkMs={idle?.blinkMs ?? 4200}
                breath={idleFromPad(pad, hidden)?.breath ?? 0.5}
                activityMotion={activityMotion}
              />
            )}
          </ErrorBoundary>
        </div>
        <div className="pet-controls" data-pet-hit>
          <button type="button" onClick={() => void changeScale(-0.1)} aria-label="缩小桌宠"><Minus size={14} /></button>
          <span>{Math.round(pet.scale * 100)}%</span>
          <button type="button" onClick={() => void changeScale(0.1)} aria-label="放大桌宠"><Plus size={14} /></button>
          <button type="button" onClick={() => void window.murasame.pet.resetPosition()} aria-label="复位桌宠位置"><RotateCcw size={14} /></button>
          <button type="button" onClick={() => void window.murasame.pet.hide()} aria-label="隐藏桌宠"><X size={14} /></button>
        </div>
        {isoUrl && isoOpen ? (
          <div className="pet-iso" data-pet-hit>
            <div className="pet-iso-bar">
              <strong>隔离桌面</strong>
              <button type="button" onClick={() => setIsoOpen(false)}>收起</button>
            </div>
            <iframe title="隔离桌面" src={isolationViewSrc(isoUrl)} />
          </div>
        ) : null}
        {isoUrl && !isoOpen ? (
          <button type="button" className="pet-iso-tab" data-pet-hit onClick={() => setIsoOpen(true)}>看隔离桌面</button>
        ) : null}
        {notice && !chat.open ? <p className="pet-toast" data-pet-hit>{notice}</p> : null}
        {activities.length > 0 || sending || isolationWork ? (
          <div className="pet-activity-stack" data-pet-hit>
            {sending ? (
              <div className="pet-activity is-running">
                <div className="pet-activity-main">
                  <strong>正在想</strong>
                  <span>这句话还在等模型写完，没有替它念出来。</span>
                </div>
              </div>
            ) : null}
            {isolationWork ? (
              <div className={`pet-activity is-${isolationWork.phase === 'failed' ? 'blocked' : isolationWork.phase === 'ready' ? 'ready' : 'running'}`} data-testid="pet-isolation-progress">
                <button type="button" className="pet-activity-main" onClick={() => void window.murasame.window.openPath('/autonomy')}>
                  <strong>{isolationWork.label}</strong>
                  <span>{isolationWork.detail}</span>
                </button>
                <div className="pet-activity-actions">
                  <button type="button" onClick={() => void window.murasame.window.openPath('/autonomy')}>{isolationWork.phase === 'ready' ? '查看或保存' : '查看活动'}</button>
                  {isolation?.canStop ? <button type="button" disabled={isolationStopping || isolation.phase === 'stopping'} onClick={() => void stopIsolation()}>结束活动</button> : null}
                </div>
              </div>
            ) : null}
            {activities.map((activity) => (
              <div key={activity.id} className={`pet-activity is-${activity.kind}`}>
                <button type="button" className="pet-activity-main" onClick={() => openActivity(activity.id)}>
                  <strong>{activity.label}</strong>
                  <span>{activity.detail}</span>
                  {activity.waiting > 1 ? <em>还有 {activity.waiting - 1} 件也在等你</em> : null}
                </button>
                {activity.reviewLabel ? <div className="pet-activity-actions"><button type="button" onClick={() => openActivity(activity.id)}>{activity.reviewLabel}</button><button type="button" disabled={activityBusy} onClick={() => void decideActivity(activity, false)}>先不做</button></div> : activity.canApprove ? (
                  <div className="pet-activity-actions">
                    <button type="button" disabled={activityBusy} onClick={() => void decideActivity(activity, true)}>允许</button>
                    <button type="button" disabled={activityBusy} onClick={() => void decideActivity(activity, false)}>先不做</button>
                  </div>
                ) : activity.kind === 'running' ? null : (
                  <button type="button" className="pet-activity-dismiss" onClick={() => dismissActivity(activity.id)} aria-label="收起这条状态">收起</button>
                )}
              </div>
            ))}
          </div>
        ) : null}
        <div className="pet-brand" data-pet-hit><span />MURASAME</div>
        {menuOpen ? (
          <div className="pet-menu" data-pet-hit role="group" aria-label="桌宠菜单" ref={menuRef}>
            <button type="button" onClick={() => { setMenuOpen(false); void (chat.open ? closeChat() : openChat()) }}>{chat.open ? '收起对话' : '打开对话'}</button>
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
            <span />
            <div className="pet-chat-head-actions">
              <button type="button" onClick={() => void startFresh()} aria-label="新对话"><SquarePen size={14} /></button>
              <button type="button" onClick={() => void closeChat()} aria-label="收起对话"><X size={14} /></button>
            </div>
          </header>
          <div className="pet-chat-log" ref={logRef}>
            {recent.map((message) => (
              <p key={message.id} className={`pet-chat-line ${message.role}`}>{message.text}</p>
            ))}
            {pendingUser ? <p className="pet-chat-line user">{pendingUser}</p> : null}
            {streaming ? <p className="pet-chat-line assistant">{streaming}</p> : null}
            {!recent.length && !pendingUser && !streaming ? <p className="pet-chat-empty">说点什么。</p> : null}
          </div>
          {notice ? <p className="pet-chat-notice">{notice}</p> : null}
          <form
            className="pet-chat-form"
            onSubmit={(event) => {
              event.preventDefault()
              void send(draft)
            }}
          >
            <div className="pet-approval" role="group" aria-label="写图片的权限">
              <button type="button" aria-pressed={fileApproval === 'ask'} onClick={() => chooseFileApproval('ask')}>询问</button>
              <button type="button" aria-pressed={fileApproval === 'allow'} onClick={() => chooseFileApproval('allow')}>写图免问</button>
            </div>
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
                onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); void beginVoice() }}
                onPointerUp={() => void endVoice()}
                onPointerCancel={() => { recordingController.current?.abort(); recordingRef.current = null; setRecording(false) }}
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
