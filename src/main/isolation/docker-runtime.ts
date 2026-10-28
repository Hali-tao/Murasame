import { execFile, execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export interface ContainerPlan {
  image: string
  network: 'bridge' | 'none'
  mounts: Array<string | { source: string; target: string; readOnly: boolean }>
  devices: string[]
  memory: string
  cpus: string
  hostExecution: false
  sessionId?: string
}

export function containerPlan(share?: { hostPath: string; readOnly: boolean; network?: 'bridge' | 'none' }): ContainerPlan {
  return {
    image: 'murasame-isolation:local',
    network: share?.network ?? 'bridge',
    mounts: share?.hostPath ? [{ source: share.hostPath, target: '/shared', readOnly: share.readOnly }] : [],
    devices: [],
    memory: '2g',
    cpus: '1.5',
    hostExecution: false
  }
}

export function hostPathAllowed(candidate: string, explicitShare: string | null): boolean {
  if (!explicitShare) return false
  const left = candidate.replace(/[\\/]+$/, '').toLowerCase()
  const right = explicitShare.replace(/[\\/]+$/, '').toLowerCase()
  return left === right
}

export function dockerAvailable(run: (command: string, args: string[]) => void = defaultDocker): boolean {
  try {
    run('docker', ['version'])
    return true
  } catch {
    return false
  }
}

function defaultDocker(command: string, args: string[]): void {
  execFileSync(command, args, { stdio: 'ignore', windowsHide: true, timeout: 8000 })
}

export function xdotoolCommand(action: { kind: 'click'; x: number; y: number } | { kind: 'type'; text: string } | { kind: 'key'; key: string }): string[] {
  if (action.kind === 'click') return ['xdotool', 'mousemove', String(Math.round(action.x)), String(Math.round(action.y)), 'click', '1']
  if (action.kind === 'type') return ['xdotool', 'type', '--delay', '12', action.text]
  return ['xdotool', 'key', action.key]
}

/** 桌面程序以容器里的 murasame 用户、在 :1 显示器上运行；detach 用于不会自己退出的程序。 */
export function runInContainer(
  id: string,
  command: readonly string[],
  run: (command: string, args: string[]) => string = defaultRunOutput,
  options: { desktop?: boolean; detach?: boolean } = {}
): string {
  const flags = [...(options.detach ? ['-d'] : []), ...(options.desktop ? ['-u', 'murasame'] : [])]
  const body = options.desktop ? ['env', 'DISPLAY=:1', ...command] : [...command]
  return run('docker', ['exec', ...flags, id, ...body])
}

export function containerRunning(id: string, run: (command: string, args: string[]) => string = defaultRunOutput): boolean {
  try {
    return run('docker', ['inspect', '-f', '{{.State.Running}}', id]).trim() === 'true'
  } catch {
    return false
  }
}

export function isolationEnvironment(run: (command: string, args: string[]) => string = defaultRunOutput): { docker: boolean; image: boolean; detail: string } {
  try {
    run('docker', ['version'])
  } catch {
    return { docker: false, image: false, detail: '点「开始活动」后会自动准备，不用单独打开或设置。' }
  }
  try {
    const image = run('docker', ['images', '-q', 'murasame-isolation:local']).trim()
    if (!image) return { docker: true, image: false, detail: '第一次点「开始活动」时会自动下载，大约几分钟，之后直接开。' }
  } catch (error) {
    return { docker: true, image: false, detail: error instanceof Error ? error.message : '无法查询隔离镜像' }
  }
  return { docker: true, image: true, detail: '可以直接开始。活动只发生在隔离桌面里。' }
}

export function dockerDesktopPath(exists: (path: string) => boolean = existsSync): string | null {
  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA].filter((item): item is string => Boolean(item))
  for (const root of roots) {
    const candidate = join(root, 'Docker', 'Docker', 'Docker Desktop.exe')
    if (exists(candidate)) return candidate
  }
  return null
}

