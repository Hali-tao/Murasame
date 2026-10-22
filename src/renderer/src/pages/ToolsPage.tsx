import { Info, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import type { ToolCapability } from '@shared/types'
import { toolCalls } from '@shared/mock-data'
import { Button, Card, CardHead, ConfirmDialog, Modal, Pill, StatTile, ToggleSwitch } from '../components/ui'
import { useAppStore } from '../store'

type ToolKind = '全部' | '工具' | '插件' | '内置'

export function ToolsPage(): React.JSX.Element {
  const data = useAppStore((state) => state.data)!
  const setToolEnabled = useAppStore((state) => state.setToolEnabled)
  const updateSettings = useAppStore((state) => state.updateSettings)
  const busy = useAppStore((state) => state.busy)
  const [filter, setFilter] = useState<ToolKind>('全部')
  const [detail, setDetail] = useState<ToolCapability | null>(null)
  const [voicePrompt, setVoicePrompt] = useState(false)
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
      <div className="stat-grid four">
        <StatTile label="可用能力" value={`${enabled} / ${data.tools.length}`} caption="停用后不再接受新调用" tone="green" />
        <StatTile label="今日调用" value="9" caption="8 成功 · 1 部分成功" tone="blue" />
        <StatTile label="权限受限" value={data.tools.filter((tool) => tool.permission === '未授权' || tool.permission === '已停用').length} caption="语音与日历" tone="amber" />
        <StatTile label="运行中调用" value="1" caption="文件写入尚待批准" tone="coral" />
      </div>

      <div className="tools-columns">
        <Card>
          <CardHead
            title="能力清单"
            subtitle="仅已启用且获得授权的能力会参与任务"
            aside={
              <select className="select compact-select" value={filter} onChange={(event) => setFilter(event.target.value as ToolKind)} aria-label="筛选能力类型">
                {(['全部', '工具', '插件', '内置'] as ToolKind[]).map((item) => <option key={item}>{item}</option>)}
              </select>
            }
          />
          <div className="tool-list">
            {filtered.map((tool) => (
              <div className={`tool-row${tool.enabled ? '' : ' disabled'}`} key={tool.id}>
                <div className="tool-main">
                  <div className="tool-titleline">
                    <strong>{tool.name}</strong>
                    <Pill tone="gray">{tool.kind}</Pill>
                    <Pill tone={tool.permission === '未授权' || tool.permission === '已停用' ? 'red' : tool.permission === '需确认' ? 'amber' : 'blue'}>{tool.permission}</Pill>
                    <span className={`tool-state ${tool.enabled ? 'on' : ''}`}>{tool.enabled ? '已启用' : '已停用'}</span>
                  </div>
                  <p>{tool.ability}</p>
                  <span className="tool-note">{tool.note} · 最近调用 {tool.last}</span>
                </div>
                <div className="tool-actions">
                  <button type="button" className="text-button" onClick={() => setDetail(tool)}>详情</button>
                  <ToggleSwitch
                    checked={tool.enabled}
                    disabled={Boolean(busy[`tool:${tool.id}`])}
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
            <CardHead title="调用记录" subtitle="过去 24 小时 · 可定位失败" />
            <div className="call-list">
              {toolCalls.map((call) => (
                <div className="call-row" key={`${call.time}-${call.action}`}>
                  <time>{call.time}</time>
                  <div><strong>{call.action}</strong><span>{call.tool}</span></div>
                  <Pill tone={call.tone}>{call.result}</Pill>
                </div>
              ))}
            </div>
            <p className="fineprint">管理操作本身不会触发业务任务。</p>
          </Card>
          <Card>
            <CardHead title="权限边界" subtitle="工具之间不会自动继承授权" />
            <div className="boundary-list">
              <div><Pill tone="blue">文件系统</Pill><span>仅授权目录，写入需再次确认</span></div>
              <div><Pill tone="amber">终端命令</Pill><span>默认沙箱，敏感命令逐次审批</span></div>
              <div><Pill tone="green">隔离桌面</Pill><span>与宿主应用会话分离</span></div>
            </div>
            <div className="security-hint"><ShieldCheck size={15} />停用后不会撤回已生成的产物。</div>
          </Card>
        </div>
      </div>

      <Modal
        open={Boolean(detail)}
        onOpenChange={(open) => { if (!open) setDetail(null) }}
        title={detail ? `${detail.name} · 能力详情` : '能力详情'}
        description="权限变更会在下一次任务调用时生效。"
        footer={<Button onClick={() => setDetail(null)}>关闭</Button>}
      >
        {detail ? (
          <div className="tool-detail">
            <div className="tool-detail-badges"><Pill tone="gray">{detail.kind}</Pill><Pill tone={detail.enabled ? 'green' : 'red'}>{detail.enabled ? '已启用' : '已停用'}</Pill><Pill tone="blue">{detail.permission}</Pill></div>
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
