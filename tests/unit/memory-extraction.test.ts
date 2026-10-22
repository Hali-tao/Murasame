import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runModelExtraction } from '../../src/main/agent/memory-extractor'
import { executeGoal } from '../../src/main/agent/executor'
import { cropRect } from '../../src/main/local/screen-policy'
import { activeMemories, applyMemoryAction } from '../../src/main/memory/facts'

describe('[FR-17] 模型给出的计划', () => {
  it('[FR-21] 有模型计划时记录的是这次模型调用，并按计划里的目录执行', async () => {
    const root = mkdtempSync(join(tmpdir(), 'murasame-plan-'))
    writeFileSync(join(root, 'a.png'), 'x')
    writeFileSync(join(root, 'b.txt'), 'x')
    const outcome = await executeGoal({
      goal: '把下载文件夹按类型整理一下',
      root,
      approved: true,
      cancelled: false,
      plan: { tool: 'filesystem', root, steps: [{ title: '按类型归类', detail: '图片和文档分开', expected: '根目录只剩分类文件夹' }], question: '' }
    })
    expect(outcome.calls[0].toolId).toBe('model')
    expect(outcome.calls[0].evidence[0].kind).toBe('schema-check')
    expect(outcome.steps[0].detail).toContain('按类型归类')
    expect(readdirSync(root).sort()).toEqual(['图片', '文档'].sort())
  })

  it('[FR-21] 没有模型时如实标成按规则处理', async () => {
    const outcome = await executeGoal({ goal: '整理 D:\\不存在的目录', root: null, approved: false, cancelled: false })
    expect(outcome.calls[0].toolId).toBe('rules')
    expect(outcome.calls[0].declared).toContain('没有可用的模型')
  })
})

describe('[FR-05] 截图裁到目标窗口', () => {
  it('[FR-05] 窗口在主屏内时按窗口矩形裁剪', () => {
    expect(cropRect({ x: 100, y: 50, width: 800, height: 600 }, { width: 2560, height: 1440 })).toEqual({ x: 100, y: 50, width: 800, height: 600 })
  })

  it('[FR-05] 窗口超出截图或太小时不裁，用整屏', () => {
    expect(cropRect({ x: 3000, y: 0, width: 800, height: 600 }, { width: 2560, height: 1440 })).toBeNull()
    expect(cropRect({ x: 0, y: 0, width: 10, height: 10 }, { width: 2560, height: 1440 })).toBeNull()
    expect(cropRect(undefined, { width: 2560, height: 1440 })).toBeNull()
  })
})

describe('[FR-14] 由模型提取记忆', () => {
  it('[FR-14] 句式规则认不出的说法也能记下', async () => {
    let seen = ''
    const outcome = await runModelExtraction('辣的东西我一口都碰不了', [], new Set(), async (text) => {
      seen = text
      return [{ action: 'ADD', category: 'feedback', text: '不吃辣' }]
    })
    expect(seen).toBe('辣的东西我一口都碰不了')
    expect(outcome.failed).toBe(false)
    expect(activeMemories(outcome.facts).map((item) => item.text)).toEqual(['不吃辣'])
  })

  it('[UC-05] 矛盾时替换指定的旧记忆，旧条目留作追溯', async () => {
    const existing = applyMemoryAction([], { category: 'user', text: '每天喝咖啡' }, 'ADD', 't0', new Set())
    let known: string[] = []
    const outcome = await runModelExtraction('最近戒咖啡了，改喝茶', existing, new Set(), async (_text, list) => {
      known = list
      return [{ action: 'UPDATE', category: 'user', text: '改喝茶', replaces: '每天喝咖啡' }]
    })
    expect(known).toEqual(['每天喝咖啡'])
    expect(activeMemories(outcome.facts).map((item) => item.text)).toEqual(['改喝茶'])
    expect(outcome.facts.find((item) => item.text === '每天喝咖啡')?.validUntil).not.toBeNull()
  })

  it('[NFR-M01] 模型提出的密钥不进记忆', async () => {
    const outcome = await runModelExtraction('我的 key 是 sk-abcdefghijklmn', [], new Set(), async () => [
      { action: 'ADD', category: 'reference', text: 'api_key 是 sk-abcdefghijklmn' }
    ])
    expect(activeMemories(outcome.facts)).toHaveLength(0)
  })

  it('[FR-15] 用户删掉过的内容不会被模型重新加回', async () => {
    const outcome = await runModelExtraction('我不吃辣', [], new Set(['不吃辣']), async () => [
      { action: 'ADD', category: 'feedback', text: '不吃辣' }
    ])
    expect(activeMemories(outcome.facts)).toHaveLength(0)
  })

  it('[UC-05] 模型调用失败时整轮不写', async () => {
    const existing = applyMemoryAction([], { category: 'user', text: '喝茶' }, 'ADD', 't0', new Set())
    const outcome = await runModelExtraction('随便说点什么', existing, new Set(), async () => {
      throw new Error('结构不匹配')
    })
    expect(outcome.failed).toBe(true)
    expect(outcome.facts).toEqual(existing)
  })
})

describe('[FR-19] 任务按文件推进，可以中途取消', () => {
  it('[FR-19] 每移动一个文件报一次进度', async () => {
    const root = mkdtempSync(join(tmpdir(), 'murasame-progress-'))
    for (const name of ['a.txt', 'b.png', 'c.ts']) writeFileSync(join(root, name), name)
    const seen: string[] = []
    const outcome = await executeGoal({
      goal: `整理 ${root}`, root, approved: true, cancelled: false,
      control: { stopped: () => false, progress: (done, total) => seen.push(`${done}/${total}`) }
    })
    expect(outcome.status).toBe('已完成')
    expect(seen).toEqual(['1/3', '2/3', '3/3'])
  })

  it('[FR-20] 取消后不再移动新文件，并列出已完成的部分', async () => {
    const root = mkdtempSync(join(tmpdir(), 'murasame-cancel-'))
    const names = Array.from({ length: 20 }, (_, index) => `file-${index}.txt`)
    for (const name of names) writeFileSync(join(root, name), name)
    let stop = false
    const outcome = await executeGoal({
      goal: `整理 ${root}`, root, approved: true, cancelled: false,
      control: { stopped: () => stop, progress: (done) => { if (done === 5) stop = true } }
    })
    expect(outcome.status).toBe('已取消')
    expect(readdirSync(join(root, '文档'))).toHaveLength(5)
    expect(names.filter((name) => existsSync(join(root, name)))).toHaveLength(15)
    expect(outcome.result).toContain('取消前移动了 5/20 个文件')
    expect(outcome.result).toContain('file-0.txt')
  })
})
