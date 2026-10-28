import { Box, Eye, Globe, MonitorPlay, Play, Square, Wand2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button, Card, CardHead, EmptyState, Spinner, ToggleRow } from '../components/ui'
import { StatusPill } from '../components/StatusPill'
import type { ActivityStatus } from '../../../shared/types'
import type { CreationProgress } from '../../../shared/isolated-creation'

type ActivityResult = { ok: true; data: ActivityStatus } | { ok: false; error: string }
type Activity = '浏览网页' | '看视频' | '办公' | '写代码'

/** 离开页面再回来时，画面窗口会重新加载。带上自动连接，就不用再点一次 noVNC 的连接按钮。 */
function isolationViewSrc(url: string): string {
  if (!url) return ''
  try {
    const parsed = new URL(url)
    parsed.searchParams.set('autoconnect', '1')
    parsed.searchParams.set('resize', 'scale')
    return parsed.toString()
  } catch {
    return url
  }
}

const ACTIVITY_HINTS: Record<Activity, string> = {
  浏览网页: '打开网页后可以让它自己看、自己点，每一步都会重新截图核验。',
  看视频: '打开视频后结合实际播放进度、截帧和可用字幕观察；缺少证据时会说明。',
  办公: '根据目标生成文字文档，用LibreOffice保存、回读和审阅，完成后可导出ODT。',
  写代码: '生成自包含Python脚本，在隔离区运行、核对输出并独立审阅，完成后可导出。'
}