/** Docker 没开就自己启动并等待。用户不需要先去打开 Docker Desktop。 */
export async function ensureDocker(deps: {
  available?: () => boolean | Promise<boolean>
  locate?: () => string | null
  launch?: (executable: string) => void
  wait?: (ms: number) => Promise<void>
  attempts?: number
  onStatus?: (text: string) => void
  signal?: AbortSignal
} = {}): Promise<{ ok: true } | { ok: false; detail: string }> {
  const available = deps.available ?? (() => dockerAvailableAsync(undefined, { signal: deps.signal }))
  const cancelled = (): { ok: false; detail: string } => ({ ok: false, detail: '活动准备已取消' })
  if (deps.signal?.aborted) return cancelled()
  const ready = await available()
  if (deps.signal?.aborted) return cancelled()
  if (ready) return { ok: true }
  const executable = (deps.locate ?? dockerDesktopPath)()
  if (!executable) {
    return { ok: false, detail: '这台电脑还没有安装 Docker Desktop，隔离桌面需要它。安装好之后重新打开本软件，再点一次开始即可。' }
  }
  deps.onStatus?.('正在启动运行环境，第一次大约一两分钟。')
  try {
    (deps.launch ?? launchDockerDesktop)(executable)
  } catch (error) {
    return { ok: false, detail: `运行环境没能自动启动：${error instanceof Error ? error.message : '未知原因'}。` }
  }
  const wait = deps.wait ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))
  const attempts = deps.attempts ?? 24
  for (let index = 0; index < attempts; index += 1) {
    if (deps.signal?.aborted) return cancelled()
    await wait(5000)
    if (deps.signal?.aborted) return cancelled()
    const ready = await available()
    if (deps.signal?.aborted) return cancelled()
    if (ready) return { ok: true }
  }
  return { ok: false, detail: '运行环境还在启动。等一会儿再点一次「开始活动」。' }
}

function launchDockerDesktop(executable: string): void {
  spawn(executable, [], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
}

interface BuildSource {
  baseImage?: string
  aptMirror?: string
}

/** 官方源连不上时改用的国内镜像源。 */
export const DOMESTIC_BASE_IMAGE = 'docker.m.daocloud.io/library/debian:bookworm'

/** 一次构建里同时写上两个国内软件源，一个包从第一个下不来就改从第二个下。失败后再原样重试一次，已下好的层会复用。 */
export const DOMESTIC_MIRRORS = 'mirrors.aliyun.com,mirrors.tuna.tsinghua.edu.cn'

export const DOMESTIC_ATTEMPTS: ReadonlyArray<Required<BuildSource>> = [
  { baseImage: DOMESTIC_BASE_IMAGE, aptMirror: DOMESTIC_MIRRORS },
  { baseImage: DOMESTIC_BASE_IMAGE, aptMirror: DOMESTIC_MIRRORS }
]

/** 把下载日志收成一句用户能看懂的话。技术细节不往页面上放。 */
export function friendlyBuildLine(line: string): string | null {
  const text = line.trim()
  if (!text) return null
  if (/^连不上|^软件包下载中断|failed to (authorize|fetch anonymous token|fetch oauth token)|auth\.docker\.io/.test(text)) {
    return '官方下载地址连不上，正在改用国内地址继续。'
  }
  if (/naming to|exporting to image/.test(text)) return '隔离环境已经准备好。'
  if (/firefox-esr/.test(text)) return '正在安装浏览器。'
  if (/fonts-wqy|fontconfig/.test(text)) return '正在安装中文字体。'
  if (/xfce4/.test(text)) return '正在安装桌面。'
  if (/apt-get update|Reading package lists|^Get:/.test(text)) return '正在获取软件清单。'
  if (/apt-get .*install|Setting up |Unpacking /.test(text)) return '正在安装隔离环境需要的软件。'
  if (/load metadata|Pulling|Downloading|pulling from/.test(text)) return '正在下载基础系统。'
  return null
}

export function buildArgs(contextDir: string, source: BuildSource): string[] {
  const args = ['build', '-t', 'murasame-isolation:local']
  if (source.baseImage) args.push('--build-arg', `BASE_IMAGE=${source.baseImage}`)
  if (source.aptMirror) args.push('--build-arg', `APT_MIRROR=${source.aptMirror}`)
  return [...args, contextDir]
}

function buildOnce(contextDir: string, source: BuildSource, onLine: (line: string) => void, signal?: AbortSignal): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    const tail: string[] = []
    const child = spawn('docker', buildArgs(contextDir, source), { windowsHide: true, signal })
    const read = (chunk: Buffer): void => {
      for (const line of chunk.toString('utf8').split(/\r?\n/)) {
        const text = line.trim()
        if (!text) continue
        tail.push(text)
        if (tail.length > 120) tail.shift()
        if (!signal?.aborted) onLine(text)
      }
    }
    child.stdout.on('data', read)
    child.stderr.on('data', read)
    child.on('error', (error) => resolve({ code: -1, output: `没能运行 docker：${error.message}` }))
    child.on('close', (code) => resolve({ code, output: tail.join('\n') }))
  })
}

