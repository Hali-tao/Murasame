/**
 * 本地语音合成专用 utilityProcess 入口。
 * 模型加载、分词、ONNX 推理都在这里完成；主进程只负责音素转换、调度与 IPC。
 * 协议：{ id, modelDirectory, phonemes, voice } -> { id, result: Spoken }
 */
import { SAMPLE_RATE, synthesizePhonemes, type Spoken } from './tts'

interface ParentPort {
  on(event: 'message', listener: (event: { data?: unknown }) => void): void
  postMessage(message: unknown): void
}

const parentPort = (process as unknown as { parentPort?: ParentPort }).parentPort

const failure = (message: string): Spoken => ({ audio: null, sampleRate: SAMPLE_RATE, played: false, message })

async function handle(raw: unknown): Promise<void> {
  if (!parentPort || !raw || typeof raw !== 'object') return
  const message = raw as { id?: unknown; modelDirectory?: unknown; phonemes?: unknown; voice?: unknown }
  if (typeof message.id !== 'number') return
  let result: Spoken
  try {
    result = await synthesizePhonemes(
      typeof message.modelDirectory === 'string' ? message.modelDirectory : '',
      typeof message.phonemes === 'string' ? message.phonemes : '',
      typeof message.voice === 'string' && message.voice ? message.voice : 'zf_xiaoxiao'
    )
  } catch (error) {
    result = failure(error instanceof Error ? error.message : '本地语音合成失败，已保留文字回复。')
  }
  parentPort.postMessage({ id: message.id, result })
}

if (parentPort) {
  parentPort.on('message', event => { void handle(event.data) })
}
