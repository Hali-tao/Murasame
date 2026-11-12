import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { ALPHA_MODES, Application, Graphics, SCALE_MODES, SimpleMesh, Texture, UPDATE_PRIORITY } from 'pixi.js'
import type { PetMotionAction, PetPreset } from '@shared/pet-presets'
import { alphaHit } from '@shared/pet-geometry'
import {
  applyMeshMatrix,
  applyMeshPose,
  buildMesh,
  MESH_FACE,
  MESH_SOURCE,
  meshBoneMatrices,
  meshBlinkAt,
  meshFit,
  meshMouthShape,
  meshPoseAt,
  meshToDisplay,
  type MeshFit,
  type MeshMatrices,
  type MeshPetState,
  type MeshWeightId
} from '@shared/avatar/mesh-pose'
import type { PetActivityMotion } from '@shared/pet-work'
import type { Live2DPetHandle } from './Live2DPet'

interface MeshPetProps {
  preset: PetPreset
  className?: string
  paused?: boolean
  fps?: number
  blinkMs?: number
  breath?: number
  activityMotion?: PetActivityMotion | null
  onReady?: () => void
}

const STATE_BY_GROUP: Record<string, MeshPetState> = {
  Idle: 'idle',
  Greet: 'greet',
  Think: 'think',
  Agree: 'agree',
  Confused: 'confused',
  Working: 'working',
  WorkingLoop: 'working',
  Settle: 'settle'
}

const STATE_BY_ACTION: Record<PetMotionAction, MeshPetState> = {
  tap: 'greet',
  drag: 'settle',
  dragUp: 'greet',
  dragDown: 'settle'
}

// 一次性反应播完后回到当前活动状态（没有活动就回待机），否则会一直保持斜着/笑着。
const TRANSIENT_SECONDS: Partial<Record<MeshPetState, number>> = {
  greet: 1.4,
  settle: 1.1,
  agree: 1.8,
  confused: 1.8
}

// pixi 6 的 ITypedArray 声明与 TS 6 的 Float32Array 泛型不兼容；
// 这里用显式构造签名收窄一次，避免在调用点散落 any。
const MeshFactory = SimpleMesh as unknown as new (
  texture: Texture,
  vertices: Float32Array,
  uvs: Float32Array,
  indices: Uint16Array
) => SimpleMesh

function writeVertices(mesh: SimpleMesh, values: Float32Array | Float64Array): void {
  const buffer = mesh.geometry.getBuffer('aVertexPosition')
  ;(buffer.data as unknown as Float32Array).set(values)
  buffer.update()
}

/**
 * 官方图连续网格桌宠。
 *
 * 与 Live2DPet 使用同一套 imperative 接口（点击/拖拽/口型/命中测试），
 * 区别是贴图来自项目内的官方渲染图，整身由加权网格变形，没有切割接缝。
 */
