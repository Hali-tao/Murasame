import { Info, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ToolCapability } from '@shared/types'
import { Button, Card, CardHead, ConfirmDialog, Modal, Pill, ToggleSwitch } from '../components/ui'
import { StatusPill, VerdictPill } from '../components/StatusPill'
import { roleLabel } from '../lib/status'
import { useAppStore } from '../store'

type ToolKind = '全部' | '工具' | '插件' | '内置'

export function ToolsPage(): React.JSX.Element {
  const navigate = useNavigate()
  const data = useAppStore((state) => state.data)!
  const setToolEnabled = useAppStore((state) => state.setToolEnabled)
  const updateSettings = useAppStore((state) => state.updateSettings)
  const busy = useAppStore((state) => state.busy)
  const [filter, setFilter] = useState<ToolKind>('全部')
  const [detailId, setDetailId] = useState<string | null>(null)
  const detail = data.tools.find((tool) => tool.id === detailId) ?? null
  const [voicePrompt, setVoicePrompt] = useState(false)
  const calls = data.tasks.flatMap((task) => task.toolCalls)
  const enabled = data.tools.filter((tool) => tool.enabled).length
  const filtered = data.tools.filter((tool) => filter === '全部' || tool.kind === filter)

  const toggle = async (tool: ToolCapability, checked: boolean): Promise<void> => {
    if (tool.id === 'voice' && checked && !data.settings.permissions.microphone) {
      setVoicePrompt(true)
      return
    }
    await setToolEnabled(tool.id, checked)
  }

  const grantVoice = async (): Promise<void> => {
    const saved = await updateSettings({ permissions: { ...data.settings.permissions, microphone: true } })
    if (!saved) return
    const result = await setToolEnabled('voice', true)
    if (result) setVoicePrompt(false)
  }

  return (
    <div className="page tools-page">
      <div className="tools-overview">
        <div><h2>能力管理</h2><p>开关控制是否接受新调用，不代表已获得系统权限。需要确认的操作仍会单独请求批准。</p></div>
        <Pill tone="gray">已启用 {enabled} / {data.tools.length}</Pill>
      </div>

      <div className="tools-columns">
        <Card>
          <CardHead
            title="工具与插件开关"
            subtitle="管理当前列出的工具、插件和内置能力。不可用项会说明原因，停用不会删除已有产物。"
            aside={
              <select className="select compact-select" value={filter} onChange={(event) => setFilter(event.target.value as ToolKind)} aria-label="筛选能力类型">
                {(['全部', '工具', '插件', '内置'] as ToolKind[]).map((item) => <option key={item}>{item}</option>)}
              </select>
            }
          />
          <div className="tool-list">
            {!filtered.length && <p className="tools-empty" role="status">当前分类下没有能力，可选择其他类型查看。</p>}
            {filtered.map((tool) => (
              <div className={`tool-row${tool.enabled ? '' : ' disabled'}`} key={tool.id}>
                <div className="tool-main">
                  <div className="tool-titleline">
                    <strong>{tool.name}</strong>
                    <Pill tone="gray">{tool.kind}</Pill>
                    <Pill tone={tool.permission === '不可用' || tool.permission === '已停用' ? 'gray' : tool.permission === '未授权' ? 'red' : tool.permission === '需确认' ? 'amber' : 'blue'}>{tool.permission}</Pill>
                    <span className={`tool-state ${tool.enabled ? 'on' : ''}`}>{tool.enabled ? '已启用' : '已停用'}</span>
                  </div>
                  <p>{tool.ability}</p>
                  <span className="tool-note">{tool.note} · 最近调用 {tool.last}</span>
                </div>
                <div className="tool-actions">
                  <button type="button" className="text-button" onClick={() => setDetailId(tool.id)}>详情</button>
                  <ToggleSwitch
                    checked={tool.enabled}
                    disabled={Boolean(busy[`tool:${tool.id}`]) || tool.permission === '不可用'}
                    onCheckedChange={(checked) => void toggle(tool, checked)}
                    label={`${tool.enabled ? '停用' : '启用'}${tool.name}`}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>

        <div className="tools-side">
          <Card>
            <CardHead title="权限与使用范围" subtitle="启用能力与授予权限是两件事，工具之间不会自动继承授权" aside={<Button size="sm" onClick={() => navigate('/settings')}>管理系统权限</Button>} />
            <div className="boundary-list">
              <div><Pill tone="blue">文件系统</Pill><span>仅授权目录，写入需再次确认</span></div>
              <div><Pill tone="amber">终端命令</Pill><span>在授权目录里执行，不是沙箱。敏感命令逐次审批。</span></div>
              <div><Pill tone="green">隔离桌面</Pill><span>与宿主应用会话分离</span></div>
            </div>
            <div className="security-hint"><ShieldCheck size={15} />停用后不会撤回已生成的产物。</div>
          </Card>
          <Card>
            <CardHead title="调用记录" subtitle={`已保留任务中的 ${calls.length} 条调用记录，不限日期`} />
            <div className="call-list">
              {calls.length ? calls.map((call) => (
                <div className="call-row" key={call.id}>
                  <time>{call.execution.endedAt || '尚未结束'}</time>
                  <div><strong>{call.declared.intent}</strong><span>{roleLabel(call.agentRole)} · {call.toolId}</span></div>
                  <VerdictPill verdict={call.verification.verdict} />
                </div>
              )) : <span className="muted">还没有调用记录。</span>}
            </div>
            <p className="fineprint">启停开关和查看详情不会生成任务调用记录。</p>
          </Card>
        </div>
      </div>

      <Modal
        open={Boolean(detail)}
        onOpenChange={(open) => { if (!open) setDetailId(null) }}
        title={detail ? `${detail.name} · 能力详情` : '能力详情'}
        description="权限变更会在下一次任务调用时生效。"
        footer={<Button onClick={() => setDetailId(null)}>关闭</Button>}
      >
        {detail ? (
          <div className="tool-detail">
            <div className="tool-detail-badges"><Pill tone="gray">{detail.kind}</Pill><StatusPill status={detail.enabled ? 'enabled' : 'disabled'} /><Pill tone="blue">{detail.permission}</Pill></div>
            <div className="info-grid compact">
              <div><span>能力</span><strong>{detail.ability}</strong></div>
              <div><span>最近调用</span><strong>{detail.last}</strong></div>
              <div><span>说明</span><strong>{detail.note}</strong></div>
            </div>
            <div className="inline-note"><Info size={14} />所有工具调用仍受任务范围与单次批准约束。</div>
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={voicePrompt}
        onOpenChange={setVoicePrompt}
        title="语音输入需要麦克风权限"
        description="本地转写会使用麦克风。你可以随时在这台设备的系统设置中撤销权限。"
        confirmLabel="授权并启用"
        onConfirm={grantVoice}
      >
        <div className="approval-card">
          <div className="approval-row"><span>能力</span><strong>麦克风录音与本地转写</strong></div>
          <div className="approval-row"><span>数据范围</span><strong>仅当前语音输入，不持续监听</strong></div>
          <div className="approval-row"><span>存储</span><strong>不保留原始录音</strong></div>
        </div>
      </ConfirmDialog>
    </div>
  )
}
