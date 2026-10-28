import { describe, expect, it } from 'vitest'
import { approvalPresentation, approvalSummary } from '../../src/shared/task-approval'

const approval = (next: unknown[], remaining = next) => ({
  tool: 'filesystem', target: 'E:/work',
  impact: JSON.stringify({ next, remaining, plan: { tool: 'filesystem', command: 'node build.js' } })
})
describe('readable approvals preserve the exact authorized effects', () => {
  it('shows all file moves and conflicts without approving other ready steps once', () => {
    const files = Array.from({ length: 120 }, (_, i) => ({ source: `E:/work/${i}.txt`, destination: `E:/work/文档/${i}.txt`, conflict: i === 119 }))
    const a = approval([{ id: 'sort', title: '整理文件', tool: 'filesystem', scopeKey: 'files-root', args: { action: 'organize', files } }, { id: 'next', tool: 'filesystem', scopeKey: 'files-root', args: { action: 'read', path: 'readme.txt' } }])
    const view = approvalPresentation(a, 'once')
    expect(view.steps).toHaveLength(1)
    expect(view.steps[0].changes).toHaveLength(120)
    expect(view.steps[0].changes[119]).toMatchObject({ from: 'E:/work/119.txt', to: 'E:/work/文档/119.txt', warning: expect.stringContaining('冲突') })
    expect(approvalSummary(a)).toContain('120')
    expect(approvalSummary(a)).not.toContain('scopeKey')
  })
  it('task scope covers only the same backend scope key, including dependent steps', () => {
    const first = { id: 'first', tool: 'filesystem', scopeKey: 'files-root', args: { action: 'read', path: 'a.txt' } }
    const view = approvalPresentation(approval([first], [first, { ...first, id: 'later' }, { id: 'run', tool: 'terminal', scopeKey: 'terminal-root' }]), 'task')
    expect(view.steps.map(s => s.id)).toEqual(['first', 'later'])
    expect(view.otherSteps).toBe(1)
  })
  it('shows command argument boundaries, network, workspace and declared overwrite/delete', () => {
    const view = approvalPresentation(approval([{ id: 'run', tool: 'terminal', workspace: 'project', network: 'bridge', args: { executable: 'node', argv: ['-e', 'console.log("a b")'] }, outputs: [{ path: 'out.txt', overwrite: true }, { path: 'old.txt', kind: 'delete' }] }]), 'once')
    expect(view.steps[0]).toMatchObject({ executable: 'node', argv: ['-e', 'console.log("a b")'], network: '允许联网', workspace: 'project' })
    expect(view.steps[0].changes.map(c => c.kind)).toEqual(['覆盖', '删除'])
  })
  it('distinguishes retained staged export from rerunning a command', () => {
    const view = approvalPresentation(approval([{ id: 'run', tool: 'terminal', args: { executable: 'node' }, staged: { stageId: 'ticket-safe', changes: [{ path: 'extra.txt', kind: 'write', baselineHash: null }, { path: 'old.txt', kind: 'delete', baselineHash: 'before' }] } }]), 'once')
    expect(view.steps[0].staged).toBe(true)
    expect(view.steps[0].changes.map(c => c.kind)).toEqual(['新建', '删除'])
    expect(view.steps[0].description).toContain('不会重跑')
  })
  it('keeps unrecognized and malformed data inspectable without claiming a harmless action', () => {
    for (const impact of ['not json', '{"next":[null]}', '{"next":"wrong"}', 'null']) {
      const view = approvalPresentation({ tool: 'future', target: '<script>', impact }, 'once')
      expect(view.structured).toBe(false)
      expect(view.raw).toBe(impact)
      expect(view.warning).toContain('完整')
    }
  })
  it('keeps literal file content without interpreting markup', () => {
    const view = approvalPresentation(approval([{ id: 'write', tool: 'filesystem', args: { action: 'write', path: 'a.txt', content: '<img onerror="evil()">' } }]), 'once')
    expect(view.steps[0].content).toBe('<img onerror="evil()">')
  })
})
