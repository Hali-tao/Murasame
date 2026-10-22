import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Application, Ticker } from 'pixi.js'
import { ShaderSystem } from '@pixi/core'
import { install as installCspSafeShaders } from '@pixi/unsafe-eval'
import { Live2DModel } from 'pixi-live2d-display/cubism4'
import type { PetMotionAction, PetPreset } from '@shared/pet-presets'

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
  const returnTimer = useRef<number | null>(null)
  const mouthRef = useRef<number | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useImperativeHandle(ref, () => ({
    playMotion(action: PetMotionAction): void {
      const model = modelRef.current
      if (!model) return
      const group = preset.motions[action]
      if (!group) return
      void model.motion(group)
      if (returnTimer.current !== null) window.clearTimeout(returnTimer.current)
      returnTimer.current = window.setTimeout(() => {
        void model.motion(preset.idleMotion, 0)
      }, action === 'tap' ? 4500 : 2600)
    },
    playNamedMotion(group: string, expression: string | null): void {
      const model = modelRef.current
      if (!model) return
      void model.motion(group)
      if (expression) {
        try {
          void model.expression(expression)
        } catch {
          // 形象没有这个表情时只播动作，不中断。
        }
      }
      if (returnTimer.current !== null) window.clearTimeout(returnTimer.current)
      returnTimer.current = window.setTimeout(() => {
        void model.motion(preset.idleMotion, 0)
      }, 3200)
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

    try {
      app = new Application({
        view: canvas,
        resizeTo: canvas.parentElement ?? canvas,
        backgroundAlpha: 0,
        antialias: true,
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
      const naturalWidth = model.width || 640
      const naturalHeight = model.height || 640
      const scale = Math.min((width * 1.06) / naturalWidth, (height * 1.1) / naturalHeight)
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
        modelRef.current = loaded
        app.stage.addChild(loaded)
        fitModel()
        await loaded.motion(preset.idleMotion, 0)
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
      if (returnTimer.current !== null) window.clearTimeout(returnTimer.current)
      returnTimer.current = null
      modelRef.current = null
      appRef.current = null
      model?.destroy({ children: true })
      model = null
      app?.destroy(false)
      app = null
      canvas.remove()
    }
  }, [onReady, preset])

  useEffect(() => {
    const app = appRef.current
    if (!app || !ready) return
    const applyMouth = (): void => {
      const open = mouthRef.current
      if (open === null) return
      const core = modelRef.current?.internalModel?.coreModel as { setParameterValueById?: (id: string, value: number) => void } | undefined
      if (!core?.setParameterValueById) return
      core.setParameterValueById('ParamMouthOpenY', open)
      core.setParameterValueById('PARAM_MOUTH_OPEN_Y', open)
    }
    app.ticker.add(applyMouth)
    return () => {
      // 卸载时主 effect 会先销毁应用，ticker 已经是 null。
      app.ticker?.remove(applyMouth)
    }
  }, [ready])

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
    if (!model || paused) return
    const timer = window.setInterval(() => {
      const core = model.internalModel?.coreModel as { setParameterValueById?: (id: string, value: number) => void } | undefined
      if (!core?.setParameterValueById) return
      core.setParameterValueById('ParamEyeLOpen', 0)
      core.setParameterValueById('ParamEyeROpen', 0)
      const breathValue = 0.3 + Math.sin(Date.now() / 900) * breath
      core.setParameterValueById('ParamBreath', breathValue)
      core.setParameterValueById('PARAM_BREATH', breathValue)
      window.setTimeout(() => {
        core.setParameterValueById?.('ParamEyeLOpen', 1)
        core.setParameterValueById?.('ParamEyeROpen', 1)
      }, 120)
    }, blinkMs)
    return () => window.clearInterval(timer)
  }, [blinkMs, breath, paused, ready])

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
