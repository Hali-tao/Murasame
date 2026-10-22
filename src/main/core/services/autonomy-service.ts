import { containerPlan, containerRunning, dockerUnavailableMessage, hostPathAllowed, runInContainer, startContainer, stopContainer, xdotoolCommand } from '../../isolation/docker-runtime'
import { planActivityStep, understandVideo, ACTIVITY_LIMITS, activityLimitReason, verifyAfterAction } from '../../isolation/input-injector'
import { vncView } from '../../isolation/vnc-bridge'
import { markUntrusted } from '../../security/hardening'
import type { Result } from '../../../shared/types'

type DesktopAction =
  | { kind: 'click'; x: number; y: number }
  | { kind: 'type'; text: string }
  | { kind: 'key'; key: string }

/** 看图模型给出的下一步，结构见 desktopStepSchema。 */
export interface DesktopStep {
  kind: 'click' | 'type' | 'key' | 'done'
  x?: number
  y?: number
  text?: string
  key?: string
  note: string
}

export interface AutonomyState {
  running: boolean
  reason: string
  viewUrl: string
  notes: string[]
  taskStatus: string
  hostExecution: false
}

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function toAction(step: DesktopStep): DesktopAction | null {
  if (step.kind === 'click' && step.x !== undefined && step.y !== undefined) return { kind: 'click', x: step.x, y: step.y }
  if (step.kind === 'type' && step.text) return { kind: 'type', text: step.text }
  if (step.kind === 'key' && step.key) return { kind: 'key', key: step.key }
  return null
}

function describeAction(action: DesktopAction): string {
  if (action.kind === 'click') return `点击了 (${Math.round(action.x)}, ${Math.round(action.y)})`
  if (action.kind === 'type') return `输入了「${action.text}」`
  return `按了 ${action.key}`
}

export class AutonomyService {
  /** 注入 docker 调用和等待函数，便于在不依赖本机容器的情况下验证各条路径。 */
  constructor(
    private readonly runDocker?: (command: string, args: string[]) => string,
    private readonly wait: (ms: number) => Promise<void> = pause
  ) {}

  private containerId: string | null = null
  private startedAt = 0
  private steps = 0
  private allowNetwork = true
  private lastImage = ''
  private state: AutonomyState = {
    running: false,
    reason: '尚未开始',
    viewUrl: '',
    notes: [],
    taskStatus: '独立于任务',
    hostExecution: false
  }

  status(): AutonomyState {
    return { ...this.state, notes: [...this.state.notes] }
  }

  /** 页面轮询时调用：容器中途没了就如实记成失败，不留在「进行中」。 */
  health(): AutonomyState {
    if (this.state.running && this.containerId && !containerRunning(this.containerId, this.runDocker)) {
      this.containerId = null
      this.state = { ...this.state, running: false, reason: '活动已失败：隔离桌面已经退出（Docker 停了或容器被关掉）。没有改到宿主桌面。', viewUrl: '' }
    }
    return this.status()
  }

  start(input: { dockerAvailable: boolean; approved: boolean; needsPermission: boolean; share: string | null; allowNetwork?: boolean }): Promise<Result<AutonomyState>> {
    if (!input.approved) {
      this.state = { ...this.state, running: false, reason: '还没有确认活动范围，容器没有启动。', viewUrl: '', hostExecution: false }
      return Promise.resolve({ ok: false, error: this.state.reason })
    }
    const network = input.allowNetwork === false ? 'none' : 'bridge'
    const plan = containerPlan({ hostPath: input.share ?? '', readOnly: true, network })
    if (plan.hostExecution) return Promise.resolve({ ok: false, error: '不会在宿主执行' })
    if (!input.dockerAvailable) {
      this.state = { ...this.state, running: false, reason: dockerUnavailableMessage(), viewUrl: '', hostExecution: false }
      return Promise.resolve({ ok: false, error: this.state.reason })
    }
    const step = planActivityStep({
      controlId: 'firefox-address',
      marks: [],
      pixel: null,
      text: '打开网页后只描述看到的内容',
      sourceWidth: 1280,
      targetWidth: 1280,
      sourceHeight: 720,
      targetHeight: 720,
      approved: input.approved,
      needsPermission: input.needsPermission
    })
    if ('blocked' in step) {
      this.state = { ...this.state, running: false, reason: step.blocked, hostExecution: false }
      return Promise.resolve({ ok: false, error: step.blocked })
    }
    const started = startContainer(plan, 6901, this.runDocker)
    if ('failed' in started) {
      this.state = { ...this.state, running: false, reason: `隔离桌面没有启动：${started.failed}。不会改到宿主桌面。`, viewUrl: '', hostExecution: false }
      return Promise.resolve({ ok: false, error: this.state.reason })
    }
    this.containerId = started.id
    this.startedAt = Date.now()
    this.steps = 0
    this.allowNetwork = network === 'bridge'
    this.lastImage = ''
    const view = vncView(true, started.port)
    this.state = {
      running: true,
      reason: `活动进行中。上限 ${ACTIVITY_LIMITS.steps} 步、${ACTIVITY_LIMITS.minutes} 分钟。还没有经模型看过的画面。`,
      viewUrl: view.url,
      notes: [],
      taskStatus: '这不是任务状态',
      hostExecution: false
    }
    return Promise.resolve({ ok: true, data: this.status() })
  }

