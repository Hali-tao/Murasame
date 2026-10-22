import { describe, expect, it } from 'vitest'
import { NotImplementedError, notImplemented } from '../../src/main/core/errors'

describe('[OR-01] 未实现能力', () => {
  it('[OR-01] 未实现的能力返回明确的未实现错误而非伪造数据', () => {
    expect(() => notImplemented('屏幕辅助')).toThrow(NotImplementedError)
    try {
      notImplemented('屏幕辅助')
    } catch (error) {
      expect(error).toBeInstanceOf(NotImplementedError)
      expect((error as Error).message).toBe('该功能尚未实现：屏幕辅助')
    }
  })
})
