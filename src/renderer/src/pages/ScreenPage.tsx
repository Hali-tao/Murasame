import { ScanLine, ShieldCheck, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { TaskCreateDialog } from '../components/dialogs'
import { Button, Card, CardHead, Pill, Spinner } from '../components/ui'
import { StatusPill } from '../components/StatusPill'
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
  const placeholder = analysis.confidence === '不可用' || analysis.title === '尚未实现' || (!analysis.summary && !analysis.sourceWindow)
  const watched = data.settings.screenWatchEnabled

  const analyze = async (): Promise<void> => {
    if (!allowed) {
      notify('屏幕读取尚未授权，请先在运行与隐私中开启', 'amber')
      navigate('/settings')
      return
    }
    await analyzeScreen()
  }

  return (
    <div className="page screen-page">
      <div className={`permission-banner${allowed ? '' : ' warning'}`}>
        <div className="permission-icon"><ShieldCheck size={18} /></div>
        <div>
          <strong>{allowed ? '已授权 · 屏幕读取仅用于当前问题' : '屏幕读取尚未授权'}</strong>
          <span>{!allowed ? '分析按钮将保持停用，授权后可进行单次画面读取。' : data.settings.screenWatchEnabled ? `持续观察已打开，每 ${data.settings.screenWatchSeconds} 秒截取一次，勿扰或桌宠隐藏时暂停。不保留原始截图。` : '只在你点分析时截取一次，不保留原始截图。'}</span>
        </div>
        <Button size="sm" onClick={() => navigate('/settings')}>管理权限</Button>
      </div>

      <div className="screen-columns">
        <Card>
          <CardHead
            title="当前画面"
            subtitle={placeholder ? '点一次，读取你正在看的窗口' : analysis.sourceWindow}
            aside={<StatusPill status={watched ? 'watching' : 'single-capture'} />}
          />
          {placeholder ? (
            <div className="screen-preview">还没有截取。点下面的按钮，读取你当前正在看的窗口。</div>
          ) : (
            <div className="screen-preview filled">
              <strong>{analysis.sourceWindow || '当前窗口'}</strong>
              {analysis.tree || analysis.summary}
            </div>
          )}
          <div className="screen-toolbar">
            <div><span>采集</span><strong>{analysis.resolution || (placeholder ? '还没有' : '已读取')}</strong></div>
            <Button variant="primary" onClick={() => void analyze()} disabled={busy || !allowed} icon={busy ? <Spinner size={14} /> : <ScanLine size={16} />}>
              {busy ? '正在分析…' : allowed ? '分析当前画面' : '尚未授权'}
            </Button>
          </div>
        </Card>

        <Card className="analysis-card">
          <CardHead title="分析结果" subtitle="只说明画面里有什么，不会直接操作" aside={placeholder ? undefined : <Pill tone="blue">{analysisSourceLabel(analysis.confidence)}</Pill>} />
          {busy ? (
            <div className="analysis-skeleton">
              <span /><span /><span /><span />
            </div>
          ) : placeholder ? (
            <div className="analysis-content">
              <div className="screen-preview">分析之后，结论会写在这里。</div>
            </div>
          ) : (
            <div className="analysis-content">
              <h3>{analysis.title || '当前画面'}</h3>
              <div className="analysis-summary">{analysis.summary}</div>
              {analysis.bullets.length ? (
                <>
                  <div className="subheading">需要留意</div>
                  <ul className="bullet-list">
                    {analysis.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}
                  </ul>
                </>
              ) : null}
              {analysis.needsTaskConfirm ? (
                <Button variant="primary" className="full-width" onClick={() => setTaskDialog(true)} disabled={!allowed} icon={<Sparkles size={15} />}>
                  确认是否创建任务
                </Button>
              ) : null}
              <Button className="full-width" onClick={() => navigate('/models')}>调整看图模型</Button>
            </div>
          )}
        </Card>
      </div>

      <Card className="usage-boundaries">
        <CardHead title="这次截取如何处理" subtitle="只用于你这一次的问题，不会自己拿去执行" />
        <div className="boundary-grid">
          <div><Pill tone="blue">当前问题</Pill><p>只用来回答这一次，不留下截图。</p></div>
          <div><Pill tone="violet">长期记忆</Pill><p>不会记进长期记忆。想记住的内容需要你自己添加。</p></div>
          <div><Pill tone="amber">第三方模型</Pill><p>{data.settings.outboundImages ? `截图会发给当前模型服务（${data.models.find((model) => model.default)?.name ?? '未配置'}）。可在设置里关掉。` : '截图不会发给模型，只在本机读文字。要让模型看图，到设置里打开「允许把截图发给模型」。'}</p></div>
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
