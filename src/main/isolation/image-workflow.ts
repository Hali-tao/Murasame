import { randomUUID, createHash } from 'node:crypto'
import { existsSync, realpathSync, statSync } from 'node:fs'
import { open, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { solidPng } from '../agent/teammates'
import { containerPlan, runCommandAsync, runInContainerAsync, startContainerAsync, stopContainerAsync, type DockerRunner } from './docker-runtime'
export type ImageCopyResult = { ok: true; path: string; bytes: number; hash: string; sourceHash: string; note: string; procedureId: 'isolated-example-image-v1' } | { ok: false; reason: string; path?: string; bytes?: number; hash?: string; outcomeKnown?: boolean }
/** Generates a clearly labeled deterministic sample inside isolation, then
 * exports only to an already approved exact filename. It is not image-model art. */
export async function executeImageCopy(input: { hostPath: string; signal?: AbortSignal; assertAllowed: () => void; taskId?: string }, run: DockerRunner = runCommandAsync): Promise<ImageCopyResult> {
  const controller = new AbortController(); const abort = (): void => controller.abort(input.signal?.reason)
  input.signal?.addEventListener('abort', abort, { once: true }); if (input.signal?.aborted) abort()
  const timer = setTimeout(() => controller.abort(), 30000)
  const gate = (): void => { if (controller.signal.aborted) throw new Error('图片操作已取消或超时'); input.assertAllowed() }
  let id = ''; let created = false; let bytes = 0; let hash: string | undefined
  const target = resolve(input.hostPath)
  let result: ImageCopyResult = { ok: false, reason: '没有执行图片操作' }
  try {
    gate()
    const parent = dirname(target)
    if (!statSync(parent).isDirectory() || realpathSync(parent).toLowerCase() !== resolve(parent).toLowerCase()) throw new Error('图片目标父目录必须为真实目录，不能经过目录联接')
    if (existsSync(target)) throw new Error('同名目标已经存在，没有覆盖')
    const sessionId = `image-${input.taskId ?? randomUUID()}`
    const started = await startContainerAsync({ ...containerPlan(), network: 'none', sessionId }, 0, run, { signal: controller.signal, readiness: 'process' })
    if ('failed' in started) { id = started.id ?? ''; throw new Error(started.failed) }
    id = started.id
    const source = `/tmp/murasame-example-${randomUUID()}.png`
    const png = solidPng(); const expectedHash = createHash('sha256').update(png).digest('hex')
    gate()
    await runInContainerAsync(id, ['python3', '-c', 'import sys; open(sys.argv[1],"xb").write(bytes.fromhex(sys.argv[2]))', source, png.toString('hex')], run, { signal: controller.signal, timeoutMs: 8000 })
    gate()
    const read = await runInContainerAsync(id, ['python3', '-c', 'import sys,json,hashlib,base64; data=open(sys.argv[1],"rb").read(2097153); print(json.dumps({"bytes":len(data),"hash":hashlib.sha256(data).hexdigest(),"base64":base64.b64encode(data).decode()}))', source], run, { signal: controller.signal, timeoutMs: 8000 })
    const report = JSON.parse(read) as { bytes: number; hash: string; base64: string }
    if (!Number.isInteger(report.bytes) || report.bytes <= 0 || report.bytes > 2097152 || typeof report.base64 !== 'string' || report.base64.length > 2800000) throw new Error('隔离图片大小无效')
    const copied = Buffer.from(report.base64, 'base64')
    const sourceHash = createHash('sha256').update(copied).digest('hex')
    if (copied.length !== report.bytes || report.hash !== sourceHash || sourceHash !== expectedHash || !copied.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('隔离源图片内容或哈希核验失败')
    gate()
    if (realpathSync(parent).toLowerCase() !== resolve(parent).toLowerCase()) throw new Error('批准的目标目录发生变化')
    const file = await open(target, 'wx'); created = true
    try { gate(); await file.writeFile(copied); await file.sync() } finally { await file.close() }
    bytes = statSync(target).size
    // This separate read is the verifier's observation of actual host output.
    const actual = await readFile(target); hash = createHash('sha256').update(actual).digest('hex')
    if (bytes !== report.bytes || hash !== sourceHash) throw new Error('导出后图片大小或哈希核验失败')
    result = { ok: true, procedureId: 'isolated-example-image-v1', path: target, bytes, hash, sourceHash, note: `${controller.signal.aborted ? '取消前已导出' : '已导出'}确定性的示例图片；未调用绘图模型。` }
  } catch (error) {
    if (created) { try { const actual = await readFile(target); bytes = actual.length; hash = createHash('sha256').update(actual).digest('hex') } catch { /* Preserve the known created path even if its content is no longer readable. */ } }
    result = { ok: false, outcomeKnown: !created || hash !== undefined, reason: error instanceof Error ? error.message : String(error), ...(created ? { path: target, bytes, hash } : {}) }
  } finally {
    if (id && !await stopContainerAsync(id, run)) result = { ok: false, outcomeKnown: false, reason: `${result.ok ? result.note : result.reason}；隔离容器 ${id} 清理失败，停止尚未核实`, ...(created ? { path: target, bytes, hash } : {}) }
    clearTimeout(timer); input.signal?.removeEventListener('abort', abort)
  }
  return result
}
