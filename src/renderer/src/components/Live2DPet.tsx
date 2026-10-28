import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Application, Ticker } from 'pixi.js'
import { ShaderSystem } from '@pixi/core'
import { install as installCspSafeShaders } from '@pixi/unsafe-eval'
import { Live2DModel, MotionPriority, type Cubism4InternalModel } from 'pixi-live2d-display/cubism4'
import type { PetMotionAction, PetPreset } from '@shared/pet-presets'
import { alphaHit } from '@shared/pet-geometry'
import { resolveMotionGroup } from '@shared/avatar/motion-groups'

installCspSafeShaders({ ShaderSystem })
Live2DModel.registerTicker(Ticker)

declare global {
  interface Window {
    Live2DCubismCore?: unknown
  }
}

export interface Live2DPetHandle {
  playMotion(action: PetMotionAction): void
  playNamedMotion(group: string, expression: string | null): void
  setMouth(open: number | null): void
  hitTest(clientX: number, clientY: number): boolean
}

interface Live2DPetProps {
  preset: PetPreset
  className?: string
  paused?: boolean
  fps?: number
  blinkMs?: number
  breath?: number
  onReady?: () => void
}

export const Live2DPet = forwardRef<Live2DPetHandle, Live2DPetProps>(function Live2DPet(
  { preset, className = '', paused = false, fps = 24, blinkMs = 4200, breath = 0.5, onReady },
  ref
) {
  const hostRef = useRef<HTMLDivElement>(null)
  const modelRef = useRef<Live2DModel | null>(null)
  const appRef = useRef<Application | null>(null)
  const mouthRef = useRef<number | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const authoredNailong = preset.id === 'naiwa' && preset.modelUrl === 'live2d/naiwa/奶蛙.model3.json'

  useImperativeHandle(ref, () => ({
    hitTest(clientX: number, clientY: number): boolean {
      const app = appRef.current
      if (!app || !modelRef.current) return false
      const canvas = app.view as HTMLCanvasElement
      const rect = canvas.getBoundingClientRect()
      if (!rect.width || !rect.height || clientX < rect.left || clientY < rect.top || clientX >= rect.right || clientY >= rect.bottom) return false
      if (!('gl' in app.renderer)) return false
      const gl = app.renderer.gl
      const pixel = new Uint8Array(4)
      const x = Math.floor((clientX - rect.left) / rect.width * gl.drawingBufferWidth)
      const y = gl.drawingBufferHeight - 1 - Math.floor((clientY - rect.top) / rect.height * gl.drawingBufferHeight)
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
      return alphaHit(pixel, 1, 1, 0, 0)
    },
    playMotion(action: PetMotionAction): void {
      const model = modelRef.current
      if (!model) return
      const manager = model.internalModel.motionManager
      const group = resolveMotionGroup(preset.motions[action] ?? '', Object.keys(manager.definitions), action === 'tap' ? ['Tap', 'tap_body', manager.groups.idle] : ['Flick', manager.groups.idle])
      if (!group) return
      // Cubism returns to Idle at the actual motion end. A wall-clock timeout cuts
      // authored motion short and also runs while the renderer is paused.
      void model.motion(group, 0, MotionPriority.FORCE).catch(cause => console.warn('[Live2D] Motion unavailable', cause))
    },
    playNamedMotion(group: string, expression: string | null): void {
      const model = modelRef.current
      if (!model) return
      const manager = model.internalModel.motionManager
      const actualGroup = resolveMotionGroup(group, Object.keys(manager.definitions), [manager.groups.idle])
      if (actualGroup) void model.motion(actualGroup, 0, MotionPriority.FORCE).catch(cause => console.warn('[Live2D] Motion unavailable', cause))
      if (expression) {
        try {
          void model.expression(expression).catch(cause => console.warn('[Live2D] Expression unavailable', cause))
        } catch {
          // 形象没有这个表情时只播动作，不中断。
        }
      }
    },
    setMouth(open: number | null): void {
      mouthRef.current = open
    }
  }), [preset])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    if (!window.Live2DCubismCore) {
      console.error('[Live2D] Cubism Core runtime is missing')
      setError('Cubism Core 未加载')
      return
    }

    // Create a fresh canvas per effect run. React StrictMode mounts effects
    // twice in development, and reusing a canvas after its WebGL context has
    // been destroyed leaves PixiJS with an unusable renderer.
    const canvas = document.createElement('canvas')
    canvas.className = 'live2d-canvas'
    canvas.dataset.testid = 'live2d-canvas'
    host.prepend(canvas)

    let disposed = false
    let app: Application | null = null
    let model: Live2DModel | null = null
    setReady(false)
    setError(null)

    try {
      app = new Application({
        view: canvas,
        resizeTo: canvas.parentElement ?? canvas,
        backgroundAlpha: 0,
        antialias: true,
        preserveDrawingBuffer: true,
        autoDensity: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2)
      })
      appRef.current = app
    } catch (cause) {
      console.error('[Live2D] WebGL application initialization failed', cause)
      setError(cause instanceof Error ? cause.message : 'WebGL 初始化失败')
      canvas.remove()
      return
    }

    const fitModel = (): void => {
      if (!app || !model) return
      const width = app.screen.width
      const height = app.screen.height
      const naturalWidth = model.width / (model.scale.x || 1) || 640
      const naturalHeight = model.height / (model.scale.y || 1) || 640
      const scale = Math.min((width * 0.96) / naturalWidth, (height * 0.98) / naturalHeight)
      model.scale.set(scale)
      model.anchor.set(0.5, 1)
      model.position.set(width / 2, height - 2)
    }

    const load = async (): Promise<void> => {
      try {
        const loaded = await Live2DModel.from(new URL(preset.modelUrl, document.baseURI).href, {
          autoInteract: false,
          autoUpdate: true,
          idleMotionGroup: preset.idleMotion
        })
        if (disposed || !app) {
          // Textures are shared through Pixi's resource cache. Destroying them
          // here can invalidate the texture used by the next StrictMode mount.
          loaded.destroy({ children: true })
          return
        }
        model = loaded
        const manager = loaded.internalModel.motionManager
        const idleGroup = resolveMotionGroup(preset.idleMotion, Object.keys(manager.definitions), ['Idle'])
        if (idleGroup) manager.groups.idle = idleGroup
        if (authoredNailong) {
          const internal = loaded.internalModel as Cubism4InternalModel
          // Authored curves own breath/blink. The stock breath also swings the
          // head, which otherwise fights those curves and their physics followers.
          internal.breath?.setParameters([])
          internal.eyeBlink = undefined
          const updateFocus = internal.updateFocus.bind(internal)
          let focusWeight = 0
          internal.updateFocus = () => {
            const group = internal.motionManager.state.currentGroup
            focusWeight += ((group === preset.idleMotion ? 0.12 : 0) - focusWeight) * 0.08
            const { x, y } = internal.focusController
            internal.focusController.x *= focusWeight
            internal.focusController.y *= focusWeight
            updateFocus()
            internal.focusController.x = x
            internal.focusController.y = y
          }
        }
        loaded.internalModel.on('beforeModelUpdate', () => {
          const open = mouthRef.current
          if (open === null) return
          const core = loaded.internalModel.coreModel as Cubism4InternalModel['coreModel']
          core.setParameterValueById('ParamMouthOpenY', open)
          core.setParameterValueById('PARAM_MOUTH_OPEN_Y', open)
        })
        modelRef.current = loaded
        app.stage.addChild(loaded)
        fitModel()
        if (idleGroup) await loaded.motion(idleGroup, 0)
        if (!disposed) {
          setReady(true)
          console.info(`[Live2D] Model ready: ${preset.id}`)
          onReady?.()
        }
      } catch (cause) {
        console.error('[Live2D] Model load failed', cause)
        if (!disposed) {
          setError(cause instanceof Error ? cause.message : 'Live2D 模型加载失败')
        }
      }
    }

    const handlePointerMove = (event: MouseEvent): void => {
      if (!model || !app) return
      const rect = canvas.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      const x = ((event.clientX - rect.left) / rect.width) * app.screen.width
      const y = ((event.clientY - rect.top) / rect.height) * app.screen.height
      model.focus(x, y)
    }

    const observer = new ResizeObserver(() => {
      if (!app) return
      app.renderer.resize(canvas.clientWidth, canvas.clientHeight)
      fitModel()
    })
    observer.observe(canvas)
    window.addEventListener('mousemove', handlePointerMove)
    // Defer the first load so StrictMode's immediate unmount can cancel it
    // before a second model starts loading the same texture resources.
    const loadTimer = window.setTimeout(() => {
      void load()
    }, 0)

    return () => {
      disposed = true
      window.clearTimeout(loadTimer)
      observer.disconnect()
      window.removeEventListener('mousemove', handlePointerMove)
      modelRef.current = null
      appRef.current = null
      model?.destroy({ children: true })
      model = null
      app?.destroy(false)
      app = null
      canvas.remove()
    }
  }, [onReady, preset, authoredNailong])

  useEffect(() => {
    const ticker = appRef.current?.ticker
    if (!ticker) return
    if (paused || fps <= 0) {
      ticker.stop()
      return
    }
    ticker.maxFPS = fps
    ticker.start()
  }, [paused, fps, ready])

  useEffect(() => {
    const model = modelRef.current
    if (!model || paused || authoredNailong) return
    let reopen: number | undefined
    const timer = window.setInterval(() => {
      const core = model.internalModel?.coreModel as { setParameterValueById?: (id: string, value: number) => void } | undefined
      if (!core?.setParameterValueById) return
      core.setParameterValueById('ParamEyeLOpen', 0)
      core.setParameterValueById('ParamEyeROpen', 0)
      const breathValue = 0.3 + Math.sin(Date.now() / 900) * breath
      core.setParameterValueById('ParamBreath', breathValue)
      core.setParameterValueById('PARAM_BREATH', breathValue)
      reopen = window.setTimeout(() => {
        core.setParameterValueById?.('ParamEyeLOpen', 1)
        core.setParameterValueById?.('ParamEyeROpen', 1)
      }, 120)
    }, blinkMs)
    return () => { window.clearInterval(timer); window.clearTimeout(reopen) }
  }, [blinkMs, breath, paused, ready, authoredNailong])

  return (
    <div
      ref={hostRef}
      className={`live2d-pet-host ${className}`.trim()}
      data-live2d-state={error ? 'error' : ready ? 'ready' : 'loading'}
      data-model-id={preset.id}
    >
      {!ready && !error ? <div className="live2d-loading">正在唤醒 {preset.name}…</div> : null}
      {error ? (
        <div className="live2d-fallback" title={error}>
          <strong>!</strong>
          <span>Live2D 形象加载失败</span>
        </div>
      ) : null}
    </div>
  )
})
