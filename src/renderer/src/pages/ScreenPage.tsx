import { Eye, ScanLine, ShieldCheck, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { screenCode } from '@shared/mock-data'
import { TaskCreateDialog } from '../components/dialogs'
import { Button, Card, CardHead, Pill, Spinner } from '../components/ui'
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
          <span>{allowed ? '当前为单次截取，不会持续采集，也不会默认保留原始截图。' : '分析按钮将保持停用，授权后可进行单次画面读取。'}</span>
        </div>
        <Button size="sm" onClick={() => navigate('/settings')}>管理权限</Button>
      </div>

      <div className="screen-columns">
        <Card>
          <CardHead
            title="当前画面"
            subtitle="Visual Studio Code · main.py · 18:32"
            aside={<Pill tone="gray"><Eye size={12} />单次截取</Pill>}
          />
          <div className="code-window">
            <div className="code-titlebar">
              <span className="window-dots"><i /><i /><i /></span>
              <span>load.py — Visual Studio Code</span>
              <span>Python 3.13</span>
            </div>
            <div className="code-body">
              {screenCode.map((line) => (
                <div className={`code-line${line.error ? ' error' : ''}`} key={line.number}>
                  <span className="code-number">{line.number}</span>
                  <code>{line.text || ' '}</code>
                </div>
              ))}
            </div>
          </div>
          <div className="screen-toolbar">
            <div><span>主显示器</span><strong>2560 × 1440</strong></div>
            <Pill tone="blue">单次截取</Pill>
            <Button variant="primary" onClick={() => void analyze()} disabled={busy || !allowed} icon={busy ? <Spinner size={14} /> : <ScanLine size={16} />}>
              {busy ? '正在分析…' : '分析当前画面'}
            </Button>
          </div>
        </Card>

        <Card className="analysis-card">
          <CardHead title="分析结果" subtitle="只解释画面内容，不直接执行操作" aside={<Pill tone="green">{analysis.confidence}</Pill>} />
          {busy ? (
            <div className="analysis-skeleton">
              <span /><span /><span /><span />
            </div>
          ) : (
            <div className="analysis-content">
              <h3>{analysis.title}</h3>
              <div className="analysis-summary">{analysis.summary}</div>
              <div className="subheading">需要留意</div>
              <ul className="bullet-list">
                {analysis.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}
              </ul>
              <Button variant="primary" className="full-width" onClick={() => setTaskDialog(true)} disabled={!allowed} icon={<Sparkles size={15} />}>
                {analysis.action}
              </Button>
              <Button className="full-width" onClick={() => navigate('/models')}>调整图像模型</Button>
              <p className="fineprint">生成补丁属于文件写入，执行前会单独请求批准。</p>
            </div>
          )}
        </Card>
      </div>

      <Card className="usage-boundaries">
        <CardHead title="这次截取如何处理" subtitle="IF-09 · 数据用途与授权边界" />
        <div className="boundary-grid">
          <div><Pill tone="blue">当前问题</Pill><p>分析完成后随会话上下文清除图像引用，不写入历史缩略图。</p></div>
          <div><Pill tone="violet">长期记忆</Pill><p>不写入记忆，不参与后续召回；只保留你明确手动添加的偏好。</p></div>
          <div><Pill tone="amber">第三方模型</Pill><p>仅发送必要画面；若需上传，会先显示服务名称与数据范围。</p></div>
        </div>
      </Card>

      <TaskCreateDialog
        open={taskDialog}
        onOpenChange={setTaskDialog}
        initialTitle={`修复编码问题：${analysis.title}`}
      />
    </div>
  )
}
