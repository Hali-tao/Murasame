import { describe, expect, it } from 'vitest'
import { AffectService } from '../../src/main/core/services/affect-service'

const appraisal = { relevance: 0.5, consequence: 0.4, coping: 0.2, norm: 0 }

describe('[FR-EMO-10] 情绪事件记录（F-03 原因链）', () => {
  it('[FR-EMO-11] 带 reason 的情绪变化进入事件列表，最新在前且带 pad 快照', () => {
    const affect = new AffectService(() => 1_700_000_000_000)
    affect.apply(appraisal, { reason: '收到对话回复' })
    affect.apply({ ...appraisal, consequence: -0.5 }, { reason: '任务失败' })
    const events = affect.recentEvents
    expect(events).toHaveLength(2)
    expect(events[0].reason).toBe('任务失败')
    expect(events[1].reason).toBe('收到对话回复')
    expect(events[0].pad).toEqual(expect.objectContaining({ pleasure: expect.any(Number), arousal: expect.any(Number) }))
    expect(events[0].at).toBe(new Date(1_700_000_000_000).toISOString())
  })

  it('[FR-EMO-12] 没有 reason 的底层校准不进入事件列表', () => {
    const affect = new AffectService(() => 1_700_000_000_000)
    affect.apply(appraisal)
    expect(affect.recentEvents).toEqual([])
  })

  it('[FR-EMO-13] 事件最多保留 5 条，超出后丢弃最旧的', () => {
    const affect = new AffectService(() => 1_700_000_000_000)
    for (let index = 0; index < 7; index += 1) affect.apply(appraisal, { reason: `事件 ${index}` })
    const events = affect.recentEvents
    expect(events).toHaveLength(5)
    expect(events.map((event) => event.reason)).toEqual(['事件 6', '事件 5', '事件 4', '事件 3', '事件 2'])
  })

  it('[FR-EMO-14] recentEvents 返回副本，外部修改不会污染内部状态', () => {
    const affect = new AffectService(() => 1_700_000_000_000)
    affect.apply(appraisal, { reason: '任务完成' })
    const snapshot = affect.recentEvents
    snapshot[0].reason = '被篡改'
    snapshot[0].pad.pleasure = 999
    const actual = affect.recentEvents
    expect(actual[0].reason).toBe('任务完成')
    expect(actual[0].pad.pleasure).not.toBe(999)
  })
})
