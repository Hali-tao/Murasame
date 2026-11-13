import { probeChinesePhonemizer, phonemizeChinese } from '../../local/phonemize'
import { missingWhisperFiles, transcribeAudio, type Transcript } from '../../local/stt'
import { missingKokoroFiles, synthesizeChinese, type Spoken } from '../../local/tts'
import { modelsRoot } from '../../local/model-env'
import { SpeechProcessClient, type SpeechChild } from '../../local/speech-process'

export interface VoiceServiceOptions {
  /** 测试可注入假子进程；生产由主进程注入 Electron utilityProcess。 */
  childFactory?: () => SpeechChild
}

export class VoiceService {
  private client: SpeechProcessClient | null = null

  constructor(
    private readonly userDataDir: string,
    private readonly options: VoiceServiceOptions = {}
  ) {}

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

  async speak(text: string, voice = 'zf_xiaoxiao'): Promise<Spoken> {
    // 没有注入子进程工厂时（单测/旧调用）保留单进程路径。
    if (!this.options.childFactory) return synthesizeChinese(this.userDataDir, text, voice)
    const trimmed = text.trim()
    if (!trimmed) return { audio: null, sampleRate: 24_000, played: false, message: '没有可朗读的内容' }
    const missing = missingKokoroFiles(this.userDataDir, voice)
    if (missing.length > 0) {
      return { audio: null, sampleRate: 24_000, played: false, message: `本地语音合成模型缺少 ${missing.join('、')}，已保留文字回复。` }
    }
    let phonemes: string
    try {
      phonemes = await phonemizeChinese(trimmed)
    } catch (error) {
      return { audio: null, sampleRate: 24_000, played: false, message: error instanceof Error ? error.message : '本地语音合成失败，已保留文字回复。' }
    }
    if (!this.client) {
      this.client = new SpeechProcessClient(this.options.childFactory, { timeoutMs: 120_000 })
    }
    return this.client.synthesize({ modelDirectory: modelsRoot(this.userDataDir), phonemes, voice })
  }

  /** 应用退出时结束专用推理进程；之后迟到结果不得重启它。 */
  dispose(): void {
    this.client?.dispose()
    this.client = null
  }
}
