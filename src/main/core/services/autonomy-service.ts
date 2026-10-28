import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { CREATION_LIMITS, creationDraftSchema, creationReviewSchema, creationRequest, readCreation, runCreation, verifyCreationEvidence, type CreationAgents, type CreationEvidence } from '../../isolation/creation'
import type { CreationKind, CreationProgress } from '../../../shared/isolated-creation'
import { containerPlan, containerRunningAsync, dockerUnavailableMessage, hostPathAllowed, runInContainerAsync, startContainerAsync, stopContainerAsync, xdotoolCommand, type DockerRunner } from '../../isolation/docker-runtime'
import { understandVideo, ACTIVITY_LIMITS, activityLimitReason, verifyAfterAction, type ActionExpectation } from '../../isolation/input-injector'
import { decodeFrame } from '../../isolation/frame-evidence'
import { observeBrowser, type BrowserObservation } from '../../isolation/browser-observation'
import { vncView } from '../../isolation/vnc-bridge'
import { markUntrusted } from '../../security/hardening'
import type { Result } from '../../../shared/types'

type DesktopAction = { kind: 'click'; x: number; y: number } | { kind: 'type'; text: string } | { kind: 'key'; key: string }
export interface DesktopStep {
  kind: 'click' | 'type' | 'key' | 'done'
  x?: number
  y?: number
  text?: string
  key?: string
  note: string
  expected?: ActionExpectation
}
export interface ActivityObservation {
  text: string
  source: string
  capturedAt: string
  mediaTime?: number
  captions?: string[]
  audio?: { start: number; end: number; transcript: string }
}
export interface ActivityResult {
  activityId: string
  kind: 'manual' | 'browse' | 'video' | CreationKind
  status: 'completed' | 'partial' | 'failed' | 'cancelled' | 'limited'
  goal: string
  sources: string[]
  observations: ActivityObservation[]
  summary: string
  limitations: string[]
  startedAt: string
  finishedAt: string
  cleanupSucceeded: boolean
}
export interface AutonomyState {
  running: boolean
  phase: 'idle' | 'preparing' | 'running' | 'stopping' | 'stopped' | 'failed'
  activityId: string
  goal: string
  reason: string
  viewUrl: string
  notes: string[]
  taskStatus: string
  hostExecution: false
  result?: ActivityResult
  creation?: CreationProgress
  kind?: ActivityResult['kind']
  allowNetwork?: boolean
  canStop?: boolean
  busy?: boolean
}
export type ActivityBoundary = 'start' | 'capture' | 'send' | 'action' | 'generate'
export interface AutonomyDependencies {
  guard?: (boundary: ActivityBoundary, signal: AbortSignal) => boolean | Promise<boolean>
  onComplete?: (result: ActivityResult) => void | Promise<void>
  observe?: (containerId: string, options: { signal: AbortSignal; play: boolean; recordAudioSeconds?: number; expectedUrl?: string; contextId?: string }) => Promise<BrowserObservation>
  transcribeMediaAudio?: (samples: Float32Array, signal: AbortSignal) => Promise<string>
  creationAllowed?: () => boolean
}
interface ActivityRun {
  id: string
  abort: AbortController
  containerId: string | null
  starting?: Promise<Result<AutonomyState>>
  cleanup?: Promise<Result<AutonomyState>>
  startedAt: number
  steps: number
  allowNetwork: boolean
  lastImage: string
  browserContextId?: string
  busy: boolean
  finished: boolean
  kind: ActivityResult['kind']
  goal: string
  sources: string[]
  observations: ActivityObservation[]
  limitations: string[]
  deadline?: NodeJS.Timeout
  created?: { evidence: CreationEvidence; id: string; attempt: number; kind: CreationKind }
}
const pause = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))
class CancelledActivity extends Error {}
class ActivityLimit extends Error {}

function toAction(step: DesktopStep): DesktopAction | null {
  if (step.kind === 'click' && Number.isFinite(step.x) && Number.isFinite(step.y) && step.x! >= 0 && step.y! >= 0) return { kind: 'click', x: step.x!, y: step.y! }
  if (step.kind === 'type' && step.text) return { kind: 'type', text: step.text }
  if (step.kind === 'key' && step.key) return { kind: 'key', key: step.key }
  return null
}
function describeAction(action: DesktopAction): string {
  if (action.kind === 'click') return `点击了 (${Math.round(action.x)}, ${Math.round(action.y)})`
  if (action.kind === 'type') return '输入了文字'
  return `按了 ${action.key}`
}

