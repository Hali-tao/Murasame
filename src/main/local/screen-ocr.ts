import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import assets from '../../../resources/ocr-assets.json'
import type { OcrModelStatus } from '../../shared/types'
import { runCommandAsync, type DockerRunner } from '../isolation/docker-runtime'
import { recognizePngAsync } from './ocr'

type Asset = { file: string; url: string; size: number; sha256: string }
export const OCR_VERSION = assets.version
export const OCR_DOWNLOAD_BYTES = [assets.python, ...assets.wheels, ...assets.models].reduce((sum, file) => sum + file.size, 0)

export function verifyOcrAsset(bytes: Uint8Array, asset: Asset): void {
  if (bytes.byteLength !== asset.size || createHash('sha256').update(bytes).digest('hex') !== asset.sha256) {
    throw new Error(`文件校验失败：${asset.file}`)
  }
}

async function download(asset: Asset, destination: string): Promise<void> {
  const response = await fetch(asset.url, { signal: AbortSignal.timeout(300_000) })
  if (!response.ok || !response.body) throw new Error(`下载失败：${asset.file}（HTTP ${response.status}）`)
  const chunks: Uint8Array[] = []
  let bytes = 0
  for await (const chunk of response.body) {
    bytes += chunk.byteLength
    if (bytes > asset.size) throw new Error(`下载大小异常：${asset.file}`)
    chunks.push(chunk)
  }
  const data = Buffer.concat(chunks)
  verifyOcrAsset(data, asset)
  await writeFile(destination, data)
}