  openPage(url: string): Result<AutonomyState> {
    if (!this.state.running || !this.containerId) {
      return { ok: false, error: '活动还没开始，没有在你正在用的桌面上打开网页。' }
    }
    if (!/^https?:\/\//i.test(url)) {
      return { ok: false, error: '只打开以 http 或 https 开头的地址。' }
    }
    if (!this.allowNetwork) {
      return { ok: false, error: '这次活动没有联网，打不开网页。容器仍停在隔离桌面里。' }
    }
    const limit = this.limit()
    if (limit) return limit
    try {
      runInContainer(this.containerId, ['firefox-esr', '--new-tab', url], this.runDocker, { desktop: true, detach: true })
      this.steps += 1
      this.state = { ...this.state, reason: '活动进行中' }
      this.note(`在隔离桌面打开了 ${url}`)
      return { ok: true, data: this.status() }
    } catch (error) {
      return this.fail(error instanceof Error ? error.message : '无法在隔离桌面打开网页')
    }
  }

  async look(describe?: (image: string) => Promise<string>): Promise<Result<AutonomyState>> {
    if (!this.state.running || !this.containerId) {
      return { ok: false, error: '活动还没开始，没有去截你正在用的桌面。' }
    }
    const limit = this.limit()
    if (limit) return limit
    try {
      const image = this.capture()
      const check = verifyAfterAction(this.lastImage, image)
      this.lastImage = image
      this.steps += 1
      let seen = '已截到隔离桌面画面，还没有交给看图模型。'
      if (describe) {
        const text = (await describe(image)).trim()
        seen = text ? markUntrusted(text, 'web') : '看图模型没有返回内容。'
      }
      this.state = { ...this.state, reason: check.verified ? '活动进行中' : '活动进行中，这一步画面没有变化，没有记成完成。' }
      this.note(`${seen} ${check.note}`)
      return { ok: true, data: this.status() }
    } catch (error) {
      return this.fail(error instanceof Error ? error.message : '截取隔离桌面失败')
    }
  }

  act(action: DesktopAction): Result<AutonomyState> {
    if (!this.state.running || !this.containerId) {
      return { ok: false, error: '活动还没开始，没有在你正在用的桌面上点击。' }
    }
    const limit = this.limit()
    if (limit) return limit
    try {
      runInContainer(this.containerId, xdotoolCommand(action), this.runDocker, { desktop: true })
      this.steps += 1
      this.note(`在隔离桌面${describeAction(action)}。还要用新画面核验。`)
      return { ok: true, data: this.status() }
    } catch (error) {
      return this.fail(error instanceof Error ? error.message : '隔离桌面里的动作失败')
    }
  }

  /**
   * 截图 → 模型决定下一步 → 在容器里执行 → 再截图核验。
   * 画面没变就重试，最多两次，仍没变就记为未生效，不当成完成。
   */
  async browse(
    goal: string,
    decide: (image: string, goal: string, notes: readonly string[]) => Promise<DesktopStep>,
    maxSteps = 6
  ): Promise<Result<AutonomyState>> {
    if (!this.state.running || !this.containerId) {
      return { ok: false, error: '活动还没开始，没有去操作你正在用的桌面。' }
    }
    try {
      let before = this.capture()
      let badReplies = 0
      for (let index = 0; index < maxSteps; index += 1) {
        let step: DesktopStep
        try {
          step = await decide(before, goal, this.state.notes)
        } catch (error) {
          badReplies += 1
          const detail = error instanceof Error && error.message && !/Unexpected|JSON|token/i.test(error.message)
            ? error.message
            : '回复不是完整的一步'
          this.note(`这一步没有执行：${detail}。隔离桌面还在，没有停止。`)
          if (badReplies >= 2) {
            this.note('连续两次都没有拿到能执行的动作，先停在这里，没有记成完成。')
            return { ok: true, data: this.status() }
          }
          continue
        }
        badReplies = 0
        if (step.kind === 'done') {
          this.note(markUntrusted(step.note, 'web'))
          return { ok: true, data: this.status() }
        }
        const action = toAction(step)
        if (!action) {
          this.note(`模型给的「${step.kind}」缺少参数，没有执行。`)
          continue
        }
        let verified = false
        for (let attempt = 0; attempt < 3 && !verified; attempt += 1) {
          const acted = this.act(action)
          if (!acted.ok) return acted
          await this.wait(1200)
          const after = this.capture()
          const check = verifyAfterAction(before, after)
          verified = check.verified
          before = after
          this.note(`${describeAction(action)}。${markUntrusted(step.note, 'web')} ${check.note}`)
        }
        if (!verified) this.note('这一步重试两次画面都没有变化，记为未生效，没有当成完成。')
      }
      this.note(`走了 ${maxSteps} 步还没有完成目标，先停在这里，没有记成完成。`)
      return { ok: true, data: this.status() }
    } catch (error) {
      return this.fail(error instanceof Error ? error.message : '隔离桌面里的浏览中断了')
    }
  }

