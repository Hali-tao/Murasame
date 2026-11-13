import { describe, expect, it } from 'vitest'
import type { Task } from '../../src/shared/types'
import { isTheaterMuted, theaterSceneForObservation, theaterSceneForTask } from '../../src/main/core/services/theater-service'

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

describe('[F-04-OBS-00] 见闻幕（自主活动完成）', () => {
  const result = {
    activityId: 'activity-1',
    status: 'completed',
    goal: '看看离线模型的文章',
    observations: [
      { text: '原始网页正文：这是一篇关于离线模型的文章全文，不应原样进入气泡。' },
      { text: '另一条观察记录' }
    ],
    finishedAt: '2026-11-13T08:00:00.000Z'
  }

  it('[F-04-OBS-01] 有真实观察时产生见闻幕：本地模板陈述目标与观察数，不包含网页原文', () => {
    const scene = theaterSceneForObservation(result, () => 1_700_000_000_000)
    expect(scene).not.toBeNull()
    expect(scene!.kind).toBe('observation')
    expect(scene!.viewPath).toBe('/autonomy')
    expect(scene!.line).toContain('看看离线模型的文章')
    expect(scene!.line).toContain('2 条观察记录')
    expect(scene!.line).not.toContain('这是关于离线模型的文章全文')
    expect(scene!.id).toBe('observation-activity-1-2026-11-13T08:00:00.000Z')
  })

  it('[F-04-OBS-02] 失败/取消/无观察/没有结果时都不演（不把失败包装成见闻）', () => {
    expect(theaterSceneForObservation({ ...result, status: 'failed' })).toBeNull()
    expect(theaterSceneForObservation({ ...result, status: 'cancelled' })).toBeNull()
    expect(theaterSceneForObservation({ ...result, observations: [] })).toBeNull()
    expect(theaterSceneForObservation(undefined)).toBeNull()
    expect(theaterSceneForObservation({ ...result, status: 'partial' })).not.toBeNull()
  })
})

describe('[QA-THEATER-00] 小剧场气泡内容有界（超长任务名的交互死角）', () => {
  it('[QA-THEATER-01] 数千字符/带换行的任务名被压平并截断，不会撑爆气泡', () => {
    const longTitle = '整理文件夹 ' + '超长任务描述\n第二行'.repeat(200)
    const scene = theaterSceneForTask(task('已取消', longTitle))
    expect(scene).not.toBeNull()
    expect(scene!.line.length).toBeLessThanOrEqual(161)
    expect(scene!.title.length).toBeLessThanOrEqual(81)
    expect(scene!.line).not.toContain('\n')
    expect(scene!.line).toContain('…')
  })

  it('[QA-THEATER-02] 见闻幕的目标摘要同样有界并压平换行', () => {
    const scene = theaterSceneForObservation({
      activityId: 'activity-long',
      status: 'completed',
      goal: '目标'.repeat(2000) + '\n换行',
      observations: [{ text: '观察记录' }],
      finishedAt: '2026-11-13T08:00:00.000Z'
    })
    expect(scene).not.toBeNull()
    expect(scene!.line.length).toBeLessThanOrEqual(161)
    expect(scene!.line).not.toContain('\n')
  })
})


describe('[F-04-PRIORITY-00] 小剧场优先级（同一时段只保留最高优先级一幕）', () => {
  it('[F-04-PRIORITY-01] 失败/部分完成高于中断/取消/完成，见闻幕居中', () => {
    expect(theaterSceneForTask(task('失败'))!.priority).toBe(5)
    expect(theaterSceneForTask(task('部分完成'))!.priority).toBe(5)
    expect(theaterSceneForTask(task('已中断'))!.priority).toBe(3)
    expect(theaterSceneForTask(task('已取消'))!.priority).toBe(2)
    expect(theaterSceneForTask(task('已完成'))!.priority).toBe(1)
    const observation = theaterSceneForObservation({
      activityId: 'activity-priority',
      status: 'completed',
      goal: '看点什么',
      observations: [{ text: '观察' }],
      finishedAt: '2026-11-13T08:00:00.000Z'
    })
    expect(observation!.priority).toBe(2)
    expect(observation!.priority).toBeLessThan(theaterSceneForTask(task('失败'))!.priority)
  })
})


describe('[QA-THEATER-10] 气泡文本的 Unicode 控制符清洗（显示层加固）', () => {
  it('双向/零宽/控制字符不会进入气泡文本，正常中文与 emoji 保留', () => {
    const raw = '整理文件夹 \u202Eevil\u202C \u200B隐藏 \u0007提示 \u2066隔离\u2069 📁'
    const scene = theaterSceneForTask(task('失败', raw))
    expect(scene).not.toBeNull()
    const text = scene!.title + scene!.line
    for (const forbidden of ['\u202E', '\u202C', '\u200B', '\u0007', '\u2066', '\u2069']) {
      expect(text).not.toContain(forbidden)
    }
    expect(text).toContain('整理文件夹')
    expect(text).toContain('📁')
  })
})