/** 国内网络下最常见的两种失败：拉不到基础镜像，或者软件包下载到一半断掉。 */
export function networkFailure(output: string): 'registry' | 'apt' | null {
  if (/failed to (authorize|fetch anonymous token|fetch oauth token|resolve source metadata)|auth\.docker\.io|registry-1\.docker\.io/.test(output)) return 'registry'
  if (/Failed to fetch|Unable to connect to|Temporary failure resolving|Could not resolve/.test(output)) return 'apt'
  return null
}

export function explainBuildFailure(output: string): string {
  const kind = networkFailure(output)
  if (kind === 'registry' || kind === 'apt') return '隔离环境没能下载完。检查网络后再点一次「开始活动」，已经下载的部分会接着用。'
  if (/no space left on device/.test(output)) return '磁盘空间不够，隔离环境没有准备完。清理出一些空间后再点一次开始。'
  const errors = output.split('\n').filter((line) => /ERROR|\bE: /.test(line)).slice(-3).join(' ')
  return (errors || output.split('\n').at(-1) || '没有输出').slice(0, 400)
}

/** 用 isolation/Dockerfile 构建镜像。第一次要下载系统和浏览器，可能要十几分钟。 */
export async function buildIsolationImage(contextDir: string, onLine: (line: string) => void, options: { signal?: AbortSignal } = {}): Promise<{ ok: boolean; detail: string }> {
  if (options.signal?.aborted) return { ok: false, detail: '活动准备已取消' }
  let attempt = await buildOnce(contextDir, {}, onLine, options.signal)
  if (options.signal?.aborted) return { ok: false, detail: '活动准备已取消' }
  if (attempt.code === 0) return { ok: true, detail: '隔离环境已经准备好。' }
  let kind = networkFailure(attempt.output)
  for (const source of DOMESTIC_ATTEMPTS) {
    if (!kind) break
    onLine(kind === 'registry' ? '连不上官方地址，改用国内地址继续。' : '软件包下载中断，用国内地址再试一次。')
    if (options.signal?.aborted) return { ok: false, detail: '活动准备已取消' }
    attempt = await buildOnce(contextDir, source, onLine, options.signal)
    if (options.signal?.aborted) return { ok: false, detail: '活动准备已取消' }
    if (attempt.code === 0) return { ok: true, detail: '隔离环境已经准备好。' }
    kind = networkFailure(attempt.output)
  }
  return { ok: false, detail: explainBuildFailure(attempt.output) }
}

export function dockerUnavailableMessage(): string {
  return 'Docker 没有启动。自主活动已停止，不会改到宿主桌面。请先启动 Docker Desktop，再重新开启活动。'
}

export interface StartedContainer {
  id: string
  port: number
  reason: string
}

