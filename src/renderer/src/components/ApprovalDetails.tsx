import { approvalPresentation } from '@shared/task-approval'
import type { ApprovalRequest } from '@shared/types'

export function ApprovalDetails({ approval, scope }: { approval: ApprovalRequest; scope: 'once' | 'task' }): React.JSX.Element {
  const view = approvalPresentation(approval, scope)
  return <div className="approval-details" data-testid="approval-details">
    <div className="approval-row"><span>授权位置</span><strong>{view.target}</strong></div>
    {view.warning ? <p className="inline-note amber-note">{view.warning}</p> : null}
    {view.steps.map((step, index) => <section className="approval-step" key={`${step.id}-${index}`}>
      <h4>{index + 1}. {step.title}</h4>
      <p>{step.tool} · {step.network} · 工作位置：{step.workspace === '.' ? '授权目录' : step.workspace}</p>
      {step.description ? <p>{step.description}</p> : null}
      {!step.staged && (step.executable || step.command) ? <div className="approval-command"><strong>将运行</strong><code>{step.executable || step.command}</code>{step.argv.length ? <ol aria-label="命令参数">{step.argv.map((arg, i) => <li key={i}><code>{arg}</code></li>)}</ol> : null}</div> : null}
      {step.changes.length ? <div className="approval-change-scroll"><table><caption>本步骤涉及 {step.changes.length} 项对象</caption><thead><tr><th>操作</th><th>对象与目标</th></tr></thead><tbody>{step.changes.map((change, i) => <tr key={i}><td>{change.kind}</td><td>{change.from ? <><code>{change.from}</code><span className="approval-arrow">移至</span></> : null}<code>{change.to}</code>{change.warning ? <span className="approval-warning">{change.warning}</span> : null}</td></tr>)}</tbody></table></div> : null}
      {step.content !== undefined ? <details><summary>查看将写入的完整内容</summary><pre>{step.content}</pre></details> : null}
      {step.expected ? <p>完成条件：{step.expected}</p> : null}
    </section>)}
    {scope === 'task' ? <p className="inline-note">本次授权限同一工具、位置及网络范围；改变范围时需要重新批准。</p> : <p className="inline-note">仅批准下一步；后续操作会再次请求确认。</p>}
    {view.otherSteps > 0 ? <p>另有 {view.otherSteps} 个步骤不在本次授权中。</p> : null}
    <details open={!view.structured}><summary>完整操作声明</summary><pre>{view.raw}</pre></details>
  </div>
}
