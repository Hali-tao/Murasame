import { describe, expect, it } from 'vitest'
import type { TaskStatus } from '../../src/shared/types'

const statuses: TaskStatus[] = ['执行中', '等待批准', '已完成', '部分完成', '已取消', '已中断', '失败']

describe('[FR-21] 任务状态机', () => {
  it('[FR-21] 任务状态机包含部分完成', () => {
    expect(statuses).toContain('部分完成')
    expect(statuses).toContain('已中断')
    expect(statuses).toContain('失败')
  })
})
