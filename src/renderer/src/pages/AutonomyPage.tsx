import { Box, Eye, Globe, MonitorPlay, Play, Square, Wand2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button, Card, CardHead, EmptyState, Spinner, ToggleRow } from '../components/ui'
import { StatusPill } from '../components/StatusPill'

type ActivityStatus = { running: boolean; reason: string; viewUrl: string; notes: string[]; taskStatus: string }
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
  看视频: '打开视频后按固定间隔截帧交给看图模型，不读字幕轨。',
  办公: '还没有实现。隔离镜像里也没有装办公软件。',
  写代码: '还没有实现。隔离镜像里也没有装编辑器。'
}

export function AutonomyPage(): React.JSX.Element {
  const [reason, setReason] = useState('尚未开始')
  const [viewUrl, setViewUrl] = useState('')
  const [notes, setNotes] = useState<string[]>([])
  const [taskStatus, setTaskStatus] = useState('与任务分开显示')
  const [running, setRunning] = useState(false)
  const [environment, setEnvironment] = useState({ docker: false, image: false, detail: '点「开始活动」后会自动准备。' })
  const [buildLine, setBuildLine] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [activity, setActivity] = useState<Activity>('浏览网页')
  const [pageUrl, setPageUrl] = useState('https://example.com')
  const [goal, setGoal] = useState('')
  const [busy, setBusy] = useState('')
  const [allowNetwork, setAllowNetwork] = useState(true)

  const apply = (status: ActivityStatus): void => {
    setReason(status.reason)
    setViewUrl(status.viewUrl)
    setNotes(status.notes)
    setTaskStatus(status.taskStatus)
    setRunning(status.running)
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
    if (!running) return
    const timer = window.setInterval(() => {
      void window.murasame.autonomy.status().then(apply)
    }, 5000)
    return () => window.clearInterval(timer)
  }, [running])

  const run = async (label: string, action: () => Promise<ActivityResult>): Promise<void> => {
    setBusy(label)
    try {
      const result = await action()
      if (result.ok) apply(result.data)
      else setReason(result.error)
    } finally {
      setBusy('')
    }
  }

  const start = async (): Promise<void> => {
    setBusy('正在准备隔离环境')
    setBuildLine('')
    try {
      const result = await window.murasame.autonomy.start({ confirmed, allowNetwork })
      if (!result.ok) {
        setRunning(false)
        setReason(result.error)
        setViewUrl('')
        return
      }
      setEnvironment(await window.murasame.autonomy.environment())
      apply(result.data)
    } finally {
      setBusy('')
      setBuildLine('')
    }
  }

  const stop = async (): Promise<void> => {
    setBusy('正在停止')
    try {
      const result = await window.murasame.autonomy.stop()
      if (!result.ok) return
      setRunning(false)
      setReason(result.data.reason)
      setViewUrl('')
      setTaskStatus(result.data.taskStatus)
    } finally {
      setBusy('')
    }
  }

  const ready = environment.docker && environment.image
  const supported = activity === '浏览网页' || activity === '看视频'
  const watching = activity === '看视频'
  const blocked = busy !== ''

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
            <p>{blocked ? (buildLine || `${busy}…`) : reason}</p>
          </div>
          <div className="autonomy-form">
            <label className="field">
              <span className="field-label">活动类型</span>
              <select className="select" value={activity} onChange={(event) => setActivity(event.target.value as Activity)} disabled={running}>
                <option value="浏览网页">浏览网页</option>
                <option value="看视频">看视频</option>
                <option value="办公">办公软件（未实现）</option>
                <option value="写代码">写代码（未实现）</option>
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
              description={running ? '这次已经确认过。只有点「停止活动」才会关掉隔离桌面。' : '不确认就不会启动容器。'}
              checked={confirmed}
              onCheckedChange={setConfirmed}
              disabled={running}
            />
          </div>
          {!allowNetwork && supported ? (
            <div className="inline-note amber-note">{activity}需要网络，这次不能开始。要么打开联网，要么换个活动类型。</div>
          ) : null}
          {!supported ? (
            <div className="inline-note amber-note">{activity}还没有实现，不会假装开始。</div>
          ) : null}
          <div className="editor-actions">
            <Button onClick={() => void stop()} disabled={!running && !blocked} icon={<Square size={14} />} data-testid="autonomy-stop">停止活动</Button>
            <Button
              variant="primary"
              onClick={() => void start()}
              disabled={!confirmed || !supported || !allowNetwork || running || blocked}
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
            <label className="field">
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
            </label>

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
                <span className="field-hint">需要先在设置里打开「允许把截图发给模型」。画面没有变化会重试，连着两次都没变就记为未生效。</span>
              </label>
            ) : null}

            <Button className="full-width" onClick={() => void run('正在看隔离桌面', () => window.murasame.autonomy.look())} disabled={!running || blocked} icon={<Eye size={15} />}>
              看一眼隔离桌面
            </Button>
            <p className="fineprint">{taskStatus}</p>
          </div>
        </Card>
      </div>

      <Card>
        <CardHead title="隔离桌面画面" subtitle={viewUrl ? '画面来自容器里的虚拟桌面' : '隔离环境不可用时这里保持空白，不会改去控制你正在用的桌面'} />
        {viewUrl
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
