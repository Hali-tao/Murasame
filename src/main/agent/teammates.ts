import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'
import { containerRunning, runInContainer } from '../isolation/docker-runtime'

/** 桌宠先分流。结果只决定叫哪名队友，不直接念给用户。 */
export type TeammateId = 'chat' | 'files' | 'command' | 'screen' | 'isolation'

export type StepPose = 'look' | 'act' | 'wait' | 'fail' | 'think'
export type TeammateKind = 'chat' | 'organize' | 'draw-image' | 'look-screen' | 'browse' | 'correct-draw' | 'draw-status'

/** 形象只表演这一步的类别，不拿成功动作去盖失败。 */
export function poseIntent(pose: StepPose): '思考' | '困惑' | '否定' | '惊讶' {
  if (pose === 'fail') return '否定'
  if (pose === 'wait') return '困惑'
  if (pose === 'act') return '惊讶'
  return '思考'
}

export interface TeammateRoute {
  teammate: TeammateId
  kind: TeammateKind
  /** 交给队友时桌宠先说的一句。不表示已经做成。 */
  say: string
}

const imageAsk = /画图|画画|画一张|画一幅|画个图|(?:生成|画|做)(?:一张|一幅|一个|个)?.{0,8}(?:图片|图像|照片|相片)/
const organizeAsk = /(?:整理|归档).{0,16}(?:文件|桌面|下载|目录|文件夹|图片)|把.{0,24}(?:文件|文件夹).{0,12}整理/
const screenAsk = /屏幕|当前画面|截图|看看我在干什么/
const browseAsk = /https?:\/\/\S+|打开.{0,8}(?:网页|网站)|看视频|逛一下|隔离桌面/

export function routeUtterance(text: string): TeammateRoute {
  // Quoted instructions are data. Judge each clause so a prohibition on one
  // capability does not suppress an explicit request for another capability.
  const unquoted = text.replace(/[“「『"](?:[^”」』"]*)[”」』"]/g, '').replace(/‘[^’]*’|'[^']*'/g, '')
  const clauses = unquoted.split(/[，。！？!?\n；;]|但是|不过/).map((clause) => clause.trim()).filter(Boolean)
  const commands = clauses.filter((clause) => !/(?:不要|别|不许|不用|无需|不想|不喜欢|禁止|不必|是什么意思|什么叫|原理|怎么|如何|解释|讨论|知道|记住|记下|网址是|我喜欢|我习惯|已经|昨天|上次|之前|曾经|你说)/.test(clause))
  const trimmed = commands.join('，')
  if (/不要放桌面|放到图片文件夹|放图片文件夹|放到图片/.test(unquoted) && !/是什么意思|原理|解释|昨天|你说/.test(unquoted)) {
    return {
      teammate: 'command',
      kind: 'correct-draw',
      say: '放到桌面的做法我标成不用了。之后画完会问你要不要放到图片文件夹，仍然要你点允许。'
    }
  }
  if (screenAsk.test(trimmed) && /截图|截屏|看.{0,12}(?:屏幕|当前画面|我在干什么)/.test(trimmed) && !imageAsk.test(trimmed)) {
    return {
      teammate: 'screen',
      kind: 'look-screen',
      say: '我让屏幕去看当前窗口。看只是看，不会去点。'
    }
  }
  if (imageAsk.test(trimmed)) {
    return {
      teammate: 'command',
      kind: 'draw-image',
      say: '我在你的电脑上画。'
    }
  }
  if (/(?:图片|图像|照片|相片).{0,8}在哪|在哪.{0,6}(?:图片|图像|照片|相片)|画好了吗|写好了吗|生成好了吗/.test(trimmed)) {
    return {
      teammate: 'command',
      kind: 'draw-status',
      say: '我去看刚才那张图写到哪了。'
    }
  }
  if (organizeAsk.test(trimmed)) {
    return {
      teammate: 'files',
      kind: 'organize',
      say: '我交给文件队友。动你的文件之前会先问你。'
    }
  }
  if (browseAsk.test(trimmed)) {
    return {
      teammate: 'isolation',
      kind: 'browse',
      say: '我让隔离桌面去处理这个网页。没打开之前不会说已经看过。'
    }
  }
  return { teammate: 'chat', kind: 'chat', say: '' }
}

export interface ImageTaskFact {
  status: string
  summary: string
  result: string
  approval: { tool?: string; target?: string } | null
}

/** 用任务单回答「图片在哪里」，不让闲聊模型另编一句。列表按最近更新在前。 */
export function imageWhereabouts(tasks: readonly ImageTaskFact[]): { say: string; pose: StepPose } {
  const related = tasks.find((task) => (
    task.approval?.tool === 'copy-image'
    || /拷到|写到|murasame-画/.test(`${task.summary}\n${task.result}`)
  ))
  if (!related) return { say: '还没有写过图。要写的话直接说画到桌面。', pose: 'wait' }
  if (related.status === '等待批准' || related.status === '待确认') {
    const target = related.approval?.target?.trim() || '桌面'
    return { say: `还没写。点允许之后才会出现在 ${target}。`, pose: 'wait' }
  }
  if (related.status === '已完成' || related.status === '部分完成') {
    const where = related.result.trim() || related.summary.trim()
    return { say: where ? `写过了。${where}` : '写过了，在桌面。', pose: 'act' }
  }
  if (related.status === '失败') return { say: related.result.trim() || related.summary.trim() || '上次没写成。', pose: 'fail' }
  if (related.status === '执行中') return { say: '还在写，写完我会说文件在哪。', pose: 'wait' }
  return { say: related.result.trim() || '还在处理这张图。', pose: 'wait' }
}

export { petSpeech } from '../../shared/pet-speech'

export function petLine(name: string | undefined, situation: 'no-model' | 'unclear'): string {
  const who = name?.trim() || '我'
  if (situation === 'no-model') return `${who}在。需要模型才能接着聊，这次没有接上，所以没有生成回复。`
  return `${who}没分清这件事该交给谁，所以没有开始做。`
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type), data])
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(body) >>> 0, 0)
  return Buffer.concat([length, body, checksum])
}

