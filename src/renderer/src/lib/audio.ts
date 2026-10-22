const TARGET_RATE = 16_000

function downsample(input: Float32Array, fromRate: number): Float32Array {
  if (fromRate === TARGET_RATE) return input
  const ratio = fromRate / TARGET_RATE
  const length = Math.floor(input.length / ratio)
  const output = new Float32Array(length)
  for (let index = 0; index < length; index += 1) {
    const start = Math.floor(index * ratio)
    const end = Math.min(input.length, Math.floor((index + 1) * ratio))
    let sum = 0
    for (let cursor = start; cursor < end; cursor += 1) sum += input[cursor]
    output[index] = sum / Math.max(1, end - start)
  }
  return output
}

export interface Recording {
  stop(): Promise<number[]>
}

/** 录音只在本机进行，采样后直接交给主进程的本地模型。 */
export async function startRecording(): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true } })
  const context = new AudioContext()
  const source = context.createMediaStreamSource(stream)
  const processor = context.createScriptProcessor(4096, 1, 1)
  const chunks: Float32Array[] = []

  processor.onaudioprocess = (event) => {
    chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)))
  }
  source.connect(processor)
  processor.connect(context.destination)

  return {
    async stop(): Promise<number[]> {
      processor.disconnect()
      source.disconnect()
      stream.getTracks().forEach((track) => track.stop())
      const rate = context.sampleRate
      await context.close()
      const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
      const merged = new Float32Array(total)
      let offset = 0
      for (const chunk of chunks) {
        merged.set(chunk, offset)
        offset += chunk.length
      }
      return Array.from(downsample(merged, rate))
    }
  }
}

export async function playSamples(samples: number[], sampleRate: number, onTime?: (seconds: number) => void): Promise<void> {
  if (samples.length === 0) return
  const context = new AudioContext()
  const buffer = context.createBuffer(1, samples.length, sampleRate)
  buffer.copyToChannel(Float32Array.from(samples), 0)
  const source = context.createBufferSource()
  source.buffer = buffer
  source.connect(context.destination)
  const started = context.currentTime
  let frame = 0
  const tick = (): void => {
    onTime?.(Math.max(0, context.currentTime - started))
    frame = requestAnimationFrame(tick)
  }
  if (onTime) frame = requestAnimationFrame(tick)
  await new Promise<void>((resolve) => {
    source.onended = () => resolve()
    source.start()
  })
  if (frame) cancelAnimationFrame(frame)
  await context.close()
}
