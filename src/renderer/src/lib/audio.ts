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
export async function startRecording(signal?: AbortSignal): Promise<Recording> {
  signal?.throwIfAborted()
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true } })
  if (signal?.aborted) { stream.getTracks().forEach(track => track.stop()); signal.throwIfAborted() }
  let context: AudioContext
  let source: MediaStreamAudioSourceNode
  let processor: ScriptProcessorNode
  try {
    context = new AudioContext()
    source = context.createMediaStreamSource(stream)
    processor = context.createScriptProcessor(4096, 1, 1)
    source.connect(processor)
    processor.connect(context.destination)
  } catch (error) {
    stream.getTracks().forEach(track => track.stop())
    // A browser may fail after opening the microphone but before its audio graph is ready.
    if (context!) await context.close().catch(() => undefined)
    throw error
  }
  const chunks: Float32Array[] = []

  processor.onaudioprocess = (event) => {
    chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)))
  }

  let stopped = false
  const stop = async (): Promise<number[]> => {
      if (stopped) return []
      stopped = true
      signal?.removeEventListener('abort', abort)
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
  const abort = (): void => { void stop() }
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) { await stop(); signal.throwIfAborted() }
  return { stop }
}

export async function playSamples(samples: number[], sampleRate: number, onTime?: (seconds: number) => void, signal?: AbortSignal): Promise<void> {
  if (samples.length === 0 || signal?.aborted) return
  const context = new AudioContext()
  const buffer = context.createBuffer(1, samples.length, sampleRate)
  buffer.copyToChannel(Float32Array.from(samples), 0)
  const source = context.createBufferSource()
  source.buffer = buffer
  source.connect(context.destination)
  const started = context.currentTime
  let frame = 0
  const tick = (): void => { onTime?.(Math.max(0, context.currentTime - started)); frame = requestAnimationFrame(tick) }
  if (onTime) frame = requestAnimationFrame(tick)
  let stopPlayback: (() => void) | undefined
  try {
    await new Promise<void>(resolve => {
      const abort = (): void => { try { source.stop() } catch { /* already ended */ } finally { resolve() } }
      stopPlayback = abort
      source.onended = () => { signal?.removeEventListener('abort', abort); resolve() }
      signal?.addEventListener('abort', abort, { once: true })
      source.start()
      if (signal?.aborted) abort()
    })
  } finally {
    if (stopPlayback) signal?.removeEventListener('abort', stopPlayback)
    if (frame) cancelAnimationFrame(frame)
    source.disconnect()
    await context.close()
  }
}