function leftoverContainers(run: (command: string, args: string[]) => string): string[] {
  const ids = new Set<string>()
  for (const args of [
    ['ps', '-aq', '--filter', `label=${OWNER_LABEL}`, '--filter', `label=io.murasame.profile=${ownerProfile}`, '--filter', `label=io.murasame.session=${RUNTIME_SESSION}`, '--filter', 'status=exited']
  ]) {
    try {
      for (const id of run('docker', args).split(/\s+/)) {
        if (id) ids.add(id)
      }
    } catch {
      // 查询失败时不拦启动。
    }
  }
  return [...ids]
}

/** 真正拉起容器。失败不改去宿主执行，只如实返回原因。 */
export function startContainer(
  plan: ContainerPlan,
  port = 6901,
  run: (command: string, args: string[]) => string = defaultRunOutput
): StartedContainer | { failed: string } {
  try {
    for (const id of leftoverContainers(run)) {
      try {
        run('docker', ['rm', '-f', id])
      } catch {
        // 删不掉就继续尝试启动，失败原因会原样返回。
      }
    }
    const args = createArgs(plan, port)
    const id = run('docker', args).trim().slice(0, 12)
    if (!id) return { failed: '容器没有启动，没有拿到容器 ID' }
    return { id, port, reason: '隔离桌面已启动' }
  } catch (error) {
    return { failed: error instanceof Error ? error.message : '容器启动失败' }
  }
}

export function stopContainer(
  id: string,
  run: (command: string, args: string[]) => string = defaultRunOutput
): boolean {
  try {
    run('docker', ['rm', '-f', id])
    return true
  } catch {
    return false
  }
}

function defaultRunOutput(command: string, args: string[]): string {
  return execFileSync(command, args, { encoding: 'utf8', windowsHide: true, timeout: 60_000 })
}

export function createArgs(plan: ContainerPlan, port = 6901): string[] {
  const args = ['run', '-d', '--network', plan.network, '--memory', plan.memory, '--cpus', plan.cpus, '--pids-limit', '1024']
  for (const mount of plan.mounts) {
    const parsed = typeof mount === 'string' ? /^(.*):([^:]+):(ro|rw)$/.exec(mount) : null
    const value = typeof mount === 'string'
      ? parsed ? { source: parsed[1], target: parsed[2], readOnly: parsed[3] === 'ro' } : null
      : mount
    if (!value || /[,\r\n]/.test(value.source + value.target) || !value.target.startsWith('/')) throw new Error('共享目录格式无效')
    args.push('--mount', `type=bind,${value.readOnly ? 'readonly,' : ''}source=${value.source},target=${value.target}`)
  }
  if (plan.devices.length > 0) args.push('--device', plan.devices.join(','))
  args.push('--label', OWNER_LABEL, '--label', `io.murasame.profile=${ownerProfile}`, '--label', `io.murasame.session=${plan.sessionId ?? RUNTIME_SESSION}`)
  if (port > 0) args.push('-p', `127.0.0.1:${port}:6901`)
  args.push('--name', `murasame-isolation-${randomUUID()}`)
  args.push(plan.image)
  return args
}

/** One process session owns only containers carrying both labels. */
export const OWNER_LABEL = 'io.murasame.owner=desktop'
export const ISOLATION_IMAGE_SCHEMA = '3'
const IMAGE_SCHEMA_TEMPLATE = '{{index .Config.Labels "io.murasame.isolation.schema"}}'
export const RUNTIME_SESSION = randomUUID()
let ownerProfile = `unconfigured-${randomUUID()}`
/** Configure once before creating a container. Pass a stable hash of this app's userData path. */
export function configureContainerOwner(profile: string): void {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(profile)) throw new Error('隔离容器配置标识无效')
  ownerProfile = profile
}
export interface CommandOptions { signal?: AbortSignal; timeoutMs?: number; env?: NodeJS.ProcessEnv; input?: string }
export type DockerRunner = (command: string, args: string[], options?: CommandOptions) => string | Promise<string>
export interface ContainerExecOptions extends CommandOptions { desktop?: boolean; detach?: boolean }