export const MeshPet = forwardRef<Live2DPetHandle, MeshPetProps>(function MeshPet(
  { preset, className = '', paused = false, fps = 24, blinkMs = 4200, breath = 0.5, activityMotion = null, onReady },
  ref
) {
  const hostRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<Application | null>(null)
  const meshRef = useRef<SimpleMesh | null>(null)
  const overlayRef = useRef<Graphics | null>(null)
  const shadowRef = useRef<Graphics | null>(null)
  const fitRef = useRef<MeshFit | null>(null)
  const restRef = useRef<Float64Array | null>(null)
  const displayRef = useRef<Float64Array | null>(null)
  const weightsRef = useRef<Array<Record<MeshWeightId, number>> | null>(null)
  const clockRef = useRef(0)
  const stateRef = useRef<{ state: MeshPetState; startedAt: number }>({ state: 'idle', startedAt: 0 })
  const speechRef = useRef({ target: 0, value: 0 })
  const breathRef = useRef(breath)
  const blinkRef = useRef(blinkMs)
  const activityRef = useRef(activityMotion)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useImperativeHandle(ref, () => ({
    hitTest(clientX: number, clientY: number): boolean {
      const app = appRef.current
      const mesh = meshRef.current
      if (!app || !mesh) return false
      const canvas = app.view as HTMLCanvasElement
      const rect = canvas.getBoundingClientRect()
      if (!rect.width || !rect.height || clientX < rect.left || clientY < rect.top || clientX >= rect.right || clientY >= rect.bottom) return false
      if (!('gl' in app.renderer)) return false
      const gl = app.renderer.gl
      const pixel = new Uint8Array(4)
      const x = Math.floor(((clientX - rect.left) / rect.width) * gl.drawingBufferWidth)
      const y = gl.drawingBufferHeight - 1 - Math.floor(((clientY - rect.top) / rect.height) * gl.drawingBufferHeight)
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
      return alphaHit(pixel, 1, 1, 0, 0)
    },
    playMotion(action: PetMotionAction): void {
      setState(STATE_BY_ACTION[action] ?? 'idle')
    },
    playNamedMotion(group: string, _expression: string | null): void {
      setState(STATE_BY_GROUP[group] ?? 'idle')
      if (hostRef.current) hostRef.current.dataset.motionGroup = group
    },
    setMouth(open: number | null): void {
      speechRef.current.target = typeof open === 'number' && Number.isFinite(open) ? Math.max(0, Math.min(1, open)) : 0
    }
  }), [])

  useEffect(() => {
    activityRef.current = activityMotion
    const requested = activityMotion?.motion ?? 'Idle'
    setState(STATE_BY_GROUP[requested] ?? 'idle')
  }, [activityMotion])

  useEffect(() => {
    breathRef.current = breath
  }, [breath])

  useEffect(() => {
    blinkRef.current = blinkMs
  }, [blinkMs])

  function setState(state: MeshPetState): void {
    const current = stateRef.current
    if (current.state === state) return
    stateRef.current = { state, startedAt: clockRef.current }
    if (hostRef.current) {
      hostRef.current.dataset.motionGroup = state === 'idle' ? 'Idle' : state.charAt(0).toUpperCase() + state.slice(1)
    }
  }

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const canvas = document.createElement('canvas')
    canvas.className = 'live2d-canvas'
    canvas.dataset.testid = 'live2d-canvas'
    host.prepend(canvas)

    let disposed = false
    let app: Application | null = null
    let mesh: SimpleMesh | null = null
    let overlay: Graphics | null = null
    let shadow: Graphics | null = null
    let texture: Texture | null = null
    setReady(false)
    setError(null)

    const viewSize = (): { width: number; height: number } => {
      const width = Math.max(1, Math.round(host.clientWidth || 326))
      const height = Math.max(1, Math.round(host.clientHeight || 440))
      return { width, height }
    }

    try {
      const size = viewSize()
      app = new Application({
        view: canvas,
        width: size.width,
        height: size.height,
        backgroundAlpha: 0,
        antialias: true,
        preserveDrawingBuffer: true,
        autoDensity: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2)
      })
      appRef.current = app
    } catch (cause) {
      console.error('[MeshPet] WebGL 初始化失败', cause)
      setError(cause instanceof Error ? cause.message : 'WebGL 初始化失败')
      canvas.remove()
      return
    }

    const rebuildGeometry = (): void => {
      if (!app || !mesh || !texture) return
      const size = viewSize()
      const fit = meshFit(size.width, size.height)
      fitRef.current = fit
      const uvScale = texture.width / MESH_SOURCE.width
      const built = buildMesh(fit, uvScale)
      restRef.current = built.rest
      displayRef.current = new Float64Array(built.rest.length)
      weightsRef.current = built.weights
      writeVertices(mesh, new Float32Array(built.rest))
      applyCurrentPose()
      app.renderer.render(app.stage)
    }

    const drawShadow = (matrices: MeshMatrices): void => {
      if (!shadow || !fitRef.current) return
      const fit = fitRef.current
      const [fx, fy] = applyMeshMatrix(matrices.hips, ...meshToDisplay(fit, 278, 473))
      const rx = 96 * fit.scale
      const ry = 13 * fit.scale
      shadow.clear()
      shadow.beginFill(0x6b4e12, 0.16).drawEllipse(fx, fy, rx, ry).endFill()
      shadow.beginFill(0x4a350c, 0.12).drawEllipse(fx, fy, rx * 0.62, ry * 0.62).endFill()
    }

    const drawOverlays = (matrices: MeshMatrices, time: number): void => {
      if (!overlay || !fitRef.current) return
      const fit = fitRef.current
      overlay.clear()
      const blink = meshBlinkAt(time, blinkRef.current / 1000)
      if (hostRef.current) {
        // 只记录眨眼开/关两态，便于端到端验收；平时不写 DOM。
        const flag = blink > 0.01 ? '1' : '0'
        if (hostRef.current.dataset.blink !== flag) hostRef.current.dataset.blink = flag
      }
      if (blink > 0.01) {
        for (const eye of [
          { center: MESH_FACE.eyeL, radius: MESH_FACE.eyeRadiusL },
          { center: MESH_FACE.eyeR, radius: MESH_FACE.eyeRadiusR }
        ]) {
          const [cx, cy] = applyMeshMatrix(matrices.head, ...meshToDisplay(fit, eye.center[0], eye.center[1]))
          const rx = eye.radius[0] * fit.scale
          const ry = eye.radius[1] * fit.scale
          const lidH = 2 * ry * blink
          overlay.beginFill(0xffcf48).drawEllipse(cx, cy - ry + lidH / 2, rx, lidH / 2).endFill()
          const lashY = cy - ry + lidH * 0.92
          overlay.lineStyle(Math.max(1, 1.5 * fit.scale), 0x8a4b12, 0.8)
          overlay.moveTo(cx - rx * 0.82, lashY - ry * 0.1)
          overlay.quadraticCurveTo(cx, lashY + ry * 0.16, cx + rx * 0.82, lashY - ry * 0.1)
          overlay.lineStyle(0, 0, 0)
        }
      }
      const speech = speechRef.current.value
      if (speech > 0.02) {
        const [mx, my] = applyMeshMatrix(matrices.head, ...meshToDisplay(fit, MESH_FACE.mouth[0], MESH_FACE.mouth[1]))
        const shape = meshMouthShape(speech, time)
        const rx = shape.rx * fit.scale
        const ry = shape.ry * fit.scale
        const cy = my + shape.offsetY * fit.scale
        overlay.beginFill(0x3b1e12, 0.97).drawEllipse(mx, cy, rx, ry).endFill()
        if (shape.open > 0.3) {
          overlay.beginFill(0xc0455f, 0.92).drawEllipse(mx, cy + ry * 0.5, rx * 0.6, ry * 0.32).endFill()
        }
      }
    }

    const applyCurrentPose = (): void => {
      const fit = fitRef.current
      const rest = restRef.current
      const display = displayRef.current
      const weights = weightsRef.current
      if (!fit || !rest || !display || !weights || !mesh || !app) return
      const time = clockRef.current
      const state = stateRef.current
      const transient = TRANSIENT_SECONDS[state.state]
      if (transient !== undefined && time - state.startedAt > transient) {
        const activity = activityRef.current
        setState(activity ? STATE_BY_GROUP[activity.motion] ?? 'idle' : 'idle')
      }
      const speech = speechRef.current.value
      const pose = meshPoseAt(state.state, time, time - state.startedAt, speech)
      const breathFactor = 0.55 + Math.max(0, Math.min(1, breathRef.current)) * 0.9
      pose.chestScaleX = 1 + (pose.chestScaleX - 1) * breathFactor
      pose.chestScaleY = 1 + (pose.chestScaleY - 1) * breathFactor
      pose.bellyScaleX = 1 + (pose.bellyScaleX - 1) * breathFactor
      pose.bellyScaleY = 1 + (pose.bellyScaleY - 1) * breathFactor
      pose.chestLift *= breathFactor
      const matrices = meshBoneMatrices(pose, fit)
      applyMeshPose(rest, weights, matrices, display)
      writeVertices(mesh, display)
      drawShadow(matrices)
      drawOverlays(matrices, time)
    }

    const load = async (): Promise<void> => {
      if (!app) return
      try {
        const image = new Image()
        image.decoding = 'async'
        image.src = new URL(preset.modelUrl, document.baseURI).href
        await image.decode()
        if (disposed || !app) return
        const base = Texture.from(image)
        base.baseTexture.scaleMode = SCALE_MODES.LINEAR
        base.baseTexture.alphaMode = ALPHA_MODES.PMA
        base.baseTexture.update()
        texture = base

        const size = viewSize()
        const fit = meshFit(size.width, size.height)
        fitRef.current = fit
        const built = buildMesh(fit, texture.width / MESH_SOURCE.width)
        restRef.current = built.rest
        displayRef.current = new Float64Array(built.rest.length)
        weightsRef.current = built.weights
        mesh = new MeshFactory(texture, Float32Array.from(built.rest), built.uvs, built.indices)
        mesh.autoUpdate = true
        shadow = new Graphics()
        overlay = new Graphics()
        app.stage.addChild(shadow, mesh, overlay)
        shadowRef.current = shadow
        meshRef.current = mesh
        overlayRef.current = overlay
        applyCurrentPose()
        app.renderer.render(app.stage)
        stateRef.current = { state: activityRef.current ? STATE_BY_GROUP[activityRef.current.motion] ?? 'idle' : 'idle', startedAt: 0 }
        host.dataset.motionGroup = activityRef.current?.motion ?? 'Idle'

        const ticker = app.ticker
        ticker.add(() => {
          if (disposed) return
          // pixi 6 的 ticker 回调参数是归一化帧数，不是毫秒；毫秒要从 ticker.deltaMS 取。
          const deltaMS = ticker.deltaMS
          clockRef.current += deltaMS / 1000
          const smoothing = Math.min(1, (deltaMS / 1000) * 14)
          const speech = speechRef.current
          speech.value += (speech.target - speech.value) * smoothing
          applyCurrentPose()
        }, undefined, UPDATE_PRIORITY.HIGH)

        app.renderer.render(app.stage)
        if (!disposed) {
          setReady(true)
          console.info(`[MeshPet] 形象就绪: ${preset.id}`)
          onReady?.()
        }
      } catch (cause) {
        console.error('[MeshPet] 贴图加载失败', cause)
        if (!disposed) setError(cause instanceof Error ? cause.message : '形象贴图加载失败')
      }
    }

    const observer = new ResizeObserver(() => {
      if (!app || !mesh) return
      const size = viewSize()
      app.renderer.resize(size.width, size.height)
      rebuildGeometry()
    })
    observer.observe(host)
    void load()

    return () => {
      disposed = true
      observer.disconnect()
      meshRef.current = null
      overlayRef.current = null
      shadowRef.current = null
      restRef.current = null
      displayRef.current = null
      weightsRef.current = null
      fitRef.current = null
      texture?.destroy(true)
      texture = null
      mesh = null
      overlay = null
      shadow = null
      app?.destroy(false, { children: true })
      app = null
      appRef.current = null
      canvas.remove()
    }
  }, [onReady, preset, preset.modelUrl])

  useEffect(() => {
    const ticker = appRef.current?.ticker
    if (!ticker) return
    if (paused || fps <= 0) {
      ticker.stop()
      const app = appRef.current
      if (app) {
        // 暂停时仍要有一帧静止姿态，避免隐藏/恢复后画面空白。
        app.renderer.render(app.stage)
      }
      return
    }
    ticker.minFPS = 0
    ticker.maxFPS = fps
    ticker.minFPS = Math.min(10, fps / 2)
    ticker.start()
  }, [paused, fps, ready])

  return (
    <div
      ref={hostRef}
      className={`live2d-pet-host mesh-pet-host ${className}`.trim()}
      data-live2d-state={error ? 'error' : ready ? 'ready' : 'loading'}
      data-model-id={preset.id}
    >
      {!ready && !error ? <div className="live2d-loading">正在唤醒 {preset.name}…</div> : null}
      {error ? (
        <div className="live2d-fallback" title={error}>
          <strong>!</strong>
          <span>形象加载失败</span>
        </div>
      ) : null}
    </div>
  )
})
