import { ScanLine, ShieldCheck, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MessageMarkdown } from '../components/MessageMarkdown'
import { TaskCreateDialog } from '../components/dialogs'
import { Button, Card, CardHead, Modal, Pill, Spinner } from '../components/ui'
import { analysisSourceLabel } from '../lib/status'
import { useAppStore } from '../store'

export function ScreenPage(): React.JSX.Element {
  const navigate = useNavigate()
  const data = useAppStore((state) => state.data)!
  const analyzeScreen = useAppStore((state) => state.analyzeScreen)
  const busy = useAppStore((state) => Boolean(state.busy['screen:analyze']))
  const notify = useAppStore((state) => state.notify)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [taskDialog, setTaskDialog] = useState(false)
  const allowed = data.settings.permissions.screen
  const analysis = data.screenAnalysis
  const preview = analysis.previewDataUrl?.startsWith('data:image/png;base64,') ? analysis.previewDataUrl : ''
  const displayText = (text: string): string => text.replace(/^\[不可信:screen\]\s?/, '')
  const observedText = analysis.observedText ?? displayText(analysis.tree || '')
  const [failure, setFailure] = useState('')
  const refused = Boolean(analysis.refusal) || analysis.confidence === '未理解'
  const placeholder = !refused && (analysis.confidence === '不可用' || analysis.title === '尚未实现' || (!analysis.summary && !analysis.sourceWindow))
  const defaultModel = data.models.find((model) => model.default)
  const capturedTime = analysis.capturedAt && !Number.isNaN(Date.parse(analysis.capturedAt)) ? new Date(analysis.capturedAt).toLocaleString('zh-CN', { hour12: false }) : ''

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
          <strong>{allowed ? '已授权 · 框选区域' : '屏幕读取尚未授权'}</strong>
          <span>{!allowed ? '授权后可手动框选需要分析的区域。' : '每次由你框选并确认，只分析选中区域，不自动截取画面。'}</span>
        </div>
        <Button size="sm" onClick={() => navigate('/settings')}>管理权限</Button>
      </div>

      <div className="screen-setup">
        <div><span>框选区域</span><strong>拖动框选 · Enter 确认 · Esc 取消</strong><p className="screen-result-note">点击下方按钮或按 {data.settings.screenHotkey} 开始框选；快捷键可在运行与隐私中修改。</p></div>
        <div><span>分析方式</span><strong>本机识别文字 → 大模型文本分析</strong><p className="screen-result-note">确认框选后，将识别文字发送给当前模型服务；截图不发送。</p></div>
        <div><span>当前模型服务</span><strong>{defaultModel ? `${defaultModel.name} · ${defaultModel.status}` : '未配置 · 可先尝试本机文字识别'}</strong><Button size="sm" onClick={() => navigate('/models')}>配置模型服务</Button></div>
      </div>
      {failure && <div className="screen-feedback" role="alert"><strong>本次分析未完成</strong><p>{failure}</p><span>下方如有内容，为上次保留的结果。</span></div>}
      <div className="screen-columns">
        <Card>
          <CardHead
            title="1. 查看截图"
            subtitle="点击截图放大，识别文字可展开查看"
            aside={<Pill tone={allowed ? 'blue' : 'gray'}>{!allowed ? '等待授权' : '手动框选'}</Pill>}
          />
          {preview ? (
            <button type="button" className="screen-image-preview" onClick={() => setPreviewOpen(true)} aria-label="放大查看截图">
              <img src={preview} alt="最近一次框选的屏幕截图" />
              <span>点击放大</span>
            </button>
          ) : (
            <div className="screen-preview">{placeholder ? '拖动框选同一显示器内的区域，确认后只分析选中部分。Esc 可取消。' : '本次没有可展示的截图，请重新框选。'}</div>
          )}
          <details className="screen-ocr" key={analysis.capturedAt}>
            <summary>识别文字</summary>
            {analysis.ocrDetail && <p className="screen-image-note">{analysis.ocrDetail}</p>}
            <div>{observedText || '未识别到文字。截图中可能没有文字，或文字不够清晰。'}</div>
          </details>
          <p className="screen-image-note">仅在内存中保留最近一张截图，新截图会替换旧截图，关闭应用后清除。</p>
          <div className="screen-toolbar">
            <div><span>最近一次采集</span><strong>{capturedTime || '暂无采集时间'}</strong><span>{analysis.sourceWindow || '尚无读取来源'}</span><span>{analysis.resolution || '暂无画面尺寸'}</span></div>
            <Button variant="primary" onClick={() => void analyze()} disabled={busy || !allowed} icon={busy ? <Spinner size={14} /> : <ScanLine size={16} />}>
              {busy ? '正在选择或分析…' : allowed ? '框选区域并分析' : '尚未授权'}
            </Button>
          </div>
        </Card>

        <Card className="analysis-card">
          <CardHead title="2. 查看分析" subtitle="展示模型基于 OCR 文字返回的内容；不要求模型支持图像" aside={placeholder ? undefined : <Pill tone="blue">{analysisSourceLabel(analysis.confidence)}</Pill>} />
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
              <div className="analysis-summary"><MessageMarkdown text={analysis.summary} showSource={false} /></div>
              {analysis.bullets.length ? (
                <>
                  <div className="subheading">需要留意</div>
                  <ul className="bullet-list">
                    {analysis.bullets.map((bullet) => <li key={bullet}>{displayText(bullet)}</li>)}
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
        <CardHead title="读取范围与数据处理" subtitle="每次分析都由你选择并确认范围" />
        <div className="boundary-grid">
          <div><Pill tone="blue">画面读取</Pill><p>只分析你手动框选并确认后的区域，不包含选区外的窗口文字。截图仅在内存中临时保留，不写入磁盘；确认后将识别文字发给当前模型分析。</p></div>
          <div><Pill tone="violet">长期记忆</Pill><p>不会记进长期记忆。想记住的内容需要你自己添加。</p></div>
          <div><Pill tone="amber">模型服务</Pill><p>仅将 OCR 文字发送给当前模型服务（{defaultModel?.name ?? '未配置'}），不会发送截图；只需支持文字对话。图片外发设置不影响本页的文字分析。</p></div>
        </div>
      </Card>

      {preview && <Modal open={previewOpen} onOpenChange={setPreviewOpen} title="框选截图" description="仅保留在内存中，关闭应用后清除。" width="min(1200px, 94vw)">
        <div className="screen-image-expanded"><img src={preview} alt="放大的框选截图" /></div>
      </Modal>}
      <TaskCreateDialog
        open={taskDialog}
        onOpenChange={setTaskDialog}
        initialTitle={analysis.title || '根据刚才的画面'}
      />
    </div>
  )
}
