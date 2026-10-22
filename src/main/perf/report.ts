export interface PerfSample {
  scenario: '待机' | '语音交流' | '屏幕理解' | '任务执行' | '自主活动'
  cpuLogical: number
  memoryMb: number
  note: string
}

export function emptyReport(seconds: number): PerfSample[] {
  return [
    { scenario: '待机', cpuLogical: 0, memoryMb: 0, note: `采样 ${seconds} 秒` },
    { scenario: '语音交流', cpuLogical: 0, memoryMb: 0, note: '本地语音路径，不外发录音' },
    { scenario: '屏幕理解', cpuLogical: 0, memoryMb: 0, note: '采集、等待、生成分开计时' },
    { scenario: '任务执行', cpuLogical: 0, memoryMb: 0, note: '同时保留聊天入口' },
    { scenario: '自主活动', cpuLogical: 0, memoryMb: 0, note: 'Docker 不可用时记为未运行' }
  ]
}

export function renderReport(samples: readonly PerfSample[], seconds: number): string {
  const rows = samples.map((sample) => `| ${sample.scenario} | ${sample.cpuLogical.toFixed(3)} | ${sample.memoryMb.toFixed(0)} | ${sample.note} |`).join('\n')
  return [
    '# 性能测量',
    '',
    '设备以 `01-DECISIONS.md` D-10 为准。数值未达目标不阻塞交付，这里只记录实测。',
    '',
    `采样时长：${seconds} 秒。五个场景分开列出，不用单一空闲值代表全部状态。`,
    '',
    '| 场景 | CPU（逻辑核） | 内存 MB | 说明 |',
    '| --- | --- | --- | --- |',
    rows,
    '',
    '目标：待机 CPU ≤ 0.2 逻辑核，内存 ≤ 600 MB。未达到时保持本记录，不改写目标。',
    ''
  ].join('\n')
}
