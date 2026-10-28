import { describe, expect, it } from 'vitest'
import { pickPetActivity, type PetActivitySource } from '../../src/shared/pet-activity'

function task(patch: Partial<PetActivitySource> & Pick<PetActivitySource, 'id' | 'status'>): PetActivitySource {
  return {
    title: patch.title ?? patch.id,
    summary: patch.summary ?? '',
    result: patch.result ?? '',
    approval: patch.approval ?? null,
    ...patch
  }
}

describe('桌宠活动状态', () => {
  it('等你确认排在正在做和做完了前面', () => {
    const picked = pickPetActivity([
      task({ id: 'done', status: '已完成', title: '整理完了' }),
      task({ id: 'run', status: '执行中', title: '正在整理' }),
      task({ id: 'ask', status: '等待批准', title: '整理下载', approval: { target: '下载', impact: '会移动文件' } })
    ], new Set())
    expect(picked?.id).toBe('ask')
    expect(picked?.kind).toBe('needs-input')
    expect(picked?.canApprove).toBe(true)
    expect(picked?.detail).toBe('会移动文件')
  })

  it('多件等待时说明还有几件', () => {
    const picked = pickPetActivity([
      task({ id: 'new', status: '等待批准', title: '新的' }),
      task({ id: 'old', status: '待确认', title: '旧的' })
    ], new Set())
    expect(picked?.id).toBe('new')
    expect(picked?.waiting).toBe(2)
    expect(picked?.canApprove).toBe(true)
  })

  it('缺信息的待确认不能在桌宠上直接允许', () => {
    const picked = pickPetActivity([
      task({ id: 'ask', status: '待确认', summary: '要处理哪个目录？' })
    ], new Set())
    expect(picked?.canApprove).toBe(false)
    expect(picked?.detail).toBe('要处理哪个目录？')
  })

  it('做完和失败可以收起，正在做不会被收起盖住', () => {
    const dismissed = new Set(['done', 'run'])
    expect(pickPetActivity([
      task({ id: 'done', status: '已完成' }),
      task({ id: 'bad', status: '失败', result: '有一个文件被占用' })
    ], new Set(['done', 'bad']))).toBeNull()
    expect(pickPetActivity([
      task({ id: 'bad', status: '失败', result: '有一个文件被占用' })
    ], new Set())?.detail).toBe('有一个文件被占用')
    expect(pickPetActivity([
      task({ id: 'run', status: '执行中', title: '还在整理' })
    ], dismissed)?.label).toBe('正在做')
  })

  it('做完了显示文件位置，不拿旧的「已拷到桌面」盖住路径', () => {
    const picked = pickPetActivity([
      task({
        id: 'done',
        status: '已完成',
        summary: '已拷到桌面',
        result: '文件在 C:\\Users\\a\\Desktop\\murasame-画.png，120 字节。'
      })
    ], new Set())
    expect(picked?.detail).toContain('murasame-画.png')
  })

  it('没有需要看的事时不占位置', () => {
    expect(pickPetActivity([
      task({ id: 'gone', status: '已取消' })
    ], new Set())).toBeNull()
  })
})