  /** 打开视频后按固定间隔截帧，相同的帧只看一次。不读取字幕轨，结论里会说明。 */
  async watchVideo(url: string, describe: (image: string) => Promise<string>, frames = 6, intervalMs = 5000): Promise<Result<AutonomyState>> {
    const opened = this.openPage(url)
    if (!opened.ok) return opened
    try {
      await this.wait(4000)
      const seen: string[] = []
      let last = ''
      for (let index = 0; index < frames; index += 1) {
        const image = this.capture()
        if (image !== last) {
          const text = (await describe(image)).trim()
          if (text) seen.push(text)
          last = image
        }
        if (index < frames - 1) await this.wait(intervalMs)
      }
      this.note(seen.length
        ? markUntrusted(`每 ${intervalMs / 1000} 秒截一帧，共 ${frames} 帧，相同画面只看一次，没有读取字幕轨：\n${seen.map((text, index) => `${index + 1}. ${text}`).join('\n')}`, 'video')
        : '截到的画面都一样，或者看图模型没有返回内容，说不出视频讲了什么。')
      return { ok: true, data: this.status() }
    } catch (error) {
      return this.fail(error instanceof Error ? error.message : '看视频时隔离桌面中断了')
    }
  }

  stop(input: { containerGone: boolean }): Promise<Result<AutonomyState>> {
    this.state = { ...this.state, reason: '正在停止' }
    let exited = true
    if (this.containerId) {
      exited = stopContainer(this.containerId, this.runDocker)
      this.containerId = null
    }
    this.state = {
      running: false,
      reason: input.containerGone
        ? '隔离环境已失效，依赖它的活动已停止'
        : exited ? '容器已退出，活动已结束。' : '已经不再操作隔离桌面，但没能确认容器退出。请在 Docker Desktop 里检查 murasame-isolation 容器。',
      viewUrl: '',
      notes: this.state.notes,
      taskStatus: '任务状态不受影响',
      hostExecution: false
    }
    return Promise.resolve({ ok: true, data: this.status() })
  }

  discuss(frames: string[], captions: string[]): string {
    const limit = activityLimitReason(this.steps + 1, this.startedAt ? Date.now() - this.startedAt : 0)
    this.steps += 1
    if (limit) {
      this.state = { ...this.state, running: false, reason: limit, viewUrl: '' }
      return limit
    }
    const summary = understandVideo(frames, captions)
    this.state = { ...this.state, notes: [...this.state.notes, summary] }
    return summary
  }

  canUseHostFile(candidate: string, explicitShare: string | null): boolean {
    return hostPathAllowed(candidate, explicitShare)
  }

  private capture(): string {
    if (!this.containerId) throw new Error('隔离桌面已经不在了')
    runInContainer(this.containerId, ['scrot', '-o', '/tmp/murasame-shot.png'], this.runDocker, { desktop: true })
    const image = runInContainer(this.containerId, ['base64', '-w', '0', '/tmp/murasame-shot.png'], this.runDocker).trim()
    if (!image) throw new Error('没有截到隔离桌面的画面')
    return image
  }

  private limit(): Result<AutonomyState> | null {
    const reason = activityLimitReason(this.steps + 1, this.startedAt ? Date.now() - this.startedAt : 0)
    if (!reason) return null
    this.state = { ...this.state, running: false, reason, viewUrl: '' }
    return { ok: false, error: reason }
  }

  private note(text: string): void {
    this.state = { ...this.state, notes: [...this.state.notes, text], hostExecution: false }
  }

  private fail(message: string): Result<AutonomyState> {
    this.state = { ...this.state, running: false, reason: `活动已失败：${message}。没有改到宿主桌面。`, viewUrl: '' }
    return { ok: false, error: this.state.reason }
  }
}