export function AutonomyPage(): React.JSX.Element {
  const [reason, setReason] = useState('尚未开始')
  const [notice, setNotice] = useState('')
  const [frame, setFrame] = useState('')
  const [viewUrl, setViewUrl] = useState('')
  const [notes, setNotes] = useState<string[]>([])
  const [taskStatus, setTaskStatus] = useState('与任务分开显示')
  const [running, setRunning] = useState(false)
  const [canStop, setCanStop] = useState(false)
  const [serverBusy, setServerBusy] = useState(false)
  const [environment, setEnvironment] = useState({ docker: false, image: false, detail: '点「开始活动」后会自动准备。' })
  const [buildLine, setBuildLine] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [activity, setActivity] = useState<Activity>('浏览网页')
  const [pageUrl, setPageUrl] = useState('https://example.com')
  const [goal, setGoal] = useState('')
  const [busy, setBusy] = useState('')
  const [creation, setCreation] = useState<CreationProgress>()
  const [allowNetwork, setAllowNetwork] = useState(true)

  const apply = (status: ActivityStatus): void => {
    setReason(status.reason)
    setViewUrl(status.viewUrl)
    setNotes(status.notes)
    setTaskStatus(status.taskStatus)
    setRunning(status.running)
    setCanStop(status.canStop ?? status.running)
    setServerBusy(status.busy ?? false)
    setCreation(status.creation)
    if (status.kind && status.kind !== 'manual') setActivity(({ browse: '浏览网页', video: '看视频', office: '办公', code: '写代码' } as const)[status.kind])
    if (status.goal) setGoal(status.goal)
    if (status.allowNetwork !== undefined) setAllowNetwork(status.allowNetwork)
    if (status.running) setConfirmed(true)
  }

  useEffect(() => {
    let cancelled = false
    window.murasame.autonomy.status().then((status) => {
      if (!cancelled) apply(status)
    })
    void window.murasame.autonomy.environment().then((status) => {
      if (!cancelled) setEnvironment(status)
    })
    const off = window.murasame.autonomy.onBuildProgress(setBuildLine)
    return () => {
      cancelled = true
      off()
    }
  }, [])

  useEffect(() => {
    if (!running && !canStop && !serverBusy) return
    const timer = window.setInterval(() => {
      void window.murasame.autonomy.status().then(apply)
    }, 5000)
    return () => window.clearInterval(timer)
  }, [running, canStop, serverBusy])

  useEffect(() => {
    if (!running || allowNetwork) return
    let cancelled = false
    let timer: number | undefined
    const refresh = async (): Promise<void> => {
      try {
        const result = await window.murasame.autonomy.preview()
        if (!cancelled) setFrame(result.ok ? result.data.image : '')
      } catch { if (!cancelled) setFrame('') }
      if (!cancelled) timer = window.setTimeout(() => void refresh(), 5000)
    }
    void refresh()
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [running, allowNetwork])

  const run = async (label: string, action: () => Promise<ActivityResult>): Promise<void> => {
    setBusy(label)
    setNotice('')
    try {
      const result = await action()
      if (result.ok) apply(result.data)
      else { apply(await window.murasame.autonomy.status()); setNotice(result.error) }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '操作失败，请重试')
    } finally {
      setBusy('')
    }
  }

  const start = async (): Promise<void> => {
    setBusy('正在准备隔离环境')
    setNotice(''); setFrame('')
    setBuildLine('')
    try {
      const kind = ({ 浏览网页: 'browse', 看视频: 'video', 办公: 'office', 写代码: 'code' } as const)[activity]
      const result = await window.murasame.autonomy.start({ confirmed, allowNetwork, kind })
      if (!result.ok) {
        setRunning(false)
        setNotice(result.error)
        setViewUrl('')
        return
      }
      setEnvironment(await window.murasame.autonomy.environment())
      apply(result.data)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '活动启动失败')
    } finally {
      setBusy('')
      setBuildLine('')
    }
  }

  const stop = async (): Promise<void> => {
    setBusy('正在停止')
    setNotice('')
    try {
      const result = await window.murasame.autonomy.stop()
      if (!result.ok) { apply(await window.murasame.autonomy.status()); setNotice(result.error); return }
      apply(result.data)
    } catch (error) { setNotice(error instanceof Error ? error.message : '未确认活动退出，请重试停止')
    } finally {
      setBusy('')
    }
  }

  const ready = environment.docker && environment.image
  const creating = activity === '办公' || activity === '写代码'
  const watching = activity === '看视频'
  const blocked = busy !== '' || serverBusy || Boolean(running && creation && !['ready', 'failed'].includes(creation.phase))
  const artifact = creation?.artifact
  const exportArtifact = async (): Promise<void> => {
    if (!artifact) return
    setBusy('正在导出核验产物')
    setNotice('')
    try {
      const result = await window.murasame.autonomy.exportArtifact(artifact.id)
      setNotice(result.ok ? `已保存到 ${result.data.path}` : result.error)
    } catch (error) { setNotice(error instanceof Error ? error.message : '导出失败') }
    finally { setBusy(''); setServerBusy(false) }
  }

  return (
    <div className="page autonomy-page">
      <div className={`permission-banner${ready ? '' : ' warning'}`}>
        <div className="permission-icon"><Box size={18} /></div>
        <div>
          <strong>{ready ? '隔离环境就绪' : '隔离环境会在开始时自动准备'}</strong>
          <span>{environment.detail}</span>
        </div>
      </div>

      <div className="autonomy-columns">
        <Card>
          <CardHead
            title="这次活动"
            subtitle={running ? '这次活动还在。离开这个页面不会停止，回来直接继续，不用重新开始。' : '开始前先确认范围，活动中不会改到你正在用的窗口'}
            aside={<StatusPill status={running ? 'activity-running' : 'activity-idle'} />}
          />
          <div className="autonomy-status">
            {blocked ? <Spinner size={14} /> : null}
            <p>{blocked ? (buildLine || (busy ? `${busy}…` : creation?.message || reason)) : notice || reason}</p>
          </div>
          <div className="autonomy-form">
            <label className="field">
              <span className="field-label">活动类型</span>
              <select className="select" value={activity} onChange={(event) => setActivity(event.target.value as Activity)} disabled={running || blocked}>
                <option value="浏览网页">浏览网页</option>
                <option value="看视频">看视频</option>
                <option value="办公">办公文档</option>
                <option value="写代码">Python编程</option>
              </select>
              <span className="field-hint">{ACTIVITY_HINTS[activity]}</span>
            </label>
          </div>
          <div className="autonomy-toggles">
            <ToggleRow
              title="允许隔离桌面联网"
              description="关掉之后，隔离桌面连不上外网。"
              checked={allowNetwork}
              onCheckedChange={setAllowNetwork}
              disabled={running}
            />
            <ToggleRow
              title="我确认只在隔离桌面里活动"
              description={running ? '活动最多10分钟。停止或到期会清理隔离文件，请先导出需要保留的产物。' : '不会读取宿主文件。创作目标会发送给默认文字模型；隔离桌面联网另行控制。'}
              checked={confirmed}
              onCheckedChange={setConfirmed}
              disabled={running}
            />
          </div>
          {!allowNetwork && !creating ? (
            <div className="inline-note amber-note">{activity}需要网络，这次不能开始。要么打开联网，要么换个活动类型。</div>
          ) : null}
          <div className="editor-actions">
            <Button onClick={() => void stop()} disabled={!canStop && !running && !blocked} icon={<Square size={14} />} data-testid="autonomy-stop">停止活动</Button>
            <Button
              variant="primary"
              onClick={() => void start()}
              disabled={!confirmed || (!allowNetwork && !creating) || running || blocked}
              icon={<Play size={15} />}
              data-testid="autonomy-start"
            >
              开始活动
            </Button>
          </div>
        </Card>

        <Card>
          <CardHead title="在隔离桌面里做什么" subtitle={running ? '活动还在，直接在这里继续。不用先停止再开始。' : '活动开始后才能操作'} />
          <div className="autonomy-form">
            {!creating ? <label className="field">
              <span className="field-label">{watching ? '视频网址' : '网址'}</span>
              <div className="inline-add">
                <input className="input" value={pageUrl} onChange={(event) => setPageUrl(event.target.value)} placeholder="https://" />
                <Button
                  onClick={() => void run(watching ? '正在看视频' : '正在打开网页', () => watching
                    ? window.murasame.autonomy.watch(pageUrl)
                    : window.murasame.autonomy.openPage(pageUrl))}
                  disabled={!running || !allowNetwork || blocked}
                  icon={watching ? <MonitorPlay size={14} /> : <Globe size={14} />}
                >
                  {watching ? '打开并看' : '打开'}
                </Button>
              </div>
              <span className="field-hint">只打开 http 或 https 开头的地址。</span>
            </label> : <label className="field">
              <span className="field-label">创作目标</span>
              <textarea className="textarea" value={goal} maxLength={2000} rows={4} onChange={(event) => setGoal(event.target.value)} placeholder={activity === '办公' ? '例如：写一份三天的复习安排，包含每天目标和验收方法' : '例如：计算1到100的平方和并打印结果'} disabled={blocked || Boolean(artifact)} />
              <span className="field-hint">先生成，再真实执行和独立审阅，最多修订一次。Python仅使用标准库、不能启动子进程；这不是通用项目开发入口。</span>
              <Button variant="primary" onClick={() => void run('正在创作和审阅', () => window.murasame.autonomy.create(activity === '办公' ? 'office' : 'code', goal))} disabled={!running || !goal.trim() || blocked || Boolean(artifact)} data-testid="autonomy-create">开始创作</Button>
              {creation ? <p role="status">{creation.message}</p> : null}
            </label>}

            {activity === '浏览网页' ? (
              <label className="field">
                <span className="field-label">让它自己找什么</span>
                <div className="inline-add">
                  <input className="input" value={goal} onChange={(event) => setGoal(event.target.value)} placeholder="例如：看看这页讲了什么" />
                  <Button
                    onClick={() => void run('正在隔离桌面里自己逛', () => window.murasame.autonomy.browse(goal))}
                    disabled={!running || !goal.trim() || blocked}
                    icon={<Wand2 size={14} />}
                  >
                    让它自己逛
                  </Button>
                </div>
                <span className="field-hint">需要先在设置里打开「允许把截图发给模型」。动作会用新画面核验，无有效变化会如实记录。</span>
              </label>
            ) : null}

            <Button className="full-width" onClick={() => void run('正在看隔离桌面', () => window.murasame.autonomy.look())} disabled={!running || blocked} icon={<Eye size={15} />}>
              让模型看一眼桌面
            </Button>
            <p className="fineprint">此按钮会发送截图，需先在设置中允许；下方实时画面仅在本机查看。</p>
            <p className="fineprint">{taskStatus}</p>
          </div>
        </Card>
      </div>

      {artifact ? <Card>
        <CardHead title={artifact.title} subtitle={`${artifact.name} · ${artifact.bytes.toLocaleString()} 字节 · 已真实核验`} />
        <div className="autonomy-form">
          <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 320, overflow: 'auto' }}>{artifact.preview}</pre>
          {artifact.kind === 'code' ? <p>实际输出：<code>{artifact.stdout}</code></p> : null}
          <p>独立审阅：{artifact.review}</p>
          <p className="fineprint">文件校验值：{artifact.sha256}</p>
          <Button variant="primary" onClick={() => void exportArtifact()} disabled={!running || blocked} data-testid="autonomy-export">选择位置并保存</Button>
          <p className="fineprint">请在停止或到期前保存。只新建文件，不覆盖已有资料；隔离桌面中手动改过的产物需要重新核验。</p>
        </div>
      </Card> : null}

      <Card>
        <CardHead title="隔离桌面画面" subtitle={running && !allowNetwork ? '离线实时画面，每5秒更新；这里仅查看，创作通过上方目标执行。' : viewUrl ? '画面来自容器里的虚拟桌面' : '活动开始后显示真实隔离桌面'} />
        {running && !allowNetwork
          ? frame ? <img alt="离线隔离桌面实时画面" className="autonomy-view" style={{ objectFit: 'contain' }} src={`data:image/png;base64,${frame}`} /> : <div className="autonomy-view-empty">正在读取离线桌面，许可暂停时不采集。</div>
          : viewUrl
          ? <iframe title="隔离桌面" className="autonomy-view" src={isolationViewSrc(viewUrl)} />
          : <div className="autonomy-view-empty">活动开始后显示容器桌面。</div>}
      </Card>

      <Card>
        <CardHead title="活动记录" subtitle="网页里的文字只当作看到的内容，不会当成指令执行" />
        {notes.length
          ? <ul className="bullet-list autonomy-notes">{notes.map((note, index) => <li key={`${index}-${note.slice(0, 24)}`}>{note}</li>)}</ul>
          : <EmptyState title="还没有记录" description="它每看一眼、每动一下，都会在这里留下一条，并注明有没有用新画面核验过。" />}
      </Card>
    </div>
  )
}
