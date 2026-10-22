import { missingWhisperFiles, transcribeAudio, type Transcript } from '../../local/stt'
import { missingKokoroFiles, synthesizeChinese, type Spoken } from '../../local/tts'

export class VoiceService {
  constructor(private readonly userDataDir: string) {}

  readiness(voice = 'zf_xiaoxiao'): { stt: boolean; tts: boolean; detail: string } {
    const stt = missingWhisperFiles(this.userDataDir)
    const tts = missingKokoroFiles(this.userDataDir, voice)
    const parts: string[] = []
    if (stt.length > 0) parts.push(`识别缺少 ${stt.length} 个文件`)
    if (tts.length > 0) parts.push(`合成缺少 ${tts.length} 个文件`)
    return {
      stt: stt.length === 0,
      tts: tts.length === 0,
      detail: parts.length > 0 ? `${parts.join('，')}。本地模型不全时不会改用其他来源。` : '本地语音模型就绪'
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
