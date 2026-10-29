import { describe, expect, it } from 'vitest'

// Runtime import also exercises the same Node helper used by the CLI.
const helperPath = '../../scripts/lib/perf-measurement.mjs'
const helper = await import(helperPath)

describe('performance evidence', () => {
  it('does not turn an IPC rejection into a measured workload', async () => {
    const row = await helper.measureScenario({
      name: 'autonomy', durationMs: 20, intervalMs: 5,
      sample: async () => [{ pid: 1, creationTime: 1, cpu: { cumulativeCPUUsage: 2 }, memory: { workingSetSize: 1024 } }],
      drive: async () => ({ ok: false, error: '活动尚未确认' })
    })
    expect(row.status).toBe('failed')
    expect(row.metrics).toBeNull()
    expect(row.error).toContain('活动尚未确认')
  })

  it('requires evidence beyond a successful empty result', async () => {
    const row = await helper.measureScenario({
      name: 'task', durationMs: 20, intervalMs: 5,
      sample: async () => [], drive: async () => ({ ok: true })
    })
    expect(row.status).toBe('failed')
    expect(row.metrics).toBeNull()
  })

  it('keeps missing prerequisites distinct from a successful measurement', async () => {
    const row = await helper.measureScenario({
      name: 'voice', prerequisite: '缺少本地语音模型',
      sample: async () => { throw new Error('should not sample') },
      drive: async () => { throw new Error('should not drive') }
    })
    expect(row.status).toBe('blocked')
    expect(row.metrics).toBeNull()
  })

  it('adds per-process CPU deltas without subtracting exited processes or reusing a PID', () => {
    const process = (pid: number, created: number, cpu: number, memory: number) => ({
      pid, creationTime: created, cpu: { cumulativeCPUUsage: cpu }, memory: { workingSetSize: memory }
    })
    const actual = helper.summarizeSamples([
      { at: 1000, processes: [process(1, 100, 10, 1024), process(2, 100, 50, 2048)] },
      { at: 2000, processes: [process(1, 100, 10.5, 2048), process(3, 1500, 0.1, 1024)] },
      { at: 3000, processes: [process(1, 100, 11, 1024), process(2, 2500, 0.2, 1024)] }
    ], 4)
    expect(actual.cpuLogical).toBeCloseTo(0.65)
    expect(actual.cpuPercentOfMachine).toBeCloseTo(16.25)
    expect(actual.meanWorkingSetMiB).toBeCloseTo(2.5)
    expect(actual.peakWorkingSetMiB).toBe(3)
    expect(actual.processInstances).toBe(4)
    expect(actual.exitedProcessInstances).toBe(2)
  })

  it('does not silently report missing CPU counters as zero', () => {
    expect(() => helper.summarizeSamples([
      { at: 0, processes: [{ pid: 1, creationTime: 0, cpu: {}, memory: { workingSetSize: 1024 } }] },
      { at: 1000, processes: [{ pid: 1, creationTime: 0, cpu: {}, memory: { workingSetSize: 1024 } }] }
    ], 4)).toThrow(/CPU/)
  })

  it('bounds a hung driver and invokes cancellation before returning failure', async () => {
    let canceled = false
    const row = await helper.measureScenario({
      name: 'hung', durationMs: 20, timeoutMs: 40, intervalMs: 5,
      sample: async () => [{ pid: 1, creationTime: 1, cpu: { cumulativeCPUUsage: 2 }, memory: { workingSetSize: 1024 } }],
      drive: () => new Promise(() => {}), cancel: async () => { canceled = true }
    })
    expect(row.status).toBe('failed')
    expect(row.metrics).toBeNull()
    expect(canceled).toBe(true)
  })

  it('counts the observation window from the first completed sample, not from collection setup', async () => {
    let first = true
    const row = await helper.measureScenario({
      name: 'slow first sample', durationMs: 40, timeoutMs: 300, intervalMs: 5,
      sample: async () => {
        if (first) { first = false; await new Promise(resolve => setTimeout(resolve, 60)) }
        return [{ pid: 1, creationTime: 1, cpu: { cumulativeCPUUsage: 2 }, memory: { workingSetSize: 1024 } }]
      },
      drive: async () => ({ ok: true, evidence: { verified: true } })
    })
    expect(row.status).toBe('measured')
    expect(row.metrics.elapsedSeconds).toBeGreaterThanOrEqual(0.04)
  })

  it('aborts a late driver before it can approve further work', async () => {
    let approvals = 0
    const row = await helper.measureScenario({
      name: 'late plan', durationMs: 15, timeoutMs: 30, intervalMs: 5,
      sample: async () => [{ pid: 1, creationTime: 1, cpu: { cumulativeCPUUsage: 2 }, memory: { workingSetSize: 1024 } }],
      drive: async (signal: AbortSignal | undefined) => {
        await new Promise(resolve => setTimeout(resolve, 60))
        if (!signal?.aborted) approvals++
        return { ok: true, evidence: { verified: true } }
      }
    })
    expect(row.status).toBe('failed')
    await new Promise(resolve => setTimeout(resolve, 90))
    expect(approvals).toBe(0)
  })
})
