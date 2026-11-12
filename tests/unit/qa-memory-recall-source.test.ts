import { describe, expect, it } from 'vitest'
import { collectRecallSources } from '../../src/main/core/services/conversation-service'

const row = (overrides: Partial<{ conversationId: string; at: string; declared: string; title: string | null }> = {}) => ({
  conversationId: overrides.conversationId ?? 'chat-1',
  at: overrides.at ?? '2026-11-13T01:00:00.000Z',
  declared: overrides.declared ?? JSON.stringify({ intent: 'system-prompt', args: { turnId: 'turn-1', memoryIds: ['mem-1'], memoryRecallStatus: 'complete' } }),
  title: overrides.title === undefined ? '早上聊的菜谱' : overrides.title
})

describe('[QA-MEMRECALL-00] 记忆召回来源（记忆房间来源链）', () => {
  it('[QA-MEMRECALL-01] 每条记忆只保留最近一次被真正召回的来源（按输入顺序即最新在前）', () => {
    const sources = collectRecallSources([
      row({ at: '2026-11-13T03:00:00.000Z', title: '新会话', declared: JSON.stringify({ args: { turnId: 'turn-new', memoryIds: ['mem-1'] } }) }),
      row({ at: '2026-11-13T01:00:00.000Z', title: '旧会话', declared: JSON.stringify({ args: { turnId: 'turn-old', memoryIds: ['mem-1'] } }) })
    ])
    expect(sources).toEqual([
      { memoryId: 'mem-1', conversationId: 'chat-1', conversationTitle: '新会话', turnId: 'turn-new', at: '2026-11-13T03:00:00.000Z' }
    ])
  })

  it('[QA-MEMRECALL-02] 同一轮召回多条记忆时全部记录，并保留各自的 turnId', () => {
    const sources = collectRecallSources([
      row({ declared: JSON.stringify({ args: { turnId: 'turn-9', memoryIds: ['mem-a', 'mem-b'] } }) })
    ])
    expect(sources.map((item) => item.memoryId).sort()).toEqual(['mem-a', 'mem-b'])
    expect(sources.every((item) => item.turnId === 'turn-9')).toBe(true)
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
})