/** Bounded async subprocess, also used by local perception. No shell interpolation. */
export function runCommandAsync(command: string, args: string[], options: CommandOptions = {}): Promise<string> {
  if (options.signal?.aborted) return Promise.reject(new Error('操作已取消'))
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, {
      encoding: 'utf8', windowsHide: true, timeout: options.timeoutMs ?? 60_000,
      maxBuffer: 24 * 1024 * 1024, signal: options.signal, env: options.env
    }, (error, stdout, stderr) => {
      if (error) reject(new Error(options.signal?.aborted ? '操作已取消' : `${command} 执行失败（${error.killed ? '超时或中止' : error.code ?? '未知状态'}）${(stderr || stdout) ? `: ${(stderr || stdout).slice(-2000)}` : ''}`))
      else resolve(stdout)
    })
    child.stdin?.on('error', () => { /* Process exit is reported by the callback. */ })
    child.stdin?.end(options.input)
  })
}

export async function dockerAvailableAsync(run: DockerRunner = runCommandAsync, options: CommandOptions = {}): Promise<boolean> {
  if (options.signal?.aborted) return false
  try { await run('docker', ['version'], { ...options, timeoutMs: 8000 }); return true } catch { return false }
}

export async function runInContainerAsync(id: string, command: readonly string[], run: DockerRunner = runCommandAsync, options: ContainerExecOptions = {}): Promise<string> {
  if (options.signal?.aborted) throw new Error('操作已取消')
  const flags = [...(options.input !== undefined ? ['-i'] : []), ...(options.detach ? ['-d'] : []), ...(options.desktop ? ['-u', 'murasame'] : [])]
  return run('docker', ['exec', ...flags, id, ...(options.desktop ? ['env', 'DISPLAY=:1'] : []), ...command], options)
}

export async function containerRunningAsync(id: string, run: DockerRunner = runCommandAsync, options: CommandOptions = {}): Promise<boolean> {
  try { return (await run('docker', ['inspect', '-f', '{{.State.Running}}', id], { ...options, timeoutMs: 8000 })).trim() === 'true' } catch { return false }
}

export async function isolationEnvironmentAsync(run: DockerRunner = runCommandAsync, options: CommandOptions = {}): Promise<{ docker: boolean; image: boolean; detail: string }> {
  if (!await dockerAvailableAsync(run, options)) return { docker: false, image: false, detail: '开始活动时会准备隔离运行环境。' }
  try {
    const exists = Boolean((await run('docker', ['images', '-q', 'murasame-isolation:local'], { ...options, timeoutMs: 8000 })).trim())
    const image = exists && (await run('docker', ['image', 'inspect', '-f', IMAGE_SCHEMA_TEMPLATE, 'murasame-isolation:local'], { ...options, timeoutMs: 8000 })).trim() === ISOLATION_IMAGE_SCHEMA
    return { docker: true, image, detail: image ? '隔离环境已就绪。' : exists ? '隔离镜像需要升级，开始活动时会准备新版运行配置。' : '首次活动需要准备隔离镜像。' }
  } catch { return { docker: true, image: false, detail: '无法查询隔离镜像。' } }
}

export async function stopContainerAsync(id: string, run: DockerRunner = runCommandAsync): Promise<boolean> {
  try { await run('docker', ['rm', '-f', id], { timeoutMs: 15000 }); return true } catch { return false }
}

