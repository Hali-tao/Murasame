import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { LocalScreenOcr, OCR_VERSION, verifyOcrAsset } from '../../src/main/local/screen-ocr'

const directories: string[] = []
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'murasame-ocr-runtime-'))
  directories.push(directory)
  return directory
}
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }) })

it('uses Windows OCR when uninstalled without downloading or starting a model', async () => {
  const root = await fixture(); const run = vi.fn(); const download = vi.fn(); const fallback = vi.fn(async () => '中文')
  const service = new LocalScreenOcr(root, 'resources', run, download, fallback)
  expect(service.getStatus()).toMatchObject({ state: 'missing', directory: join(root, 'models', 'pp-ocrv5') })
  expect(await service.recognize(Buffer.from('png'))).toMatchObject({ text: '中文', engine: 'windows' })
  expect(fallback).toHaveBeenCalledOnce(); expect(run).not.toHaveBeenCalled(); expect(download).not.toHaveBeenCalled()
})

it('corrupt local weights fail closed to Windows OCR and report failure', async () => {
  const root = await fixture(); const target = join(root, 'models', 'pp-ocrv5')
  await mkdir(join(target, 'runtime'), { recursive: true })
  await writeFile(join(target, 'installed.json'), JSON.stringify({ version: OCR_VERSION }))
  await writeFile(join(target, 'runtime', 'python.exe'), '')
  await writeFile(join(target, 'det.onnx'), 'corrupt')
  const run = vi.fn(); const fallback = vi.fn(async () => '备用识别')
  const service = new LocalScreenOcr(root, 'resources', run, undefined, fallback)
  expect(service.getStatus().state).toBe('installed')
  expect((await service.recognize(Buffer.from('png'))).engine).toBe('windows')
  expect(service.getStatus().state).toBe('failed')
  expect(run).not.toHaveBeenCalled()
})

it('aborted requests never fall back or start a process', async () => {
  const run = vi.fn(); const fallback = vi.fn()
  const service = new LocalScreenOcr(await fixture(), 'resources', run, undefined, fallback)
  await expect(service.recognize(Buffer.from('png'), AbortSignal.abort())).rejects.toThrow()
  expect(run).not.toHaveBeenCalled(); expect(fallback).not.toHaveBeenCalled()
})

it.skipIf(process.platform !== 'win32')('failed installation is deduplicated, cleans staging and preserves existing files', async () => {
  const root = await fixture(); const target = join(root, 'models', 'pp-ocrv5')
  await mkdir(target, { recursive: true }); await writeFile(join(target, 'keep.txt'), 'original')
  const download = vi.fn(async () => { throw new Error('受控网络失败') })
  const service = new LocalScreenOcr(root, 'resources', vi.fn(), download)
  const first = service.install(); expect(service.install()).toBe(first)
  expect(await first).toMatchObject({ state: 'failed', engine: 'windows' })
  expect(service.getStatus().detail).toContain('受控网络失败')
  expect(await readFile(join(target, 'keep.txt'), 'utf8')).toBe('original')
  expect(await readdir(join(root, 'models'))).toEqual(['pp-ocrv5'])
  expect(download).toHaveBeenCalledOnce()
})

it('checks asset size and SHA-256 before installation', () => {
  const bytes = Buffer.from('expected')
  const asset = { file: 'model', url: '', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
  expect(() => verifyOcrAsset(bytes, asset)).not.toThrow()
  expect(() => verifyOcrAsset(Buffer.from('tampered'), asset)).toThrow('校验失败')
})

it('reports failure of the Windows backup without claiming recognition succeeded', async () => {
  const service = new LocalScreenOcr(await fixture(), 'resources', vi.fn(), undefined, async () => { throw new Error('unavailable') })
  await expect(service.recognize(Buffer.from('png'))).rejects.toThrow('unavailable')
  expect(service.getStatus().detail).toContain('备用识别也未完成')
})