export class AutonomyService {
  constructor(private readonly runDocker?: DockerRunner, private readonly wait: (ms: number) => Promise<void> = pause, private deps: AutonomyDependencies = {}) {}
  private current: ActivityRun | null = null
  private state: AutonomyState = { running: false, phase: 'idle', activityId: '', goal: '', reason: '尚未开始', viewUrl: '', notes: [], taskStatus: '独立于任务', hostExecution: false }

  configure(deps: AutonomyDependencies): void { this.deps = { ...this.deps, ...deps } }
  status(): AutonomyState { return { ...structuredClone(this.state), canStop: Boolean(this.current && (this.current.containerId || this.state.phase === 'preparing' || this.state.phase === 'stopping')), busy: Boolean(this.current?.busy) } }

  async health(): Promise<AutonomyState> {
    const run = this.current
    if (run && this.live(run) && run.containerId && !await containerRunningAsync(run.containerId, this.runDocker, { signal: run.abort.signal })) {
      if (this.live(run)) await this.finish(run, 'failed', '隔离桌面已经退出（Docker 停了或容器被关掉）')
    }
    return this.status()
  }

  start(input: { dockerAvailable: boolean; approved: boolean; needsPermission: boolean; share: string | null; allowNetwork?: boolean; kind?: ActivityResult['kind'] }): Promise<Result<AutonomyState>> {
    if (this.current && (this.state.phase === 'preparing' || this.state.phase === 'running' || this.state.phase === 'stopping' || this.current.containerId)) return Promise.resolve({ ok: false, error: '已有活动正在启动、运行或清理，请先结束它。' })
    if (!input.approved || !input.dockerAvailable) {
      const error = !input.approved ? '还没有确认活动范围，容器没有启动。' : dockerUnavailableMessage()
      this.state = { ...this.state, running: false, phase: 'failed', reason: error, viewUrl: '' }
      return Promise.resolve({ ok: false, error })
    }
    const run: ActivityRun = { id: randomUUID(), abort: new AbortController(), containerId: null, startedAt: Date.now(), steps: 0, allowNetwork: input.allowNetwork !== false, lastImage: '', busy: false, finished: false, kind: 'manual', goal: '', sources: [], observations: [], limitations: [] }
    this.current = run
    run.kind = input.kind ?? 'manual'
    this.state = { running: false, phase: 'preparing', activityId: run.id, goal: '', kind: run.kind, allowNetwork: run.allowNetwork, reason: '正在准备隔离桌面', viewUrl: '', notes: [], taskStatus: '独立于任务', hostExecution: false }
    run.starting = this.begin(run, input.share)
    return run.starting
  }

  private async begin(run: ActivityRun, share: string | null): Promise<Result<AutonomyState>> {
    try {
      await this.check(run, 'start', false)
      const started = await startContainerAsync(containerPlan({ hostPath: share ?? '', readOnly: true, network: run.allowNetwork ? 'bridge' : 'none' }), 6901, this.runDocker, { signal: run.abort.signal, wait: this.wait })
      if ('failed' in started) {
        run.containerId = started.id ?? null
        if (!this.live(run)) return { ok: false, error: '活动准备已取消' }
        return this.finish(run, 'failed', `隔离桌面没有启动：${started.failed}`)
      }
      run.containerId = started.id
      await this.check(run, 'start', false)
      this.state = { ...this.state, running: true, phase: 'running', reason: `活动进行中。上限 ${ACTIVITY_LIMITS.steps} 次动作/观察请求、${ACTIVITY_LIMITS.minutes} 分钟。`, viewUrl: run.allowNetwork ? vncView(true, started.port).url : '' }
      run.deadline = setTimeout(() => { void this.finish(run, 'limited', `已到 ${ACTIVITY_LIMITS.minutes} 分钟上限，活动停止，没有记成完成。`) }, Math.max(1, ACTIVITY_LIMITS.minutes * 60000 - (Date.now() - run.startedAt)))
      run.deadline.unref?.()
      return { ok: true, data: this.status() }
    } catch (error) {
      if (!this.live(run)) return { ok: false, error: '活动准备已取消' }
      return this.finish(run, error instanceof CancelledActivity ? 'cancelled' : 'failed', error instanceof Error ? error.message : '活动准备失败')
    }
  }