export async function startContainerAsync(plan: ContainerPlan, port = 6901, run: DockerRunner = runCommandAsync, options: { signal?: AbortSignal; wait?: (ms: number) => Promise<void>; readinessAttempts?: number; readiness?: 'desktop' | 'process' } = {}): Promise<StartedContainer | { failed: string; id?: string }> {
  const args = createArgs(plan, port)
  if (options.readiness === 'process') { args[args.indexOf('--pids-limit') + 1] = '256'; args.push('sleep', 'infinity') }
  const name = args[args.indexOf('--name') + 1]
  let id = ''; let creationAttempted = false
  try {
    if (options.signal?.aborted) throw new Error('操作已取消')
    const schema = (await run('docker', ['image', 'inspect', '-f', IMAGE_SCHEMA_TEMPLATE, plan.image], { signal: options.signal, timeoutMs: 8000 })).trim()
    if (schema !== ISOLATION_IMAGE_SCHEMA) return { failed: '隔离镜像需要升级，请先在自主活动中准备新版运行环境。' }
    // Only stopped containers from this process session. Never delete another live activity.
    const old = await run('docker', ['ps', '-aq', '--filter', `label=${OWNER_LABEL}`, '--filter', `label=io.murasame.profile=${ownerProfile}`, '--filter', `label=io.murasame.session=${plan.sessionId ?? RUNTIME_SESSION}`, '--filter', 'status=exited'], { timeoutMs: 8000 })
    for (const candidate of old.split(/\s+/).filter(Boolean)) {
      if (options.signal?.aborted) throw new Error('操作已取消')
      if (!await stopContainerAsync(candidate, run)) throw new Error('旧隔离容器清理失败')
    }
    if (options.signal?.aborted) throw new Error('操作已取消')
    // Let run finish so its ID can always be reclaimed, even if cancellation arrives meanwhile.
    creationAttempted = true
    id = (await run('docker', args, { timeoutMs: 30000 })).trim()
    if (!id) throw new Error('容器没有启动，没有拿到容器 ID')
    if (options.readiness === 'process') {
      if (!await containerRunningAsync(id, run, { signal: options.signal })) throw new Error('隔离进程没有就绪')
      if (options.signal?.aborted) throw new Error('操作已取消')
      return { id, port, reason: '隔离进程已启动' }
    }
    const wait = options.wait ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)))
    for (let attempt = 0; attempt < (options.readinessAttempts ?? 30); attempt++) {
      if (options.signal?.aborted) throw new Error('操作已取消')
      try {
        await runInContainerAsync(id, ['sh', '-c', 'xdotool getdisplaygeometry >/dev/null && command -v scrot >/dev/null && command -v libreoffice >/dev/null && command -v code-server >/dev/null && python3 -c "import socket, urllib.request; urllib.request.urlopen(\'http://127.0.0.1:6901/vnc.html\', timeout=2).read(1); socket.create_connection((\'127.0.0.1\',9222),2).close()"'], run, { desktop: true, signal: options.signal, timeoutMs: 4000 })
        if (options.signal?.aborted) throw new Error('操作已取消')
        return { id, port, reason: '隔离桌面已启动并确认可以采集画面' }
      } catch {
        if (attempt + 1 >= (options.readinessAttempts ?? 30)) throw new Error('隔离桌面没有就绪')
        await wait(500)
      }
    }
    throw new Error('隔离桌面没有就绪')
  } catch (error) {
    if (!creationAttempted) return { failed: error instanceof Error ? error.message : '容器准备检查失败' }
    const removed = await stopContainerAsync(id || name, run)
    return { failed: error instanceof Error ? error.message : '容器启动失败', ...(!removed ? { id: id || name } : {}) }
  }
}

/** Startup-only recovery. Caller must run this before accepting new activities/tasks. */
export async function cleanupOwnedContainersAsync(run: DockerRunner = runCommandAsync, options: { activeIds?: readonly string[] } = {}): Promise<{ removed: string[]; failed: string[] }> {
  const removed: string[] = []; const failed: string[] = []
  const ids = (await run('docker', ['ps', '-aq', '--filter', `label=${OWNER_LABEL}`, '--filter', `label=io.murasame.profile=${ownerProfile}`], { timeoutMs: 8000 })).trim().split(/\s+/).filter(Boolean)
  for (const id of ids) {
    if (options.activeIds?.includes(id)) continue
    if (await stopContainerAsync(id, run)) removed.push(id)
    else failed.push(id)
  }
  return { removed, failed }
}
