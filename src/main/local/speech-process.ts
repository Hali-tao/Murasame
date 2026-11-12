import type { Spoken } from './tts'

/**
 * 本地语音合成的独立进程客户端（对应 docs/superpowers/specs/2026-10-30-speech-responsiveness-design.md）。
 *
 * 约定：模型加载、分词、音色读取和 ONNX 推理都在独立进程里完成；主进程只负责
 * 串行调度、超时、容量和进程生命周期。请求必须带完整模型目录与音素，进程端
 * 不得自行下载模型。结果按请求编号匹配，旧进程与旧编号的结果一律忽略。
 *
 * 这里的 `SpeechChild` 只描述用到的部分，测试或生产可以注入 Electron utilityProcess。
 */

export const SPEECH_SAMPLE_RATE = 24_000

export interface SpeechRequest {
  modelDirectory: string
  phonemes: string
  voice: string
}

export interface SpeechChild {
  postMessage(message: unknown): void
  kill(): boolean
  on(event: string, listener: (...args: unknown[]) => void): unknown
  off?(event: string, listener: (...args: unknown[]) => void): unknown
}

export interface SpeechProcessOptions {
  /** 单个请求（含排队）的最长等待时间；默认 60 秒。 */
  timeoutMs?: number
  /** 最多接受的在途 + 排队请求数；默认 4，超出直接回退文字。 */
  maxPending?: number
}

interface AcceptedRequest {
  id: number
  request: SpeechRequest
  resolve: (value: Spoken) => void
  timer: ReturnType<typeof setTimeout>
}

const failure = (message: string): Spoken => ({
  audio: null,
  sampleRate: SPEECH_SAMPLE_RATE,
  played: false,
  message
})

const CLOSED_MESSAGE = '本地语音进程已关闭，已保留文字回复。'
const EXITED_MESSAGE = '本地语音进程已退出，已保留文字回复。'
const TIMEOUT_MESSAGE = '本地语音合成超时，已保留文字回复。'
const MALFORMED_MESSAGE = '本地语音进程返回了无法识别的结果，已保留文字回复。'
const SEND_FAILED_MESSAGE = '本地语音进程通信失败，已保留文字回复。'

function isSpoken(value: unknown): value is Spoken {
  if (!value || typeof value !== 'object') return false
  const result = value as Partial<Spoken>
  if (typeof result.played !== 'boolean') return false
  if (result.played === false) return true
  return result.audio instanceof Float32Array && result.audio.length > 0 && Number(result.sampleRate) > 0
}

function normaliseSpoken(value: Spoken): Spoken {
  if (value.played) {
    return {
      audio: value.audio,
      sampleRate: Number(value.sampleRate) > 0 ? Number(value.sampleRate) : SPEECH_SAMPLE_RATE,
      played: true,
      message: typeof value.message === 'string' && value.message.trim() ? value.message : '本地合成完成'
    }
  }
  return {
    audio: null,
    sampleRate: SPEECH_SAMPLE_RATE,
    played: false,
    message: typeof value.message === 'string' && value.message.trim() ? value.message : '本地语音合成失败，已保留文字回复。'
  }
}

export class SpeechProcessClient {
  private child: SpeechChild | null = null
  private generation = 0
  private nextId = 1
  private current: AcceptedRequest | null = null
  private queue: AcceptedRequest[] = []
  private closed = false
  private readonly timeoutMs: number
  private readonly maxPending: number

  constructor(
    private readonly factory: () => SpeechChild,
    options: SpeechProcessOptions = {}
  ) {
    this.timeoutMs = options.timeoutMs ?? 60_000
    this.maxPending = options.maxPending ?? 4
  }

  synthesize(request: SpeechRequest): Promise<Spoken> {
    if (this.closed) return Promise.resolve(failure(CLOSED_MESSAGE))
    const accepted = (this.current ? 1 : 0) + this.queue.length
    if (accepted >= this.maxPending) return Promise.resolve(failure('本地语音进程繁忙，已保留文字回复。'))
    return new Promise<Spoken>((resolve) => {
      const entry: AcceptedRequest = {
        id: this.nextId,
        request,
        resolve,
        timer: setTimeout(() => this.onTimeout(entry), this.timeoutMs)
      }
      this.nextId += 1
      if (this.current) {
        this.queue.push(entry)
        return
      }
      this.current = entry
      this.ensureChild(entry)
    })
  }

  dispose(): void {
    if (this.closed) return
    this.closed = true
    this.failOutstanding(CLOSED_MESSAGE)
    this.disposeChild()
  }

  private ensureChild(entry: AcceptedRequest): void {
    if (this.child) {
      this.send(entry)
      return
    }
    let child: SpeechChild
    try {
      child = this.factory()
    } catch (error) {
      this.settle(entry, failure(`本地语音进程启动失败：${error instanceof Error ? error.message : '未知错误'}。已保留文字回复。`))
      return
    }
    this.child = child
    const generation = ++this.generation
    child.on('message', (...args: unknown[]) => this.onMessage(generation, args[0]))
    child.on('exit', () => {
      if (generation !== this.generation || this.closed) return
      this.failOutstanding(EXITED_MESSAGE)
      this.child = null
    })
    this.send(entry)
  }

  private send(entry: AcceptedRequest): void {
    const child = this.child
    if (!child) return
    try {
      child.postMessage({ id: entry.id, ...entry.request })
    } catch (error) {
      const detail = error instanceof Error ? error.message : '未知错误'
      this.failOutstanding(`${SEND_FAILED_MESSAGE}（${detail}）`)
      this.disposeChild()
    }
  }

  private onMessage(generation: number, payload: unknown): void {
    if (generation !== this.generation || this.closed) return
    if (!payload || typeof payload !== 'object') return
    const message = payload as { id?: unknown; result?: unknown }
    if (typeof message.id !== 'number' || !this.current || message.id !== this.current.id) return
    const entry = this.current
    if (!isSpoken(message.result)) {
      this.settle(entry, failure(MALFORMED_MESSAGE))
      this.failOutstanding(MALFORMED_MESSAGE)
      this.disposeChild()
      return
    }
    this.settle(entry, normaliseSpoken(message.result))
    this.pump()
  }

  private pump(): void {
    if (this.closed) return
    const next = this.queue.shift()
    if (!next) return
    this.current = next
    this.send(next)
  }

  private onTimeout(entry: AcceptedRequest): void {
    if (this.closed) return
    if (this.current === entry) {
      this.settle(entry, failure(TIMEOUT_MESSAGE))
      this.failOutstanding('等待本地语音合成超时，已保留文字回复。')
      this.disposeChild()
      return
    }
    const index = this.queue.indexOf(entry)
    if (index < 0) return
    this.queue.splice(index, 1)
    clearTimeout(entry.timer)
    entry.resolve(failure('等待本地语音合成超时，已保留文字回复。'))
  }

  private settle(entry: AcceptedRequest, value: Spoken): void {
    clearTimeout(entry.timer)
    if (this.current === entry) this.current = null
    entry.resolve(value)
  }

  private failOutstanding(message: string): void {
    const current = this.current
    this.current = null
    if (current) {
      clearTimeout(current.timer)
      current.resolve(failure(message))
    }
    const queue = this.queue
    this.queue = []
    for (const entry of queue) {
      clearTimeout(entry.timer)
      entry.resolve(failure(message))
    }
  }

  private disposeChild(): void {
    const child = this.child
    if (!child) return
    this.child = null
    this.generation += 1
    try {
      child.kill()
    } catch {
      // 进程已经退出时忽略；失败状态已经由请求结果表达。
    }
  }
}
