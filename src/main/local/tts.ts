import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { configureLocalModelsFromRoot, modelsRoot } from './model-env'
import { phonemizeChinese } from './phonemize'

export const KOKORO_DIR = 'kokoro'
export const SAMPLE_RATE = 24_000
const STYLE_DIM = 256

export const KOKORO_FILES = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  join('onnx', 'model_quantized.onnx')
]

export function missingKokoroFiles(userDataDir: string, voice: string): string[] {
  return missingKokoroFilesInRoot(modelsRoot(userDataDir), voice)
}

export function missingKokoroFilesInRoot(modelRoot: string, voice: string): string[] {
  const base = join(modelRoot, KOKORO_DIR)
  const missing = KOKORO_FILES.filter((file) => !existsSync(join(base, file)))
  if (!existsSync(join(base, 'voices', `${voice}.bin`))) missing.push(`voices/${voice}.bin`)
  return missing
}

export interface Spoken {
  audio: Float32Array | null
  sampleRate: number
  played: boolean
  message: string
}

interface LoadedVoice {
  tokenizer: (text: string, options: { truncation: boolean }) => { input_ids: { dims: number[] } }
  model: (input: Record<string, unknown>) => Promise<{ waveform: { data: Float32Array } }>
}

let loaded: LoadedVoice | null = null
let loadedRoot = ''

async function load(modelRoot: string): Promise<LoadedVoice> {
  if (loaded && loadedRoot === modelRoot) return loaded
  await configureLocalModelsFromRoot(modelRoot)
  const { AutoTokenizer, StyleTextToSpeech2Model } = await import('@huggingface/transformers')
  const tokenizer = await AutoTokenizer.from_pretrained(KOKORO_DIR)
  const model = await StyleTextToSpeech2Model.from_pretrained(KOKORO_DIR, { dtype: 'q8', device: 'cpu' })
  loaded = {
    tokenizer: tokenizer as unknown as LoadedVoice['tokenizer'],
    model: model as unknown as LoadedVoice['model']
  }
  loadedRoot = modelRoot
  return loaded
}

/** 推理（模型加载 + 分词 tensor + ONNX）由 utilityProcess 调用；phonemes 由主进程异步转换后传入。 */
export async function synthesizePhonemes(
  modelRoot: string,
  phonemes: string,
  voice = 'zf_xiaoxiao'
): Promise<Spoken> {
  if (!phonemes.trim()) {
    return { audio: null, sampleRate: SAMPLE_RATE, played: false, message: '没有可朗读的内容' }
  }
  const missing = missingKokoroFilesInRoot(modelRoot, voice)
  if (missing.length > 0) {
    return { audio: null, sampleRate: SAMPLE_RATE, played: false, message: `本地语音合成模型缺少 ${missing.join('、')}，已保留文字回复。` }
  }
  try {
    const { tokenizer, model } = await load(modelRoot)
    const { input_ids } = tokenizer(phonemes, { truncation: true })
    const tokenCount = Number(input_ids.dims.at(-1)) - 2
    const voiceBuffer = readFileSync(join(modelRoot, KOKORO_DIR, 'voices', `${voice}.bin`))
    const offset = voiceBuffer.byteOffset + tokenCount * STYLE_DIM * 4
    if (offset + STYLE_DIM * 4 > voiceBuffer.byteOffset + voiceBuffer.length) {
      return { audio: null, sampleRate: SAMPLE_RATE, played: false, message: '这段文字超出音色数据范围，已保留文字回复。' }
    }
    const style = Float32Array.from(new Float32Array(voiceBuffer.buffer, offset, STYLE_DIM))
    const { Tensor } = await import('@huggingface/transformers')
    const output = await model({
      input_ids,
      style: new Tensor('float32', style, [1, STYLE_DIM]),
      speed: new Tensor('float32', [1.0], [1])
    })
    return { audio: output.waveform.data, sampleRate: SAMPLE_RATE, played: true, message: '本地合成完成' }
  } catch (error) {
    return {
      audio: null,
      sampleRate: SAMPLE_RATE,
      played: false,
      message: error instanceof Error ? error.message : '本地语音合成失败，已保留文字回复。'
    }
  }
}

/** 兼容路径：单进程调用时在这里做音素转换；正常运行时音素在主进程转换后交给专用进程。 */
export async function synthesizeChinese(
  userDataDir: string,
  text: string,
  voice = 'zf_xiaoxiao'
): Promise<Spoken> {
  const trimmed = text.trim()
  if (!trimmed) return { audio: null, sampleRate: SAMPLE_RATE, played: false, message: '没有可朗读的内容' }
  const missing = missingKokoroFiles(userDataDir, voice)
  if (missing.length > 0) {
    return { audio: null, sampleRate: SAMPLE_RATE, played: false, message: `本地语音合成模型缺少 ${missing.join('、')}，已保留文字回复。` }
  }
  try {
    const phonemes = await phonemizeChinese(trimmed)
    return await synthesizePhonemes(modelsRoot(userDataDir), phonemes, voice)
  } catch (error) {
    return {
      audio: null,
      sampleRate: SAMPLE_RATE,
      played: false,
      message: error instanceof Error ? error.message : '本地语音合成失败，已保留文字回复。'
    }
  }
}
