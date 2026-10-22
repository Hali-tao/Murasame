import { env, StyleTextToSpeech2Model, AutoTokenizer, Tensor, RawAudio } from '@huggingface/transformers'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(process.env.APPDATA ?? '', 'murasame-desktop', 'models')
env.allowRemoteModels = false
env.localModelPath = root

function phonemize(text) {
  const code = 'import sys,io\n' +
    'sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")\n' +
    'from misaki import zh\n' +
    'g = zh.ZHG2P()\n' +
    'ps, _ = g(sys.argv[1])\n' +
    'sys.stdout.write(ps)\n'
  return execFileSync('python', ['-c', code, text], {
    encoding: 'utf8',
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    stdio: ['ignore', 'pipe', 'ignore']
  }).trim()
}

const text = '今天的任务已经完成了。'
const phonemes = phonemize(text)
console.log('音素：', phonemes)

const tokenizer = await AutoTokenizer.from_pretrained('kokoro')
const model = await StyleTextToSpeech2Model.from_pretrained('kokoro', { dtype: 'q8', device: 'cpu' })

const { input_ids } = tokenizer(phonemes, { truncation: true })
const tokenCount = input_ids.dims.at(-1) - 2
const voiceBuffer = readFileSync(join(root, 'kokoro', 'voices', 'zf_xiaoxiao.bin'))
const offset = tokenCount * 256
const slice = new Float32Array(voiceBuffer.buffer, voiceBuffer.byteOffset + offset * 4, 256)

const output = await model({
  input_ids,
  style: new Tensor('float32', Float32Array.from(slice), [1, 256]),
  speed: new Tensor('float32', [1.0], [1])
})

const audio = new RawAudio(output.waveform.data, 24000)
await audio.save(join(process.cwd(), 'tmp-zh.wav'))
console.log(`已写出 tmp-zh.wav，时长约 ${(output.waveform.data.length / 24000).toFixed(2)} 秒`)
console.log('PASS 本地中文语音合成可用')
