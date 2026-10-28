import { probeChinesePhonemizer } from '../../local/phonemize'
import { missingWhisperFiles, transcribeAudio, type Transcript } from '../../local/stt'
import { missingKokoroFiles, synthesizeChinese, type Spoken } from '../../local/tts'

export class VoiceService {
  constructor(private readonly userDataDir: string) {}

  async readiness(voice = 'zf_xiaoxiao'): Promise<{ stt: boolean; tts: boolean; detail: string }> {
    const stt = missingWhisperFiles(this.userDataDir)
    const tts = missingKokoroFiles(this.userDataDir, voice)
    const parts: string[] = []
    if (stt.length > 0) parts.push(`识别缺少 ${stt.length} 个文件`)
    if (tts.length > 0) parts.push(`合成缺少 ${tts.length} 个文件`)
    const phonemes = tts.length === 0 ? await probeChinesePhonemizer() : { ready: false, detail: '' }
    if (phonemes.detail) parts.push(phonemes.detail)
    if (stt.length === 0) parts.push('识别模型文件齐全，麦克风及识别效果尚待录音测试')
    if (tts.length === 0 && phonemes.ready) parts.push('合成依赖已验证，模型运行与扬声器效果尚待试听')
    return {
      stt: stt.length === 0,
      tts: tts.length === 0 && phonemes.ready,
      detail: `${parts.join('；')}。语音始终使用本地环境。`
    }
  }

  transcribe(audio: Float32Array, microphoneAllowed: boolean): Promise<Transcript> {
    if (!microphoneAllowed) {
      return Promise.resolve({ text: '', accepted: false, message: '录音授权被拒绝。文字输入仍然可用，这次没有生成内容。' })
    }
    return transcribeAudio(this.userDataDir, audio)
  }

  speak(text: string, voice = 'zf_xiaoxiao'): Promise<Spoken> {
    return synthesizeChinese(this.userDataDir, text, voice)
  }
}
