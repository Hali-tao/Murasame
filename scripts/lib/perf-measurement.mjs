const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))
const message = (error) => error instanceof Error ? error.message : String(error)

export function summarizeSamples(samples, logicalCores) {
  if (samples.length < 2 || !(logicalCores > 0)) throw new Error('采样数量或逻辑核数无效')
  const first = samples[0].at
  const duration = (samples.at(-1).at - first) / 1000
  if (!(duration > 0)) throw new Error('采样时长无效')
  const identities = new Set()
  const exited = new Set()
  let previous = new Map(), cpuSeconds = 0, weightedMemory = 0, peak = 0
  for (let index = 0; index < samples.length; index++) {
    const current = new Map()
    let memory = 0
    if (!samples[index].processes.length) throw new Error('未获取到本次应用进程')
    for (const item of samples[index].processes) {
      const cpu = item.cpu?.cumulativeCPUUsage
      const workingSet = item.memory?.workingSetSize
      if (!Number.isFinite(cpu) || cpu < 0) throw new Error('缺少有效累计 CPU 时间，不能按零报告')
      if (!Number.isFinite(workingSet) || workingSet < 0) throw new Error('缺少有效工作集数据')
      if (!Number.isFinite(item.creationTime) || !Number.isInteger(item.pid)) throw new Error('进程身份无效')
      const key = `${item.pid}:${item.creationTime}`
      if (current.has(key)) throw new Error('重复的进程身份')
      identities.add(key)
      current.set(key, cpu)
      memory += workingSet / 1024
      if (index) {
        if (previous.has(key)) {
          const delta = cpu - previous.get(key)
          if (delta < 0) throw new Error('累计 CPU 时间倒退')
          cpuSeconds += delta
        } else if (item.creationTime >= first) cpuSeconds += cpu
      }
    }
    for (const key of previous.keys()) if (!current.has(key)) exited.add(key)
    peak = Math.max(peak, memory)
    if (index) {
      const interval = (samples[index].at - samples[index - 1].at) / 1000
      if (!(interval > 0)) throw new Error('采样时间必须递增')
      weightedMemory += memory * interval
    }
    previous = current
  }
  return {
    elapsedSeconds: duration,
    cpuLogical: cpuSeconds / duration,
    cpuPercentOfMachine: cpuSeconds / duration / logicalCores * 100,
    meanWorkingSetMiB: weightedMemory / duration,
    peakWorkingSetMiB: peak,
    processInstances: identities.size,
    exitedProcessInstances: exited.size,
    cpuCaveat: '累计时间差；采样间退出进程的最后一段和整个生存期都落在两次采样之间的短进程可能遗漏，因此为已观察 CPU 下界。',
    memoryCaveat: '本次 Electron 应用各进程工作集相加，含共享页，不是独占物理内存；不含 Docker/宿主服务。',
    gpuPercent: null
  }
}

export function bounded(promise, milliseconds) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('性能场景超时，未记为完成')), Math.max(1, milliseconds))
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

export async function measureScenario({ name, prerequisite, durationMs = 60_000, timeoutMs = 180_000,
  intervalMs = 1000, logicalCores = 1, sample, drive, cancel = async () => {} }) {
  const row = { scenario: name, status: 'blocked', metrics: null, samples: [], evidence: null }
  if (prerequisite) return { ...row, error: prerequisite }
  if (!(durationMs > 0) || !(intervalMs > 0) || timeoutMs < durationMs) throw new Error('采样时间参数无效')
  const started = Date.now()
  const controller = new AbortController()
  let result, failure, finished = false
  try {
    const capture = async () => {
      const processes = await bounded(sample(), timeoutMs - (Date.now() - started))
      row.samples.push({ at: Date.now(), processes })
    }
    await capture()
    const observationStarted = row.samples[0].at
    // Observe failures immediately, including rejected promises, without leaving
    // an unhandled rejection while collecting process samples.
    void Promise.resolve().then(() => drive(controller.signal)).then(value => { result = value; finished = true }, error => { failure = error; finished = true })
    while (!finished || Date.now() - observationStarted < durationMs) {
      if (finished && (failure || !result?.ok || !result?.evidence || Object.keys(result.evidence).length === 0)) break
      if (Date.now() - started >= timeoutMs) throw new Error('性能场景超时，未记为完成')
      await wait(Math.min(intervalMs, Math.max(1, timeoutMs - (Date.now() - started))))
      await capture()
    }
    if (failure) throw failure
    if (!result?.ok) throw new Error(result?.error ?? '没有取得成功执行结果')
    if (!result.evidence || Object.keys(result.evidence).length === 0) throw new Error('缺少实际工作完成证据')
    row.evidence = result.evidence
    row.metrics = summarizeSamples(row.samples, logicalCores)
    row.status = 'measured'
  } catch (error) {
    controller.abort(error)
    row.status = 'failed'
    row.error = message(error)
    try { await bounded(Promise.resolve().then(cancel), 5000) }
    catch (cleanupError) { row.cleanupError = message(cleanupError) }
  }
  return row
}
