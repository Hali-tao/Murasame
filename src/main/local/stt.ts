import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { configureLocalModels, modelsRoot } from './model-env'

export const WHISPER_DIR = 'whisper'
export const WHISPER_FILES = [
  'config.json',
  'generation_config.json',
  'preprocessor_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  join('onnx', 'encoder_model_quantized.onnx'),
  join('onnx', 'decoder_model_merged_quantized.onnx')
]

export function missingWhisperFiles(userDataDir: string): string[] {
  const base = join(modelsRoot(userDataDir), WHISPER_DIR)
  return WHISPER_FILES.filter((file) => !existsSync(join(base, file)))
}

type Recognizer = (audio: Float32Array, options: { language: string; task: string }) => Promise<{ text?: string }>

let recognizer: Recognizer | null = null

async function load(userDataDir: string): Promise<Recognizer> {
  if (recognizer) return recognizer
  await configureLocalModels(userDataDir)
  const { pipeline } = await import('@huggingface/transformers')
  const asr = await pipeline('automatic-speech-recognition', WHISPER_DIR, {
    dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' },
    device: 'cpu'
  })
  recognizer = asr as unknown as Recognizer
  return recognizer
}

export interface Transcript {
  text: string
  accepted: boolean
  message: string
}

/** 16 kHz 单声道 Float32 PCM，由渲染进程录制后传入。 */
export async function transcribeAudio(userDataDir: string, audio: Float32Array): Promise<Transcript> {
  const missing = missingWhisperFiles(userDataDir)
  if (missing.length > 0) {
    return { text: '', accepted: false, message: `本地语音识别模型缺少 ${missing.length} 个文件，没有进行识别。` }
  }
  if (audio.length < 16_000 / 2) {
    return { text: '', accepted: false, message: '录音太短，没有把空结果当成你说过的话。' }
  }
  try {
    const asr = await load(userDataDir)
    const result = await asr(audio, { language: 'chinese', task: 'transcribe' })
    const text = (result.text ?? '').trim()
    if (!text) return { text: '', accepted: false, message: '这次没有听清，没有生成内容。' }
    return { text, accepted: true, message: '本地识别完成' }
  } catch (error) {
    return { text: '', accepted: false, message: error instanceof Error ? error.message : '本地识别失败' }
  }
}
