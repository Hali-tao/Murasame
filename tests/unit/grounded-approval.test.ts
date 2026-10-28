// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { createElement } from 'react'
import { ApprovalDetails } from '../../src/renderer/src/components/ApprovalDetails'
import type { ApprovalRequest } from '../../src/shared/types'
import { pickPetActivity } from '../../src/shared/pet-activity'
afterEach(cleanup)
const source = { relativePath: 'notes/source.md', bytes: 150, mtimeMs: 1793210000000, sha256: 'a'.repeat(64) }
function approval(write = false): ApprovalRequest {
  return { tool: 'filesystem', target: write ? 'E:/test/summary.md' : 'E:/test', impact: JSON.stringify({ workflowKind: 'summarize-files', stage: write ? 'awaiting-write-approval' : 'awaiting-source-approval', sourceManifest: [source, { ...source, relativePath: 'budget.txt', bytes: 200 }], recipient: { name: '已绑定模型', model: 'test-model', provider: '测试服务商', endpoint: 'https://approved.example/v1' }, instruction: '比较已知预算与日期', outputPath: 'summary.md', draftHash: 'b'.repeat(64), ...(write ? { draft: { markdown: '# 已审阅摘要\n\n预算十万元。\n\n> 来源 notes/source.md L1\n<script>not executed</script>' } } : {}), next: [{ id: 'summary', title: '摘要', tool: 'filesystem', scopeKey: write ? 'stage-b' : 'stage-a', args: write ? { action: 'write', path: 'summary.md', content: '正文' } : { action: 'read' } }] }) }
}
describe('[FR-18] 摘要两阶段审批的可读范围', () => {
  it('桌宠短卡片不能直接批准外发或保存，必须进入完整审阅', () => {
    for (const write of [false, true]) {
      const activity = pickPetActivity([{ id: 'summary', title: '摘要', status: '等待批准', summary: '', result: '', approval: approval(write) }], new Set())
      expect(activity?.canApprove).toBe(false)
      expect(activity?.reviewLabel).toBe(write ? '审阅草稿' : '审阅来源')
    }
  })
  it('来源批准显式显示全部文件、大小、外发对象与用途', () => {
    render(createElement(ApprovalDetails, { approval: approval(), scope: 'task' }))
    const sources = screen.getByRole('table', { name: /来源文件/ })
    expect(within(sources).getByText('notes/source.md')).toBeTruthy()
    expect(within(sources).getByText('budget.txt')).toBeTruthy()
    expect(within(sources).getByRole('cell', { name: /150 字节/ })).toBeTruthy()
    expect(screen.getByText('https://approved.example/v1')).toBeTruthy()
    expect(screen.getByText('比较已知预算与日期')).toBeTruthy()
    expect(screen.getByText(/模型服务将收到这些文件的正文/)).toBeTruthy()
    expect(screen.getByText(/保存草稿仍需第二次批准/)).toBeTruthy()
  })
  it('保存批准默认展示完整准确草稿、引用和目标，文本不作为 HTML 执行', () => {
    const { container } = render(createElement(ApprovalDetails, { approval: approval(true), scope: 'once' }))
    const preview = screen.getByLabelText('将保存的完整摘要')
    expect(preview.textContent).toContain('预算十万元。')
    expect(preview.textContent).toContain('notes/source.md L1')
    expect(preview.textContent).toContain('<script>not executed</script>')
    expect(container.querySelector('script')).toBeNull()
    expect(screen.getByText('E:/test/summary.md')).toBeTruthy()
    expect(screen.getByText(/仅新建，不会覆盖/)).toBeTruthy()
    expect(screen.getByText('b'.repeat(64))).toBeTruthy()
  })
})
