import { env, pipeline } from '@huggingface/transformers'
import { join } from 'node:path'

const root = join(process.env.APPDATA ?? '', 'murasame-desktop', 'models')
env.allowRemoteModels = false
env.localModelPath = root

const started = Date.now()
const asr = await pipeline('automatic-speech-recognition', 'whisper', {
  dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' },
  device: 'cpu'
})
console.log(`模型加载耗时 ${Math.round((Date.now() - started) / 1000)} 秒`)

const sampleRate = 16000
const seconds = 2
const audio = new Float32Array(sampleRate * seconds)
for (let i = 0; i < audio.length; i += 1) {
  audio[i] = Math.sin((2 * Math.PI * 220 * i) / sampleRate) * 0.05
}

const result = await asr(audio, { language: 'chinese', task: 'transcribe' })
console.log('识别返回：', JSON.stringify(result))
console.log('PASS 本地 Whisper 可加载并完成一次推理')