/** A separate runtime under userData, independent of system Python and C: paths. */
export class LocalScreenOcr {
  readonly directory: string
  private status: OcrModelStatus
  private installing: Promise<OcrModelStatus> | null = null
  private checking: Promise<OcrModelStatus> | null = null
  private recognizing: Promise<unknown> = Promise.resolve()
  constructor(private readonly userData: string, private readonly resources: string,
    private readonly run: DockerRunner = runCommandAsync,
    private readonly fetchAsset = download,
    private readonly fallback = recognizePngAsync) {
    this.directory = resolve(userData, 'models', 'pp-ocrv5')
    this.status = { state: 'missing', engine: 'windows', directory: this.directory, detail: '未安装 PP-OCRv5，使用 Windows OCR 备用识别。', progress: 0, downloadBytes: OCR_DOWNLOAD_BYTES }
    if (existsSync(join(this.directory, 'installed.json'))) {
      this.status = { ...this.status, state: 'installed', detail: '已安装，首次识别时加载；也可点击检查模型。' }
    }
  }
  getStatus(): OcrModelStatus { return { ...this.status } }
  private update(patch: Partial<OcrModelStatus>): void { this.status = { ...this.status, ...patch } }
  private async verifyInstalled(directory = this.directory): Promise<void> {
    const record = JSON.parse(await readFile(join(directory, 'installed.json'), 'utf8')) as { version?: string }
    if (record.version !== OCR_VERSION) throw new Error('模型组件版本不匹配，请重新安装')
    if (!existsSync(join(directory, 'runtime', 'python.exe'))) throw new Error('OCR 运行环境缺失，请重新安装')
    for (const model of assets.models) verifyOcrAsset(await readFile(join(directory, model.file)), model)
  }
  private async invoke(directory: string, png?: Buffer, signal?: AbortSignal): Promise<string> {
    const output = await this.run(join(directory, 'runtime', 'python.exe'),
      ['-B', join(this.resources, 'ocr-worker.py'), directory, ...(png ? [] : ['--probe'])], {
        input: png?.toString('base64'), timeoutMs: 90_000, signal,
        env: { ...process.env, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1', PYTHONNOUSERSITE: '1' }
      })
    const result = JSON.parse(output.trim()) as { ok?: boolean; text?: string }
    if (!result.ok || typeof result.text !== 'string') throw new Error('PP-OCRv5 未返回有效识别结果')
    return result.text
  }
  check(): Promise<OcrModelStatus> {
    if (this.installing) return this.installing
    if (this.checking) return this.checking
    this.checking = (async () => {
      await this.recognizing
      this.update({ state: 'loading', detail: '正在校验并加载 PP-OCRv5…' })
      try {
        await this.verifyInstalled()
        await this.invoke(this.directory)
        this.update({ state: 'ready', engine: 'ppocrv5', detail: 'PP-OCRv5 轻量模型已验证，可离线识别；运行异常时自动使用 Windows OCR。', progress: 100 })
      } catch {
        this.update({ state: 'failed', engine: 'windows', detail: 'PP-OCRv5 加载失败或文件不完整，已切换 Windows OCR。可检查模型或重新安装。' })
      }
      return this.getStatus()
    })().finally(() => { this.checking = null })
    return this.checking
  }
  install(): Promise<OcrModelStatus> {
    if (this.installing) return this.installing
    this.installing = this.performInstall().finally(() => { this.installing = null })
    return this.installing
  }
  private async removeOwned(path: string): Promise<void> {
    const child = relative(resolve(this.userData, 'models'), resolve(path))
    if (!child || child.startsWith('..') || child.includes(':')) throw new Error('拒绝清理模型目录外的路径')
    await rm(path, { recursive: true, force: true })
  }
  private async performInstall(): Promise<OcrModelStatus> {
    if (this.checking) await this.checking
    await this.recognizing
    this.update({ state: 'installing', engine: 'windows', progress: 0, detail: '正在下载 OCR 运行环境与模型，识别暂时使用 Windows OCR…' })
    let stage = ''; let backup = ''; let committed = false
    try {
      if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('本地 OCR 安装目前支持 Windows x64')
      const parent = join(this.userData, 'models')
      await mkdir(parent, { recursive: true })
      stage = await mkdtemp(join(parent, '.ocr-install-'))
      await mkdir(join(stage, 'downloads'))
      let downloaded = 0
      for (const asset of [assets.python, ...assets.wheels, ...assets.models]) {
        this.update({ detail: `正在下载并校验 ${asset.file}…` })
        const destination = assets.models.some(model => model.file === asset.file) ? join(stage, asset.file) : join(stage, 'downloads', asset.file)
        await this.fetchAsset(asset, destination)
        // Keep verification even for alternate download transports.
        verifyOcrAsset(await readFile(destination), asset)
        downloaded += asset.size
        this.update({ progress: Math.floor(downloaded / OCR_DOWNLOAD_BYTES * 85) })
      }
      this.update({ detail: '正在安装独立运行环境…', progress: 88 })
      await this.run(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
        ['-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath $env:OCR_ARCHIVE -DestinationPath $env:OCR_RUNTIME"],
        { timeoutMs: 120_000, env: { ...process.env, OCR_ARCHIVE: join(stage, 'downloads', assets.python.file), OCR_RUNTIME: join(stage, 'runtime') } })
      await this.run(join(stage, 'runtime', 'python.exe'), ['-B', join(this.resources, 'ocr-unpack.py'), stage], { timeoutMs: 120_000 })
      this.update({ state: 'loading', detail: '正在验证模型可离线加载…', progress: 95 })
      await this.invoke(stage)
      await writeFile(join(stage, 'installed.json'), JSON.stringify({ version: OCR_VERSION }))
      await this.removeOwned(join(stage, 'downloads'))
      if (existsSync(this.directory)) { backup = `${this.directory}.backup-${Date.now()}`; await rename(this.directory, backup) }
      try { await rename(stage, this.directory); stage = ''; committed = true }
      catch (error) { if (backup) { await rename(backup, this.directory); backup = '' }; throw error }
      this.update({ state: 'ready', engine: 'ppocrv5', progress: 100, detail: '安装完成，PP-OCRv5 可离线识别；运行异常时自动使用 Windows OCR。' })
    } catch (error) {
      this.update({ state: 'failed', engine: 'windows', detail: `安装失败，使用 Windows OCR。${error instanceof Error ? error.message.slice(0, 240) : '请稍后重试'}` })
    } finally {
      if (stage) await this.removeOwned(stage).catch(() => undefined)
      if (backup && committed) await this.removeOwned(backup).catch(() => undefined)
    }
    return this.getStatus()
  }
  recognize(png: Buffer, signal?: AbortSignal): Promise<{ text: string; engine: 'ppocrv5' | 'windows'; detail: string }> {
    const pending = this.recognizing.then(() => this.recognizeNow(png, signal))
    this.recognizing = pending.catch(() => undefined)
    return pending
  }
  private async recognizeNow(png: Buffer, signal?: AbortSignal): Promise<{ text: string; engine: 'ppocrv5' | 'windows'; detail: string }> {
    signal?.throwIfAborted()
    if (!this.installing && !this.checking && ['installed', 'ready'].includes(this.status.state)) {
      try {
        if (this.status.state === 'installed') await this.verifyInstalled()
        this.update({ state: 'loading', detail: '正在加载 PP-OCRv5 并识别选区…' })
        const text = await this.invoke(this.directory, png, signal)
        this.update({ state: 'ready', engine: 'ppocrv5', detail: 'PP-OCRv5 离线识别正常。' })
        return { text, engine: 'ppocrv5', detail: 'PP-OCRv5 · 本地识别' }
      } catch {
        if (signal?.aborted) { this.update({ state: 'installed', detail: '本次识别已取消，下次可重新加载。' }); signal.throwIfAborted() }
        this.update({ state: 'failed', engine: 'windows', detail: 'PP-OCRv5 识别失败，已切换 Windows OCR。可在设置中检查或重新安装。' })
      }
    }
    signal?.throwIfAborted()
    let text: string
    try { text = await this.fallback(png, undefined, signal) }
    catch (error) {
      if (!signal?.aborted) this.update({ detail: 'Windows OCR 备用识别也未完成，请检查系统语言支持或重新安装 PP-OCRv5。' })
      throw error
    }
    return { text, engine: 'windows', detail: `Windows OCR · 备用识别。${this.status.detail}` }
  }
}

let local: LocalScreenOcr | undefined
export function configureScreenOcr(userData: string, resources: string): LocalScreenOcr {
  local = new LocalScreenOcr(userData, resources)
  return local
}
export async function recognizeScreenText(png: Buffer, signal?: AbortSignal): Promise<{ text: string; engine: 'ppocrv5' | 'windows'; detail: string }> {
  if (local) return local.recognize(png, signal)
  return { text: await recognizePngAsync(png, undefined, signal), engine: 'windows', detail: 'Windows OCR · 本地识别' }
}
