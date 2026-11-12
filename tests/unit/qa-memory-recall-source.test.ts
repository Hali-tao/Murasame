import { describe, expect, it } from 'vitest'
import { collectRecallSources } from '../../src/main/core/services/conversation-service'

const row = (overrides: Partial<{ conversationId: string; at: string; declared: string; title: string | null }> = {}) => ({
  conversationId: overrides.conversationId ?? 'chat-1',
  at: overrides.at ?? '2026-11-13T01:00:00.000Z',
  declared: overrides.declared ?? JSON.stringify({ intent: 'system-prompt', args: { turnId: 'turn-1', memoryIds: ['mem-1'], memoryRecallStatus: 'complete' } }),
  title: overrides.title === undefined ? '早上聊的菜谱' : overrides.title
})

const newest = {
  conversationId: 'chat-1',
  conversationTitle: '新会话',
  turnId: 'turn-new',
  at: '2026-11-13T03:00:00.000Z'
}
const older = {
  conversationId: 'chat-1',
  conversationTitle: '旧会话',
  turnId: 'turn-old',
  at: '2026-11-13T01:00:00.000Z'
}

describe('[QA-MEMRECALL-00] 记忆召回来源（记忆房间来源链）', () => {
  it('[QA-MEMRECALL-01] 记录最近一次来源、总次数与最近事件列表（按输入顺序即最新在前）', () => {
    const sources = collectRecallSources([
      row({ at: newest.at, title: '新会话', declared: JSON.stringify({ args: { turnId: 'turn-new', memoryIds: ['mem-1'] } }) }),
      row({ at: older.at, title: '旧会话', declared: JSON.stringify({ args: { turnId: 'turn-old', memoryIds: ['mem-1'] } }) })
    ])
    expect(sources).toEqual([
      { memoryId: 'mem-1', ...newest, count: 2, recent: [newest, older] }
    ])
  })

  it('[QA-MEMRECALL-02] 同一轮召回多条记忆时全部记录，并保留各自的 turnId', () => {
    const sources = collectRecallSources([
      row({ declared: JSON.stringify({ args: { turnId: 'turn-9', memoryIds: ['mem-a', 'mem-b'] } }) })
    ])
    expect(sources.map((item) => item.memoryId).sort()).toEqual(['mem-a', 'mem-b'])
    expect(sources.every((item) => item.turnId === 'turn-9')).toBe(true)
    expect(sources.every((item) => item.count === 1 && item.recent.length === 1)).toBe(true)
  })

  it('[QA-MEMRECALL-03] 损坏的 declared_json / 非数组 memoryIds / 空 id 被跳过，不影响其它记录', () => {
    const sources = collectRecallSources([
      row({ declared: 'not-json', conversationId: 'broken' }),
      row({ declared: JSON.stringify({ args: { turnId: 'turn-x', memoryIds: 'mem-1' } }), conversationId: 'bad-shape' }),
      row({ declared: JSON.stringify({ args: { turnId: 'turn-y', memoryIds: ['', 'mem-ok'] } }), conversationId: 'chat-2' }),
      row({ declared: JSON.stringify({ args: { memoryIds: ['mem-ok'] } }) })
    ])
    expect(sources).toHaveLength(1)
    expect(sources[0]).toMatchObject({ memoryId: 'mem-ok', conversationId: 'chat-2', turnId: 'turn-y' })
  })

  it('[QA-MEMRECALL-04] 对话已被删除时来源标题显示为「已删除的对话」，不伪造会话名', () => {
    const sources = collectRecallSources([row({ title: null })])
    expect(sources[0].conversationTitle).toBe('已删除的对话')
  })

  it('[QA-MEMRECALL-05] 从未真正进入模型上下文的记忆不会出现在来源结果里（空数组）', () => {
    expect(collectRecallSources([])).toEqual([])
    expect(collectRecallSources([row({ declared: JSON.stringify({ args: { turnId: 'turn-1', memoryIds: [] } }) })])).toEqual([])
  })

  it('[QA-MEMRECALL-06] 多次召回：count 统计全部历史，recent 最多保留 5 条且最新在前', () => {
    const rows = Array.from({ length: 9 }, (_, index) => row({
      at: `2026-11-13T0${index + 1}:00:00.000Z`,
      title: `会话 ${index + 1}`,
      declared: JSON.stringify({ args: { turnId: `turn-${index + 1}`, memoryIds: ['mem-hot'] } })
    }))
    const [source] = collectRecallSources(rows)
    expect(source.count).toBe(9)
    expect(source.recent).toHaveLength(5)
    expect(source.recent.map((event) => event.turnId)).toEqual(['turn-1', 'turn-2', 'turn-3', 'turn-4', 'turn-5'])
    // latest 指向输入中最新的那条（第一行）。
    expect(source.turnId).toBe('turn-1')
  })

  it('[QA-MEMRECALL-07] 不同记忆的计数互不影响，且每条都带自己的最近事件', () => {
    const sources = collectRecallSources([
      row({ declared: JSON.stringify({ args: { turnId: 'turn-a', memoryIds: ['mem-a', 'mem-b'] } }) }),
      row({ at: '2026-11-13T02:00:00.000Z', declared: JSON.stringify({ args: { turnId: 'turn-b', memoryIds: ['mem-b'] } }) })
    ])
    const byId = new Map(sources.map((item) => [item.memoryId, item]))
    expect(byId.get('mem-a')?.count).toBe(1)
    expect(byId.get('mem-a')?.recent).toHaveLength(1)
    expect(byId.get('mem-b')?.count).toBe(2)
    expect(byId.get('mem-b')?.recent.map((event) => event.turnId)).toEqual(['turn-a', 'turn-b'])
  })
})
