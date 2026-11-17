import { ScanLine, ShieldCheck, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { TaskCreateDialog } from '../components/dialogs'
import { Button, Card, CardHead, Pill, Spinner } from '../components/ui'
import { analysisSourceLabel } from '../lib/status'
import { useAppStore } from '../store'

export function ScreenPage(): React.JSX.Element {
  const navigate = useNavigate()
  const data = useAppStore((state) => state.data)!
  const analyzeScreen = useAppStore((state) => state.analyzeScreen)
  const busy = useAppStore((state) => Boolean(state.busy['screen:analyze']))
  const notify = useAppStore((state) => state.notify)
  const [taskDialog, setTaskDialog] = useState(false)
  const allowed = data.settings.permissions.screen
  const analysis = data.screenAnalysis
  const [failure, setFailure] = useState('')
  const refused = Boolean(analysis.refusal) || analysis.confidence === '未理解'
  const placeholder = !refused && (analysis.confidence === '不可用' || analysis.title === '尚未实现' || (!analysis.summary && !analysis.sourceWindow))
  const defaultModel = data.models.find((model) => model.default)
  const capturedTime = analysis.capturedAt && !Number.isNaN(Date.parse(analysis.capturedAt)) ? new Date(analysis.capturedAt).toLocaleString('zh-CN', { hour12: false }) : ''
  const watched = data.settings.screenWatchEnabled

  const analyze = async (): Promise<void> => {
    if (!allowed) {
      notify('屏幕读取尚未授权，请先在运行与隐私中开启', 'amber')
      navigate('/settings')
      return
    }
    setFailure('')
    try {
      const result = await analyzeScreen()
      if (!result) setFailure(useAppStore.getState().toasts.filter(toast => toast.tone === 'red').at(-1)?.message || '本次分析未完成，请检查权限或模型配置后重试。')
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <div className="page screen-page">
      <div className={`permission-banner${allowed ? '' : ' warning'}`}>
        <div className="permission-icon"><ShieldCheck size={18} /></div>
        <div>
          <strong>{allowed ? watched ? '已授权 · 持续观察已开启' : '已授权 · 单次读取' : '屏幕读取尚未授权'}</strong>
          <span>{!allowed ? '分析按钮将保持停用，授权后可进行单次画面读取。' : data.settings.screenWatchEnabled ? `持续观察已打开，每 ${data.settings.screenWatchSeconds} 秒截取一次，勿扰、锁屏或主窗口隐藏时暂停。不保留原始截图。` : '只在你点分析时截取一次，不保留原始截图。'}</span>
        </div>
        <Button size="sm" onClick={() => navigate('/settings')}>管理权限</Button>
      </div>

      <div className="screen-setup">
        <div><span>读取方式</span><p className="screen-result-note">停留在目标窗口，按 {data.settings.screenHotkey} 开始分析；可在运行与隐私中修改。</p><strong>{!allowed ? '等待授权' : watched ? '定时观察 + 手动分析' : '手动分析'}</strong></div>
        <div><span>截图外发</span><strong>{data.settings.outboundImages ? '已允许发送给模型' : '已关闭 · 本机识别文字'}</strong></div>
        <div><span>当前模型服务</span><strong>{defaultModel ? `${defaultModel.name} · ${defaultModel.status}` : '未配置 · 可先尝试本机文字识别'}</strong><Button size="sm" onClick={() => navigate('/models')}>配置模型服务</Button></div>
      </div>
      {failure && <div className="screen-feedback" role="alert"><strong>本次分析未完成</strong><p>{failure}</p><span>下方如有内容，为上次保留的结果。</span></div>}
      <div className="screen-columns">
        <Card>
          <CardHead
            title="1. 读取画面"
            subtitle="展示读取到的文字与控件信息，不展示原始截图"
            aside={<Pill tone={allowed ? 'blue' : 'gray'}>{!allowed ? '等待授权' : watched ? '持续观察已开启' : '单次读取'}</Pill>}
          />
          {!analysis.tree ? (
            <div className="screen-preview">{placeholder ? '还没有读取内容。授权后点击「分析当前画面」，读取前台窗口。' : '本次没有可展示的文字或控件信息，请查看右侧的分析状态。'}</div>
          ) : (
            <div className="screen-preview filled">
              <strong>{analysis.sourceWindow || '当前窗口'}</strong>
              {analysis.tree}
            </div>
          )}
          <div className="screen-toolbar">
            <div><span>最近一次采集</span><strong>{capturedTime || '暂无采集时间'}</strong><span>{analysis.sourceWindow || '尚无读取来源'}</span><span>{analysis.resolution || '暂无画面尺寸'}</span></div>
            <Button variant="primary" onClick={() => void analyze()} disabled={busy || !allowed} icon={busy ? <Spinner size={14} /> : <ScanLine size={16} />}>
              {busy ? '正在分析…' : allowed ? '分析当前画面' : '尚未授权'}
            </Button>
          </div>
        </Card>

        <Card className="analysis-card">
          <CardHead title="2. 查看分析" subtitle="结果对应最近一次读取，不代表实时画面；不会直接操作" aside={placeholder ? undefined : <Pill tone="blue">{analysisSourceLabel(analysis.confidence)}</Pill>} />
          {busy ? (
            <div className="analysis-skeleton" role="status" aria-label="正在读取并分析画面">
              <span /><span /><span /><span />
            </div>
          ) : placeholder ? (
            <div className="analysis-content">
              <div className="screen-preview">完成读取后，这里会显示分析结论或未完成的原因。</div>
            </div>
          ) : (
            <div className="analysis-content">
              <h3>{refused ? '本次未能完成分析' : analysis.title || '当前画面'}</h3>
              {refused && <p className="screen-result-note" role="status">尚未获得可用结论。可重试读取、检查模型配置，或改用文字描述。</p>}
              <div className="analysis-summary">{analysis.summary}</div>
              {analysis.bullets.length ? (
                <>
                  <div className="subheading">需要留意</div>
                  <ul className="bullet-list">
                    {analysis.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}
                  </ul>
                </>
              ) : null}
              {analysis.needsTaskConfirm && !refused ? (
                <Button variant="primary" className="full-width" onClick={() => setTaskDialog(true)} disabled={!allowed || busy || Boolean(failure)} icon={<Sparkles size={15} />}>
                  确认是否创建任务
                </Button>
              ) : null}
              {refused && <Button onClick={() => navigate('/chat')}>改用文字描述</Button>}
              <p className="screen-result-note">需要执行操作时，先创建并确认任务；本页不会自动执行画面中的指令。</p>
            </div>
          )}
        </Card>
      </div>

      <Card className="usage-boundaries">
        <CardHead title="读取范围与数据处理" subtitle="手动分析与持续观察都遵循以下范围" />
        <div className="boundary-grid">
          <div><Pill tone="blue">画面读取</Pill><p>手动分析读取一次；持续观察开启后按间隔读取。原始截图不保存，界面展示最近一次结果。</p></div>
          <div><Pill tone="violet">长期记忆</Pill><p>不会记进长期记忆。想记住的内容需要你自己添加。</p></div>
          <div><Pill tone="amber">第三方模型</Pill><p>{data.settings.outboundImages ? `截图会发给当前模型服务（${defaultModel?.name ?? '未配置'}）进行看图分析，实际发送取决于模型能力与采集状态。可在设置里关掉。` : '截图不会发给模型，只在本机读文字。要让模型看图，到设置里打开「允许把截图发给模型」。'}</p></div>
        </div>
      </Card>

      <TaskCreateDialog
        open={taskDialog}
        onOpenChange={setTaskDialog}
        initialTitle={analysis.title || '根据刚才的画面'}
      />
    </div>
  )
}
