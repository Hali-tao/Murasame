import { Minus, Plus, RotateCcw, X } from 'lucide-react'
import { StrictMode, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { DEFAULT_PET_PRESET, getPetPreset } from '@shared/pet-presets'
import type { PetState } from '@shared/types'
import { Live2DPet, type Live2DPetHandle } from './components/Live2DPet'
import './styles.css'

function PetApp(): React.JSX.Element {
  const [pet, setPet] = useState<PetState>({
    visible: true,
    scale: 0.9,
    x: 0,
    y: 0,
    preset: DEFAULT_PET_PRESET
  })
  const [bubble, setBubble] = useState('村雨在这里。拖我换个位置吧。')
  const [dragging, setDragging] = useState(false)
  const live2dRef = useRef<Live2DPetHandle>(null)
  const ignoringRef = useRef(true)
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
  const preset = getPetPreset(pet.preset)

  useEffect(() => {
    if (!window.murasame) return
    void window.murasame.pet.getState().then(setPet)
    const unsubscribe = window.murasame.pet.onStateChanged(setPet)
    return unsubscribe
  }, [])

  useEffect(() => {
    const handleMove = (event: MouseEvent): void => {
      if (dragRef.current) return
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
      setBubble('要放到哪里？')
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
      live2dRef.current?.playMotion(
        verticalDelta < -18 ? 'dragUp' : verticalDelta > 18 ? 'dragDown' : 'drag'
      )
      setBubble('位置已记住。')
    } else {
      live2dRef.current?.playMotion('tap')
      setBubble('喵？今天也一起把问题拆小一点。')
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const hidden = !pet.visible
  if (hidden) return <div className="pet-hidden-root" />

  return (
    <div className={`pet-stage${dragging ? ' dragging' : ''}`}>
      <div className="pet-bubble" data-pet-hit>{bubble}</div>
      <div
        className="pet-character"
        data-pet-hit
        style={{ transform: `scale(${pet.scale})` }}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => setBubble('今天也一起把问题拆小一点。')}
        role="button"
        tabIndex={0}
        aria-label="拖动村雨，双击互动"
      >
        <Live2DPet key={preset.id} ref={live2dRef} preset={preset} />
      </div>
      <div className="pet-controls" data-pet-hit>
        <button type="button" onClick={() => void changeScale(-0.1)} aria-label="缩小桌宠"><Minus size={14} /></button>
        <span>{Math.round(pet.scale * 100)}%</span>
        <button type="button" onClick={() => void changeScale(0.1)} aria-label="放大桌宠"><Plus size={14} /></button>
        <button type="button" onClick={() => void window.murasame.pet.resetPosition()} aria-label="复位桌宠位置"><RotateCcw size={14} /></button>
        <button type="button" onClick={() => void window.murasame.pet.hide()} aria-label="隐藏桌宠"><X size={14} /></button>
      </div>
      <div className="pet-brand" data-pet-hit><span />MURASAME · LIVE DESKTOP</div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PetApp />
  </StrictMode>
)
