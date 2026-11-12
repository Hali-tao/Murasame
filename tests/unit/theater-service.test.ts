import { describe, expect, it } from 'vitest'
import type { Task } from '../../src/shared/types'
import { isTheaterMuted, theaterSceneForTask } from '../../src/main/core/services/theater-service'

const task = (status: Task['status'], title = '整理下载文件夹'): Task => ({
  id: 'task-1', title, status, tone: 'green', progress: 100, created: '2026-11-13 09:00', model: 'test-model',
  modelProfileId: null, scope: '待选择', summary: '', steps: [], artifacts: [], approval: null, result: '', toolCalls: [], verdict: null
})

describe('[F-04-THEATER-00] 任务幕（小剧场最小切片）', () => {
  it('[F-04-THEATER-01] 任务终态各有一幕，台词含真实任务名且不虚构', () => {
    const expected: Array<[Task['status'], string]> = [
      ['已完成', '已经完成'],
      ['部分完成', '只完成了一部分'],
      ['失败', '没有成功'],
      ['已取消', '已取消'],
      ['已中断', '中途停了']
    ]
    for (const [status, fragment] of expected) {
      const scene = theaterSceneForTask(task(status))
      expect(scene, status).not.toBeNull()
      expect(scene!.line).toContain('整理下载文件夹')
      expect(scene!.line).toContain(fragment)
      expect(scene!.kind).toBe('task')
      expect(scene!.status).toBe(status)
      expect(scene!.id).toBe(`task-1:${status}`)
    }
  })

  it('[F-04-THEATER-02] 表现姿态与真实状态对齐：失败/取消不庆祝', () => {
    expect(theaterSceneForTask(task('已完成'))!.intent).toBe('开心')
    expect(theaterSceneForTask(task('失败'))!.intent).toBe('困惑')
    expect(theaterSceneForTask(task('已取消'))!.intent).toBe('思考')
    expect(theaterSceneForTask(task('部分完成'))!.intent).toBe('思考')
  })

  it('[F-04-THEATER-03] 非终态（执行中/等待批准等）不产生小剧场', () => {
    for (const status of ['规划中', '执行中', '等待批准', '正在停止'] as const) {
      expect(theaterSceneForTask(task(status))).toBeNull()
    }
  })

  it('[F-04-THEATER-05] 「今天不再演」只对当天有效，跨天/未设置自动恢复', () => {
    expect(isTheaterMuted('', '2026-11-13')).toBe(false)
    expect(isTheaterMuted('2026-11-13', '2026-11-13')).toBe(true)
    expect(isTheaterMuted('2026-11-12', '2026-11-13')).toBe(false)
  })

  it('[F-04-THEATER-04] 同一事件去重键稳定（同一任务同一终态只演一次的依据）', () => {
    const first = theaterSceneForTask(task('失败'), () => 1_700_000_000_000)
    const second = theaterSceneForTask(task('失败'), () => 1_800_000_000_000)
    expect(first!.id).toBe(second!.id)
    expect(first!.createdAt).toBe(new Date(1_700_000_000_000).toISOString())
  })
})