/** 一张实色小图。命令队友把它写进隔离环境，不是让对话模型声称画过。 */
export function solidPng(width = 32, height = 32): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const stride = width * 3 + 1
  const raw = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y += 1) {
    const row = y * stride
    raw[row] = 0
    for (let x = 0; x < width; x += 1) {
      const index = row + 1 + x * 3
      raw[index] = (x * 12 + 40) % 256
      raw[index + 1] = (y * 10 + 80) % 256
      raw[index + 2] = 168
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

export const ISOLATED_IMAGE = '/home/murasame/murasame-draw.png'

export interface CommandRunner {
  running(): boolean
  exec(command: readonly string[]): string
}

export function drawIsolatedImage(runner: CommandRunner, png = solidPng()): { ok: true; bytes: number } | { ok: false; reason: string } {
  if (!runner.running()) {
    return { ok: false, reason: '隔离环境还没准备好，所以没有在你的电脑上画。' }
  }
  const hex = png.toString('hex')
  try {
    runner.exec(['python3', '-c', `open('${ISOLATED_IMAGE}','wb').write(bytes.fromhex('${hex}'))`])
  } catch {
    return { ok: false, reason: '命令队友没有把图画出来。' }
  }
  let reported: string
  try {
    reported = runner.exec(['stat', '-c', '%s', ISOLATED_IMAGE]).trim()
  } catch {
    return { ok: false, reason: '核对者没有看到这张图，所以不能说已经画好。' }
  }
  const bytes = Number(reported)
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return { ok: false, reason: '核对者看到的文件是空的，所以不能说已经画好。' }
  }
  return { ok: true, bytes }
}

export function writeHostImage(hostPath: string, png = solidPng(), size: (path: string) => number = (path) => statSync(path).size): { ok: true; path: string; bytes: number } | { ok: false; reason: string } {
  try {
    mkdirSync(dirname(hostPath), { recursive: true })
    writeFileSync(hostPath, png)
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : '没有在你的电脑上写成这张图。' }
  }
  let bytes: number
  try {
    bytes = size(hostPath)
  } catch {
    return { ok: false, reason: '写完之后在你的电脑上没有找到这张图。' }
  }
  if (bytes <= 0) return { ok: false, reason: '写到你电脑上的文件是空的，不能当作已经交付。' }
  return { ok: true, path: hostPath, bytes }
}

export function desktopImagePath(): string {
  return join(pictureFolder('Desktop', '桌面'), 'murasame-画.png')
}

export function picturesImagePath(): string {
  return join(pictureFolder('Pictures', '图片'), 'murasame-画.png')
}

function pictureFolder(english: string, chinese: string): string {
  const modern = join(homedir(), english)
  return existsSync(modern) ? modern : join(homedir(), chinese)
}

export function liveCommandRunner(containerId = 'murasame-isolation'): CommandRunner {
  return {
    running: () => containerRunning(containerId),
    exec: (command) => runInContainer(containerId, command)
  }
}

/** 批准之后才拷。拷完再看宿主机上的大小，对不上就当没拷成。 */
export function copyVerifiedImage(containerPath: string, hostPath: string, copy: (from: string, to: string) => void = defaultDockerCopy, size: (path: string) => number = (path) => statSync(path).size): { ok: true; path: string; bytes: number } | { ok: false; reason: string } {
  try {
    mkdirSync(dirname(hostPath), { recursive: true })
    copy(`murasame-isolation:${containerPath}`, hostPath)
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : '没有从隔离环境拷出来。' }
  }
  let bytes: number
  try {
    bytes = size(hostPath)
  } catch {
    return { ok: false, reason: '拷贝之后在桌面上没有找到这张图。' }
  }
  if (bytes <= 0) return { ok: false, reason: '拷到桌面的文件是空的，不能当作已经交付。' }
  return { ok: true, path: hostPath, bytes }
}

function defaultDockerCopy(from: string, to: string): void {
  execFileSync('docker', ['cp', from, to], { windowsHide: true, timeout: 20_000 })
}
