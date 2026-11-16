import { approvalPresentation } from '@shared/task-approval'
import type { ApprovalRequest } from '@shared/types'
import { MessageMarkdown } from './MessageMarkdown'

export function ApprovalDetails({ approval, scope }: { approval: ApprovalRequest; scope: 'once' | 'task' }): React.JSX.Element {
  const view = approvalPresentation(approval, scope)
  return <div className="approval-details" data-testid="approval-details">
    <div className="approval-row"><span>{view.summary?.stage === 'draft' ? '保存位置' : '授权位置'}</span><strong>{view.target}</strong></div>
    {view.summary ? <section className="approval-step" aria-label="摘要审批阶段">
      <h4>{view.summary.stage === 'sources' ? '第 1 次确认 · 读取与发送来源' : '第 2 次确认 · 保存这份草稿'}</h4>
      <p className="inline-note">{view.summary.stage === 'sources' ? '模型服务将收到这些文件的正文，仅用于生成本次摘要。保存草稿仍需第二次批准，即使选择“本任务”也不例外。' : '仅新建，不会覆盖已有文件。只保存下面这份已审阅的准确内容；本阶段不会再次请求模型。'}</p>
      <div className="approval-row"><span>摘要用途</span><strong>{view.summary.purpose}</strong></div>
      <div className="approval-row"><span>接收模型</span><strong>{view.summary.recipient}</strong></div>
      <div className="approval-row"><span>服务地址</span><code>{view.summary.endpoint}</code></div>
      <div className="approval-row"><span>目标文件</span><code>{view.summary.outputPath}</code></div>
      <div className="approval-change-scroll"><table className="summary-source-table"><caption>本次摘要来源文件（{view.summary.sources.length} 份）</caption><thead><tr><th>来源</th><th>大小与修改时间</th></tr></thead><tbody>{view.summary.sources.map(source => <tr key={source.path}><td><code>{source.path}</code></td><td>{source.bytes} 字节<br />{source.modified}</td></tr>)}</tbody></table></div>
      {view.summary.stage === 'sources' ? <p>本轮上限：5 份文件，每份 32 KiB，总计 64 KiB / 24000 字符；120 秒内最多 3 次模型请求。超限会停止，请缩小来源后继续。</p> : <>
        <h4>将保存的完整内容与引用</h4><pre aria-label="将保存的完整摘要" tabIndex={0}>{view.summary.markdown}</pre>
        <details>
          <summary>Markdown 预览</summary>
          <section aria-label="摘要 Markdown 预览"><MessageMarkdown text={view.summary.markdown ?? ''} /></section>
        </details>
        <p>内容校验值：<code>{view.summary.draftHash}</code></p>
        <p>引用原文已与来源核对；语义是否准确仍需你的审阅。来源变化时会重新确认，不会悄悄改写这份草稿。</p>
      </>}
    </section> : null}
    {view.warning ? <p className="inline-note amber-note">{view.warning}</p> : null}
    {view.steps.map((step, index) => <section className="approval-step" key={`${step.id}-${index}`}>
      <h4>{index + 1}. {step.title}</h4>
      <p>{step.tool} · {step.network} · 工作位置：{step.workspace === '.' ? '授权目录' : step.workspace}</p>
      {step.description ? <p>{step.description}</p> : null}
      {!step.staged && (step.executable || step.command) ? <div className="approval-command"><strong>将运行</strong><code>{step.executable || step.command}</code>{step.argv.length ? <ol aria-label="命令参数">{step.argv.map((arg, i) => <li key={i}><code>{arg}</code></li>)}</ol> : null}</div> : null}
      {step.changes.length ? <div className="approval-change-scroll"><table><caption>本步骤涉及 {step.changes.length} 项对象</caption><thead><tr><th>操作</th><th>对象与目标</th></tr></thead><tbody>{step.changes.map((change, i) => <tr key={i}><td>{change.kind}</td><td>{change.from ? <><code>{change.from}</code><span className="approval-arrow">移至</span></> : null}<code>{change.to}</code>{change.warning ? <span className="approval-warning">{change.warning}</span> : null}</td></tr>)}</tbody></table></div> : null}
      {step.content !== undefined && !view.summary ? <details><summary>查看将写入的完整内容</summary><pre>{step.content}</pre></details> : null}
      {step.expected ? <p>完成条件：{step.expected}</p> : null}
    </section>)}
    {view.summary ? <p className="inline-note">本次选择仅授权当前摘要阶段，不能跨阶段授权。</p> : scope === 'task' ? <p className="inline-note">本次授权限同一工具、位置及网络范围；改变范围时需要重新批准。</p> : <p className="inline-note">仅批准下一步；后续操作会再次请求确认。</p>}
    {view.otherSteps > 0 ? <p>另有 {view.otherSteps} 个步骤不在本次授权中。</p> : null}
    <details open={!view.structured}><summary>完整操作声明</summary><pre>{view.raw}</pre></details>
  </div>
}
