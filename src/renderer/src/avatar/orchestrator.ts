export type PerformanceLayer = 'lip' | 'emotion' | 'tap' | 'idle'

const rank: Record<PerformanceLayer, number> = { lip: 4, emotion: 3, tap: 2, idle: 1 }

export function chooseLayer(active: PerformanceLayer, incoming: PerformanceLayer): PerformanceLayer {
  return rank[incoming] >= rank[active] ? incoming : active
}

export function blend(previous: number, next: number, steps = 4): number[] {
  const values: number[] = []
  for (let index = 1; index <= steps; index += 1) values.push(previous + ((next - previous) * index) / steps)
  return values
}

export function mouthFromEnvelope(samples: readonly number[]): number[] {
  const peak = Math.max(...samples, 0.001)
  return samples.map((sample) => Math.min(1, sample / peak))
}

/** 把波形收成大约每秒 30 帧的嘴型开合，0 是闭上，1 是张开。 */
export function mouthEnvelope(samples: readonly number[], sampleRate: number, hz = 30): number[] {
  const hop = Math.max(1, Math.round(sampleRate / hz))
  const peaks: number[] = []
  for (let index = 0; index < samples.length; index += hop) {
    let peak = 0
    const end = Math.min(samples.length, index + hop)
    for (let cursor = index; cursor < end; cursor += 1) peak = Math.max(peak, Math.abs(samples[cursor]))
    peaks.push(peak)
  }
  return mouthFromEnvelope(peaks)
}

export function idlePresentation(input: { hidden: boolean; blinkMs: number }): { blinkMs: number } | null {
  if (input.hidden) return null
  return { blinkMs: input.blinkMs }
}
