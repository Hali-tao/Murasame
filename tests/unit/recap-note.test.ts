import { beforeEach, describe, expect, it, vi } from 'vitest'
import { recapNoteSchema } from '../../src/shared/schemas'

const storage = vi.hoisted(() => ({ values: {} as Record<string, unknown>, writes: [] as Array<{ key: string; value: unknown }> }))
vi.mock('electron-store', () => ({
  default: class {
    constructor(options: { defaults: Record<string, unknown> }) {
      storage.values = structuredClone(options.defaults)
    }
    get(key: string) {
      return structuredClone(storage.values[key])
    }
    set(key: string, value: unknown) {
      storage.values[key] = structuredClone(value)
      storage.writes.push({ key, value: structuredClone(value) })
    }
  }
}))

const { readRecapNote, writeRecapNote } = await import('../../src/main/settings')

beforeEach(() => {
  storage.values = {}
  storage.writes = []
})

describe('[FR-RECAP-10] 「留给明天」一句话（本地持久化）', () => {
  it('[FR-RECAP-11] 默认没有内容，写入后按日期读取，旧日期互不影响', () => {
    expect(readRecapNote('2026-11-13')).toBe('')
    writeRecapNote('2026-11-13', '明天先做最重要的一件事。')
    writeRecapNote('2026-11-14', '早点休息。')
    expect(readRecapNote('2026-11-13')).toBe('明天先做最重要的一件事。')
    expect(readRecapNote('2026-11-14')).toBe('早点休息。')
    expect(storage.writes.some((write) => write.key === 'recapNotes')).toBe(true)
  })

  it('[FR-RECAP-12] 同一天再次保存会覆盖旧内容，不会重复堆积', () => {
    writeRecapNote('2026-11-13', '第一版')
    writeRecapNote('2026-11-13', '第二版')
    expect(readRecapNote('2026-11-13')).toBe('第二版')
    const saved = storage.values.recapNotes as Record<string, string>
    expect(Object.keys(saved)).toEqual(['2026-11-13'])
  })

  it('[FR-RECAP-13] IPC 校验：允许空字符串（清空），超过 200 字符被拒绝，前后空白会被去掉', () => {
    expect(recapNoteSchema.safeParse({ note: '' }).success).toBe(true)
    expect(recapNoteSchema.safeParse({ note: '  明天先做最重要的一件事。  ' })).toMatchObject({ success: true, data: { note: '明天先做最重要的一件事。' } })
    expect(recapNoteSchema.safeParse({ note: 'a'.repeat(201) }).success).toBe(false)
    expect(recapNoteSchema.safeParse({}).success).toBe(false)
  })
})
