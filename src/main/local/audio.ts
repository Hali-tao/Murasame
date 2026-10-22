export type VoiceRoute = 'local' | 'windows' | 'cloud'

export interface VoiceOutcome {
  text: string
  accepted: boolean
  degraded: boolean
  message: string
}

export function transcribe(input: {
  route: VoiceRoute
  microphoneAllowed: boolean
  devicePresent: boolean
  localModelReady: boolean
  cloudConfirmed: boolean
  recognitionFailed: boolean
  heard: string
}): VoiceOutcome {
  if (!input.devicePresent) {
    return { text: '', accepted: false, degraded: false, message: '没有找到麦克风。可以继续用文字交流。' }
  }
  if (!input.microphoneAllowed) {
    return { text: '', accepted: false, degraded: false, message: '录音授权被拒绝。文字输入仍然可用，这次没有生成回复。' }
  }
  if (input.route === 'cloud' && !input.cloudConfirmed) {
    return { text: '', accepted: false, degraded: false, message: '切换到云端语音前会提示：录音内容将发送至所选模型服务。' }
  }
  if (input.recognitionFailed || !input.heard.trim()) {
    return { text: '', accepted: false, degraded: input.route !== 'local', message: '语音识别失败。没有把失败结果当成你说过的话。' }
  }
  if (input.route === 'local' && input.localModelReady) {
    return { text: input.heard, accepted: true, degraded: false, message: '本地语音识别' }
  }
  if (input.route === 'local' || input.route === 'windows') {
    return { text: input.heard, accepted: true, degraded: true, message: '本地 ONNX 模型不可用，已改用 Windows 语音，当前是降级模式。' }
  }
  return { text: input.heard, accepted: true, degraded: false, message: '录音将发送至所选模型服务。' }
}

export function speak(input: { localReady: boolean; audioDevice: boolean; reply: string }): { played: boolean; degraded: boolean; text: string; message: string } {
  if (!input.audioDevice) {
    return { played: false, degraded: true, text: input.reply, message: '声音不可用，已保留文字回复。' }
  }
  if (!input.localReady) {
    return { played: true, degraded: true, text: input.reply, message: '本地语音合成不可用，已改用系统语音，当前是降级模式。' }
  }
  return { played: true, degraded: false, text: input.reply, message: '本地语音播放' }
}