  async openPage(url: string): Promise<Result<AutonomyState>> { return this.operate(async run => {
    if (run.created) return { ok: false, error: '请先导出并结束当前创作，再开始网页活动' }
    await this.navigate(run, url); return { ok: true, data: this.status() }
  }) }

  async preview(): Promise<Result<{ image: string }>> {
    const run = this.current
    if (!run || !this.live(run) || !run.containerId) return { ok: false, error: '没有运行中的隔离桌面' }
    try {
      await this.check(run, 'capture', false)
      const path = `/tmp/murasame-preview-${run.id}.png`
      await runInContainerAsync(run.containerId, ['scrot', '-o', path], this.runDocker, { desktop: true, signal: run.abort.signal, timeoutMs: 8000 })
      const image = (await runInContainerAsync(run.containerId, ['base64', '-w', '0', path], this.runDocker, { signal: run.abort.signal, timeoutMs: 8000 })).trim()
      await this.check(run, 'capture', false)
      if (!decodeFrame(image)) throw new Error('隔离桌面画面无法读取')
      return { ok: true, data: { image } }
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : '画面暂时不可用' } }
  }

  async look(describe?: (image: string, signal?: AbortSignal) => Promise<string>): Promise<Result<AutonomyState>> {
    return this.operate(async run => {
      const image = await this.capture(run)
      if (describe) {
        await this.check(run, 'send')
        const text = (await describe(image, run.abort.signal)).trim()
        await this.check(run, 'send', false)
        if (!text) throw new Error('看图模型没有返回内容')
        this.observe(run, text)
        this.note(run, markUntrusted(text, 'web'))
      } else this.note(run, '已截到隔离桌面画面，还没有交给看图模型；尚未核验任何动作结果。')
      return { ok: true, data: this.status() }
    })
  }

  async act(action: DesktopAction): Promise<Result<AutonomyState>> {
    return this.operate(async run => { await this.perform(run, action); return { ok: true, data: this.status() } })
  }

  async browse(goal: string, decide: (image: string, goal: string, notes: readonly string[], signal?: AbortSignal) => Promise<DesktopStep>, maxSteps = 6): Promise<Result<AutonomyState>> {
    return this.operate(async run => {
      if (run.created) return { ok: false, error: '请先导出并结束当前创作，再开始浏览' }
      run.kind = 'browse'; run.goal = goal; this.state = { ...this.state, goal }
      let before = await this.capture(run)
      for (let index = 0; index < Math.max(1, Math.min(maxSteps, ACTIVITY_LIMITS.steps)); index++) {
        await this.check(run, 'send')
        const step = await decide(before, goal, [...this.state.notes], run.abort.signal)
        this.assertCurrent(run)
        if (step.kind === 'done') {
          const facts = await this.browserFacts(run)
          const check = verifyAfterAction(before, before, step.expected, facts ?? undefined)
          if (facts) this.observe(run, facts.text.slice(0, 4000), facts.url)
          this.note(run, `${markUntrusted(step.note, 'web')} ${check.note}`)
          return this.finish(run, check.verified ? 'completed' : 'partial', check.verified ? '已核验预期结果，浏览活动结束。' : '浏览已停止，模型声明缺少独立目标证据，没有记成完成。')
        }
        const action = toAction(step)
        if (!action) throw new Error('模型没有给出完整、有效的桌面动作')
        await this.perform(run, action)
        await this.wait(1200); this.assertCurrent(run)
        const after = await this.capture(run)
        const facts = await this.browserFacts(run)
        const check = verifyAfterAction(before, after, step.expected, facts ?? undefined)
        if (facts) this.observe(run, facts.text.slice(0, 4000), facts.url)
        this.note(run, `${describeAction(action)}。${markUntrusted(step.note, 'web')} ${check.note}`)
        if (!check.verified) {
          run.limitations.push('动作已发送，但预期结果无法独立确认；没有重复执行有副作用的动作。')
          return this.finish(run, 'partial', '预期结果尚未核实，活动已停止，没有重复点击或输入。')
        }
        before = after
      }
      return this.finish(run, 'partial', '本轮浏览已到观察次数，目标没有核实完成。')
    })
  }

  async watchVideo(url: string, describe: (image: string, signal?: AbortSignal) => Promise<string>, frames = 6, intervalMs = 5000): Promise<Result<AutonomyState>> {
    return this.operate(async run => {
      if (run.created) return { ok: false, error: '请先导出并结束当前创作，再开始视频活动' }
      run.kind = 'video'; run.goal = `观看 ${url}`; this.state = { ...this.state, goal: run.goal }
      await this.navigate(run, url)
      await this.wait(1500); this.assertCurrent(run)
      await this.check(run, 'action')
      let facts = await this.browserFacts(run, true)
      if (!facts?.media || facts.media.paused || facts.media.ready < 2) throw new Error('没有确认视频正在播放；可能需要登录、手动播放，或页面没有可访问的视频播放器。')
      const startTime = facts.media.time
      const mediaSource = facts.media.source; const pageSource = facts.url
      if (!mediaSource) throw new Error('播放器没有提供可确认的媒体来源')
      let lastTime = startTime; let lastDigest = ''; let advanced = false
      const wantedFrames = Math.max(2, Math.min(frames, 6)); const interval = Math.max(250, intervalMs) / 1000
      run.limitations.push(this.deps.transcribeMediaAudio ? '只总结实际确认播放并采样的媒体区间和成功转写的短音频片段，不能代表完整视频。' : '只总结实际确认播放并采样的媒体区间；未转写音轨，不能代表完整视频。')
      for (let index = 0; index < wantedFrames; index++) {
        if (index > 0) {
          let reached = false
          for (let poll = 0; poll < 20; poll++) {
            await this.wait(Math.min(intervalMs, 500)); this.assertCurrent(run)
            await this.check(run, 'capture', false)
            facts = await this.browserFacts(run)
            if (!facts?.media || facts.media.paused && !facts.media.ended) throw new Error('视频播放已暂停或无法确认播放器状态，没有继续声称已观看。')
            if (facts.media.time > lastTime + 0.1) advanced = true
            if (facts.media.time >= startTime + index * interval || facts.media.ended) { reached = true; break }
          }
          if (!reached) throw new Error('视频媒体时间没有按预期推进，不能把网页截图当作视频观看。')
        }
        let audioObservation: ActivityObservation['audio']
        if (this.deps.transcribeMediaAudio && facts!.media!.captions.length === 0) {
          const audioFacts = await this.browserFacts(run, false, Math.min(interval, 3))
          if (audioFacts?.audio?.pcm) {
            const audio = audioFacts.audio
            const raw = Buffer.from(audio.pcm, 'base64')
            if (raw.length < 32000 || raw.length > 16000 * 4 * 4 || raw.length % 4) throw new Error('媒体音轨采样长度无效')
            const samples = new Float32Array(raw.length / 4)
            for (let i = 0; i < samples.length; i++) { const sample = raw.readFloatLE(i * 4); if (!Number.isFinite(sample) || Math.abs(sample) > 1.01) throw new Error('媒体音轨采样值无效'); samples[i] = sample }
            await this.check(run, 'capture', false)
            try {
              const transcript = (await this.deps.transcribeMediaAudio(samples, run.abort.signal)).trim()
              await this.check(run, 'capture', false)
              if (transcript) audioObservation = { start: audio.start, end: audio.end, transcript: markUntrusted(transcript, 'video') }
              else run.limitations.push(`音频 ${audio.start.toFixed(1)}–${audio.end.toFixed(1)} 秒未得到有效转写。`)
            } catch (error) {
              this.assertCurrent(run)
              if (error instanceof CancelledActivity || error instanceof ActivityLimit) throw error
              run.limitations.push(`媒体音轨未能本地转写：${error instanceof Error ? error.message : '识别不可用'}`)
            }
            facts = audioFacts
          } else if (!run.limitations.some(s => s.includes('媒体音轨没有'))) run.limitations.push(`媒体音轨没有成功读取：${audioFacts?.audio?.error ?? '播放器未提供可采集的音轨'}`)
        }
        const media = facts!.media!
        if (facts!.url !== pageSource || media?.source !== mediaSource) throw new Error('播放器媒体来源已变化，可能进入广告或另一段视频，已停止本次记录。')
        if (!media || media.time < lastTime) throw new Error('媒体时间回退，已停止并保留实际覆盖范围。')
        const image = await this.capture(run)
        const decoded = decodeFrame(image)!
        const captions = media.captions.filter(c => Number.isFinite(c.start) && Number.isFinite(c.end) && c.start <= media.time && c.end > lastTime).map(c => c.text).filter(Boolean)
        let text = ''
        if (decoded.digest !== lastDigest) {
          await this.check(run, 'send')
          text = (await describe(image, run.abort.signal)).trim(); await this.check(run, 'send', false)
          if (!text) throw new Error('视频画面模型没有返回内容')
          lastDigest = decoded.digest
        }
        if (text || captions.length || audioObservation) this.observe(run, text || '当前画面与上一采样一致', facts!.url, media.time, captions, audioObservation)
        lastTime = media.time
        if (!audioObservation && media.audioAvailable !== true && !run.limitations.some(s => s.includes('音轨可用性'))) run.limitations.push('音轨可用性未确认；没有分析音频。')
        if (media.captionTracks === 0 && !run.limitations.some(s => s.includes('字幕轨'))) run.limitations.push('没有可访问的字幕轨，字幕内容未纳入总结。')
        if (media.ended) break
      }
      if (!advanced) throw new Error('没有确认媒体时间推进，不能声称已经观看视频。')
      this.note(run, markUntrusted(`已确认播放区间 ${startTime.toFixed(1)}–${lastTime.toFixed(1)} 秒。\n${run.observations.map(o => `[${o.mediaTime?.toFixed(1)}秒] ${o.text}${o.captions?.length ? ` 字幕：${o.captions.join(' ')}` : ''}${o.audio ? ` 音频 ${o.audio.start.toFixed(1)}–${o.audio.end.toFixed(1)} 秒：${o.audio.transcript}` : ''}`).join('\n')}`, 'video'))
      const complete = startTime <= 0.2 && facts?.media?.ended === true && run.observations.some(o => o.captions?.length || o.audio)
      const coverage = `${startTime.toFixed(1)}–${lastTime.toFixed(1)} 秒`
      return this.finish(run, complete ? 'completed' : 'partial', complete ? `已确认从开头播放至结束，记录区间 ${coverage}，已读取字幕或采样音轨。` : `只观看并记录了 ${coverage}，未声称看完整个视频。`)
    })
  }

  async produce(kind: CreationKind, goal: string, agents: CreationAgents): Promise<Result<AutonomyState>> {
    if (!['office', 'code'].includes(kind) || !goal.trim() || goal.length > 2000) return { ok: false, error: '请填写不超过2000字的创作目标' }
    return this.operate(async run => {
      if (run.created) return { ok: false, error: '本次已有核验产物，请先导出并结束活动，再开始新的创作' }
      run.kind = kind; run.goal = goal.trim(); this.state = { ...this.state, goal: run.goal, kind }
      const controller = new AbortController()
      const cancel = (): void => controller.abort(run.abort.signal.reason)
      run.abort.signal.addEventListener('abort', cancel, { once: true })
      const timer = setTimeout(() => controller.abort(new ActivityLimit('创作已到180秒上限')), CREATION_LIMITS.milliseconds)
      let calls = 0; let feedback = ''
      const control = { signal: controller.signal, beforeSend: (): void => {
        this.assertCurrent(run); controller.signal.throwIfAborted()
        if (this.deps.creationAllowed?.() === false) controller.abort(new CancelledActivity('创作许可已撤回'))
        else if (calls >= CREATION_LIMITS.modelCalls) controller.abort(new ActivityLimit('已到6次实际模型请求上限'))
        controller.signal.throwIfAborted()
        calls++
      } }
      const phase = (value: CreationProgress['phase'], message: string): void => {
        this.assertCurrent(run); controller.signal.throwIfAborted()
        this.state = { ...this.state, creation: { phase: value, message }, reason: message }
      }
      this.note(run, `创作与独立审阅固定使用 ${agents.modelName}，最多一次修订；产物先留在隔离区。`)
      try {
        for (let attempt = 0; attempt < CREATION_LIMITS.attempts; attempt++) {
          await this.check(run, 'generate')
          phase('drafting', attempt ? '根据核验结果修订候选' : '正在生成候选内容')
          const draft = creationDraftSchema.parse(await creationRequest(() => agents.draft({ kind, goal: run.goal, ...(feedback ? { feedback } : {}) }, control), controller.signal))
          this.assertCurrent(run); controller.signal.throwIfAborted()
          await this.check(run, 'action')
          phase('executing', kind === 'office' ? '正在用LibreOffice保存并回读文档' : '正在隔离区运行Python并核对输出')
          let evidence: CreationEvidence
          try {
            evidence = await runCreation(run.containerId!, run.id, attempt, kind, draft, this.runDocker, controller.signal)
            verifyCreationEvidence(kind, draft, evidence)
          } catch (error) {
            this.assertCurrent(run); controller.signal.throwIfAborted()
            feedback = `确定性核验失败：${error instanceof Error ? error.message : '运行错误'}`.slice(0, 2400)
            this.note(run, feedback)
            if (attempt + 1 < CREATION_LIMITS.attempts) continue
            throw new Error(feedback, { cause: error })
          }
          await this.check(run, 'generate')
          phase('reviewing', '独立审阅正在核对目标、候选和实际执行证据')
          const report = { name: evidence.name, bytes: evidence.bytes, sha256: evidence.sha256, text: evidence.text, stdout: evidence.stdout, stderr: evidence.stderr, exitCode: evidence.exitCode, timedOut: evidence.timedOut }
          const review = creationReviewSchema.parse(await creationRequest(() => agents.review({ kind, goal: run.goal, draft, evidence: report }, control), controller.signal))
          this.assertCurrent(run); controller.signal.throwIfAborted()
          if (!review.accepted) {
            feedback = `独立审阅未通过：${review.reason}`
            this.note(run, feedback)
            if (attempt + 1 < CREATION_LIMITS.attempts) continue
            throw new Error('修订后仍未通过独立审阅，未记为完成')
          }
          await this.check(run, 'action')
          const path = `/home/murasame/activities/${run.id}/${attempt}/${evidence.name}`
          const editor = new URL('http://127.0.0.1:8080/')
          editor.searchParams.set('folder', `/home/murasame/activities/${run.id}/${attempt}`)
          editor.searchParams.set('payload', JSON.stringify([['openFile', `vscode-remote://127.0.0.1:8080${path}`]]))
          const viewer = kind === 'office' ? ['libreoffice', '--norestore', path] : ['firefox-esr', '--new-tab', editor.toString()]
          await runInContainerAsync(run.containerId!, viewer, this.runDocker, { desktop: true, detach: true, signal: controller.signal, timeoutMs: 8000 })
          this.assertCurrent(run); controller.signal.throwIfAborted()
          const id = randomUUID()
          run.created = { evidence, id, attempt, kind }
          this.state = { ...this.state, reason: '产物已核验并打开。需要保留时请先导出，结束活动会清理隔离区。', creation: { phase: 'ready', message: '真实文件与独立审阅均通过', artifact: { id, kind, title: draft.title, name: evidence.name, sha256: evidence.sha256, bytes: evidence.bytes, preview: evidence.text, stdout: evidence.stdout, review: review.reason, attempt } } }
          this.observe(run, `产物 ${evidence.name}，SHA-256 ${evidence.sha256}\n${evidence.text}\n实际输出：${evidence.stdout}\n独立审阅：${review.reason}`, '隔离创作')
          return { ok: true, data: this.status() }
        }
        throw new Error('创作没有得到通过核验的产物')
      } catch (error) {
        if (controller.signal.aborted && (controller.signal.reason instanceof ActivityLimit || controller.signal.reason instanceof CancelledActivity)) throw controller.signal.reason
        throw error
      } finally { clearTimeout(timer); run.abort.signal.removeEventListener('abort', cancel) }
    })
  }

  async exportCreation(id: string, path: string): Promise<Result<{ path: string; bytes: number; sha256: string }>> {
    const run = this.current
    if (!run || !this.live(run) || !run.containerId || run.busy || run.created?.id !== id) return { ok: false, error: '产物不属于当前可导出的活动' }
    if (!isAbsolute(path)) return { ok: false, error: '请选择明确的保存位置' }
    const created = run.created
    run.busy = true
    try {
      await this.check(run, 'action')
      const current = await readCreation(run.containerId, run.id, created.attempt, created.kind, this.runDocker, run.abort.signal)
      await this.check(run, 'action', false)
      if (current.sha256 !== created.evidence.sha256 || current.base64 !== created.evidence.base64) throw new Error('隔离产物已改变，请重新创作和核验，未导出')
      // A bounded, exclusive write after the native save dialog is the only host write.
      writeFileSync(path, Buffer.from(current.base64, 'base64'), { flag: 'wx' })
      if (readFileSync(path).toString('base64') !== current.base64) throw new Error('导出后的文件核验失败，目标可能已留下未完成内容，未记为成功')
      run.sources.push(path)
      this.note(run, `已按选择导出到 ${path}，SHA-256 ${current.sha256}`)
      this.state = { ...this.state, reason: `已保存到 ${path}，文件内容核验一致。` }
      return { ok: true, data: { path, bytes: current.bytes, sha256: current.sha256 } }
    } catch (error) {
      return { ok: false, error: error instanceof Error && 'code' in error && error.code === 'EEXIST' ? '目标文件已存在，没有覆盖；请选择新文件名' : error instanceof Error ? error.message : '导出失败' }
    } finally { run.busy = false }
  }

  async stop(input: { containerGone: boolean }): Promise<Result<AutonomyState>> {
    const run = this.current
    if (!run || run.finished && !run.containerId) return { ok: true, data: this.status() }
    run.abort.abort()
    this.state = { ...this.state, running: false, phase: 'stopping', reason: '正在停止并确认容器退出', viewUrl: '' }
    // Preparation owns the pending container ID until it settles.
    await run.starting
    const result = await this.finish(run, input.containerGone ? 'failed' : run.created ? 'completed' : 'cancelled', input.containerGone ? '隔离环境已失效，依赖它的活动已停止' : run.created ? '创作产物已核验，隔离环境已清理。' : '容器已退出，活动已结束。')
    return !input.containerGone && !run.containerId ? { ok: true, data: this.status() } : result
  }

  discuss(frames: string[], captions: string[]): string {
    const summary = understandVideo(frames, captions)
    if (this.current && this.live(this.current)) this.note(this.current, summary)
    return summary
  }
  canUseHostFile(candidate: string, explicitShare: string | null): boolean { return hostPathAllowed(candidate, explicitShare) }

  private live(run: ActivityRun): boolean { return this.current === run && !run.abort.signal.aborted && !run.finished }
  private assertCurrent(run: ActivityRun): void { if (!this.live(run)) throw new CancelledActivity('活动已取消，旧结果已丢弃') }
  private async check(run: ActivityRun, boundary: ActivityBoundary, count = true): Promise<void> {
    this.assertCurrent(run)
    const limit = activityLimitReason(run.steps + (count ? 1 : 0), Date.now() - run.startedAt)
    if (limit) throw new ActivityLimit(limit)
    const allowed = await this.deps.guard?.(boundary, run.abort.signal)
    this.assertCurrent(run)
    if (allowed === false) throw new CancelledActivity('活动许可已撤销，已停止采集、外发和操作')
    if (count) run.steps++
  }
  private async operate(work: (run: ActivityRun) => Promise<Result<AutonomyState>>): Promise<Result<AutonomyState>> {
    const run = this.current
    if (!run || !this.state.running || !this.live(run) || !run.containerId) return { ok: false, error: '活动还没开始，没有操作宿主桌面。' }
    if (run.busy) return { ok: false, error: '这个活动已有观察或操作正在进行。' }
    run.busy = true
    try { const result = await work(run); return result.ok ? { ok: true, data: { ...result.data, busy: false } } : result }
    catch (error) {
      if (!this.live(run)) return { ok: false, error: '活动已取消，旧结果已丢弃' }
      return this.finish(run, error instanceof ActivityLimit ? 'limited' : error instanceof CancelledActivity ? 'cancelled' : 'failed', error instanceof Error ? error.message : '隔离活动失败')
    } finally { run.busy = false }
  }
  private async navigate(run: ActivityRun, url: string): Promise<void> {
    if (!/^https?:\/\//i.test(url)) throw new Error('只打开以 http 或 https 开头的地址。')
    if (!run.allowNetwork) throw new Error('这次活动没有联网，打不开网页。')
    await this.check(run, 'action')
    await runInContainerAsync(run.containerId!, ['firefox-esr', '--new-tab', url], this.runDocker, { desktop: true, signal: run.abort.signal, timeoutMs: 15000 })
    this.assertCurrent(run)
    run.browserContextId = undefined
    run.sources.push(url)
    this.note(run, `在隔离桌面打开了 ${url}`)
  }
  private async capture(run: ActivityRun): Promise<string> {
    await this.check(run, 'capture')
    await runInContainerAsync(run.containerId!, ['scrot', '-o', '/tmp/murasame-shot.png'], this.runDocker, { desktop: true, signal: run.abort.signal })
    await this.check(run, 'capture', false)
    const image = (await runInContainerAsync(run.containerId!, ['base64', '-w', '0', '/tmp/murasame-shot.png'], this.runDocker, { signal: run.abort.signal })).trim()
    this.assertCurrent(run)
    if (!decodeFrame(image)) throw new Error('没有截到完整、可解码的隔离桌面 PNG 画面')
    run.lastImage = image
    return image
  }
  private async perform(run: ActivityRun, action: DesktopAction): Promise<void> {
    if (!toAction({ ...action, note: '' })) throw new Error('桌面动作参数无效')
    if (action.kind === 'click') {
      const frame = decodeFrame(run.lastImage)
      if (!frame || action.x >= frame.width || action.y >= frame.height) throw new Error('点击坐标没有当前画面范围证据，未执行')
    }
    await this.check(run, 'action')
    await runInContainerAsync(run.containerId!, xdotoolCommand(action), this.runDocker, { desktop: true, signal: run.abort.signal })
    this.assertCurrent(run)
    this.note(run, `在隔离桌面${describeAction(action)}。动作已发送，预期结果尚未核实。`)
  }
  private async browserFacts(run: ActivityRun, play = false, recordAudioSeconds = 0): Promise<BrowserObservation | null> {
    await this.check(run, play ? 'action' : 'capture', false)
    try {
      const facts = await (this.deps.observe ? this.deps.observe(run.containerId!, { signal: run.abort.signal, play, recordAudioSeconds, expectedUrl: run.sources.at(-1), contextId: run.browserContextId }) : observeBrowser(run.containerId!, this.runDocker, { signal: run.abort.signal, play, recordAudioSeconds, expectedUrl: run.sources.at(-1), contextId: run.browserContextId }))
      this.assertCurrent(run)
      run.browserContextId = facts.contextId
      return facts
    } catch (error) {
      this.assertCurrent(run)
      if (play) throw error
      if (!run.limitations.some(s => s.includes('页面事实'))) run.limitations.push('无法读取独立页面事实，动作和完成声明不能核实。')
      return null
    }
  }
  private note(run: ActivityRun, text: string): void { this.assertCurrent(run); this.state = { ...this.state, notes: [...this.state.notes, text] } }
  private observe(run: ActivityRun, text: string, source = run.sources.at(-1) ?? '隔离桌面', mediaTime?: number, captions?: string[], audio?: ActivityObservation['audio']): void {
    this.assertCurrent(run)
    run.observations.push({ text: markUntrusted(text, run.kind === 'video' ? 'video' : 'web'), source, capturedAt: new Date().toISOString(), ...(mediaTime !== undefined ? { mediaTime } : {}), ...(captions ? { captions } : {}), ...(audio ? { audio } : {}) })
  }
  private finish(run: ActivityRun, status: ActivityResult['status'], reason: string): Promise<Result<AutonomyState>> {
    if (run.cleanup) return run.cleanup
    if (run.finished && !run.containerId) return Promise.resolve({ ok: this.state.phase !== 'failed', ...(this.state.phase === 'failed' ? { error: this.state.reason } : { data: this.status() }) } as Result<AutonomyState>)
    run.abort.abort()
    if (run.deadline) clearTimeout(run.deadline)
    if (this.current === run) this.state = { ...this.state, running: false, phase: 'stopping', reason: '正在停止并确认容器退出', viewUrl: '' }
    const cleaning: Promise<Result<AutonomyState>> = (async (): Promise<Result<AutonomyState>> => {
      const removed = !run.containerId || await stopContainerAsync(run.containerId, this.runDocker)
      if (removed) run.containerId = null
      const failed = !removed || status === 'failed'
      const result: ActivityResult = { activityId: run.id, kind: run.kind, status: removed ? status : 'failed', goal: run.goal, sources: [...new Set(run.sources)], observations: structuredClone(run.observations), summary: reason, limitations: [...run.limitations, ...(!removed ? ['未确认隔离容器退出，需要重试停止。'] : [])], startedAt: new Date(run.startedAt).toISOString(), finishedAt: new Date().toISOString(), cleanupSucceeded: removed }
      if (this.current === run) this.state = { ...this.state, running: false, phase: failed ? 'failed' : 'stopped', reason: !removed ? `${reason} 但未确认容器退出，请重试停止。` : reason, viewUrl: '', result, ...(this.state.creation && !run.created ? { creation: { phase: 'failed', message: reason } as CreationProgress } : {}) }
      const terminalState = this.status()
      const emit = !run.finished
      run.finished = true
      if (emit) {
        try { await this.deps.onComplete?.(structuredClone(result)) } catch { if (this.current === run) this.state = { ...this.state, reason: `${this.state.reason} 活动结果暂未写入对话。` } }
      }
      return failed || status === 'limited' || status === 'cancelled' ? { ok: false, error: terminalState.reason } : { ok: true, data: terminalState }
    })().finally(() => { run.cleanup = undefined })
    run.cleanup = cleaning
    return cleaning
  }
}
