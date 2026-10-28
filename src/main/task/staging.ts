import type { FileEffect } from '../tools/filesystem'
import { existsSync, realpathSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readdir, readFile, writeFile, stat, unlink, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { resolveInside } from '../tools/filesystem'
export interface DeclaredOutput { path: string; overwrite?: boolean; baselineHash?: string | null; expectedHash?: string; expectedContent?: string; kind?: 'write' | 'delete' }
export interface StagedChange { path: string; kind: 'write' | 'delete'; hash: string | null; baselineHash: string | null; exported?: boolean }
export interface AwaitingExport { stageId: string; changes: StagedChange[] }
export interface StageManifest { root: string; baseline: Record<string, string>; changes: StagedChange[]; stageId: string }
const tempRoot = tmpdir()
const base = join(existsSync(tempRoot) ? realpathSync(tempRoot) : tempRoot, 'murasame-task-stages')
const digest = (data: Buffer): string => createHash('sha256').update(data).digest('hex')
function stageDir(id: string): string { if (!/^ticket-[a-zA-Z0-9_-]+$/.test(id)) throw new Error('隔离暂存标识无效'); if (existsSync(base) && realpathSync(base).toLowerCase() !== resolve(base).toLowerCase()) throw new Error('暂存根目录被重解析，拒绝读取或清理'); const dir = existsSync(base) ? resolveInside(base, id) : resolve(base, id); if (!dir.startsWith(resolve(base) + sep)) throw new Error('隔离暂存路径越界'); return dir }
export async function fileHash(root: string, path: string): Promise<string | null> { try { const file = resolveInside(root, path); if (!(await stat(file)).isFile()) throw new Error('产物不是文件'); return digest(await readFile(file)) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error } }
async function snapshot(root: string, signal?: AbortSignal): Promise<Record<string, string>> {
  const files: Record<string, string> = {}; let bytes = 0
  const walk = async (path: string): Promise<void> => {
    if (signal?.aborted) throw new Error('隔离暂存已取消')
    for (const entry of await readdir(resolveInside(root, path), { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('共享目录或暂存产物包含目录联接/符号链接，未跟随')
      const item = path ? `${path}/${entry.name}` : entry.name
      const actual = resolveInside(root, item); if ((await lstat(actual)).isSymbolicLink()) throw new Error('重解析路径被拒绝')
      if (entry.isDirectory()) await walk(item)
      else if (entry.isFile()) { const size = (await stat(actual)).size; bytes += size; if (Object.keys(files).length >= 4000 || bytes > 256 * 1024 * 1024 || size > 32 * 1024 * 1024) throw new Error('暂存超过本次任务的文件/大小预算，未执行命令'); files[item] = digest(await readFile(actual)) }
    }
  }
  await walk(''); return files
}
export async function createStage(root: string, signal?: AbortSignal): Promise<StageManifest> {
  await mkdir(base, { recursive: true }); if (realpathSync(base).toLowerCase() !== resolve(base).toLowerCase()) throw new Error('暂存根目录不能是重解析路径'); const dir = await mkdtemp(join(base, 'ticket-')); const stageId = relative(base, dir); const workspace = join(dir, 'workspace'); await mkdir(workspace)
  try {
  const copyDirectories = async (path: string): Promise<void> => { for (const entry of await readdir(resolveInside(root, path), { withFileTypes: true })) { if (signal?.aborted) throw new Error('暂存已取消'); if (entry.isSymbolicLink()) throw new Error('暂存不跟随目录联接或符号链接'); if (entry.isDirectory()) { const child = path ? `${path}/${entry.name}` : entry.name; resolveInside(root, child); await mkdir(resolveInside(workspace, child), { recursive: true }); await copyDirectories(child) } } }
  await copyDirectories('')
  const baseline = await snapshot(root, signal)
  for (const [path, hash] of Object.entries(baseline)) { if (signal?.aborted) throw new Error('暂存已取消'); const source = resolveInside(root, path); const bytes = await readFile(source); if (digest(bytes) !== hash) throw new Error(`原文件在暂存期间变化：${path}`); const target = resolveInside(workspace, path); await mkdir(dirname(target), { recursive: true }); await writeFile(target, bytes, { flag: 'wx' }) }
  const manifest: StageManifest = { root: resolve(root), baseline, stageId, changes: [] }; await saveStage(manifest); return manifest
  } catch (error) { await removeStage(stageId); throw error }
}
export function stageWorkspace(stageId: string): string { return join(stageDir(stageId), 'workspace') }
async function saveStage(manifest: StageManifest): Promise<void> { await writeFile(join(stageDir(manifest.stageId), 'manifest.json'), JSON.stringify(manifest), 'utf8') }
export async function loadStage(stageId: string, root: string): Promise<StageManifest> { const value = JSON.parse(await readFile(join(stageDir(stageId), 'manifest.json'), 'utf8')) as StageManifest; if (value.stageId !== stageId || value.root.toLowerCase() !== resolve(root).toLowerCase()) throw new Error('暂存不属于本次批准目录'); return value }
export async function inspectStage(manifest: StageManifest, signal?: AbortSignal): Promise<StagedChange[]> {
  const current = await snapshot(stageWorkspace(manifest.stageId), signal)
  manifest.changes = [...new Set([...Object.keys(manifest.baseline), ...Object.keys(current)])].filter((path) => manifest.baseline[path] !== current[path]).map((path) => ({ path, kind: current[path] ? 'write' : 'delete', hash: current[path] ?? null, baselineHash: manifest.baseline[path] ?? null, exported: manifest.changes.find((change) => change.path === path && change.hash === (current[path] ?? null))?.exported ?? false }))
  await saveStage(manifest); return manifest.changes
}
export async function exportStage(manifest: StageManifest, outputs: readonly DeclaredOutput[], gate: () => void): Promise<{ artifacts: string[]; effects: FileEffect[]; pending: StagedChange[]; error?: string }> {
  const artifacts: string[] = []; const effects: FileEffect[] = []
  let error: string | undefined
  try { for (const output of outputs) {
    const change = manifest.changes.find((item) => item.path === output.path)
    if (!change || change.exported) continue
    gate(); const target = resolveInside(manifest.root, change.path)
    const actualBaseline = await fileHash(manifest.root, change.path)
    if (actualBaseline !== change.baselineHash || output.baselineHash !== undefined && output.baselineHash !== actualBaseline) throw new Error(`原文件已变化，未覆盖：${change.path}`)
    if (actualBaseline !== null && !output.overwrite) continue
    if (change.kind === 'delete') { if (output.kind !== 'delete') continue; gate(); await unlink(resolveInside(manifest.root, change.path)); effects.push({ operation: 'delete', source: target, destination: target, hash: change.baselineHash ?? '', status: 'moved' }) }
    else {
      const data = await readFile(resolveInside(stageWorkspace(manifest.stageId), change.path)); const hash = digest(data)
      if (hash !== change.hash || output.expectedHash && output.expectedHash !== hash || output.expectedContent !== undefined && data.toString('utf8') !== output.expectedContent) throw new Error(`暂存产物核验失败：${change.path}`)
      await mkdir(dirname(target), { recursive: true }); gate(); resolveInside(manifest.root, change.path)
      if (actualBaseline === null) await writeFile(target, data, { flag: 'wx' })
      else { const temporary = `${target}.murasame-${manifest.stageId}`; await writeFile(temporary, data, { flag: 'wx' }); try { gate(); if (await fileHash(manifest.root, change.path) !== actualBaseline) throw new Error(`替换前原文件变化：${change.path}`); resolveInside(manifest.root, change.path); await rename(temporary, target) } finally { await rm(temporary, { force: true }) } }
      artifacts.push(target); effects.push({ source: '', destination: target, hash, status: 'moved' })
      if (await fileHash(manifest.root, change.path) !== hash) throw new Error(`导出产物哈希核验失败：${change.path}`)
    }
    change.exported = true; await saveStage(manifest)
  }
  } catch (caught) { error = caught instanceof Error ? caught.message : String(caught) }
  return { artifacts, effects, error, pending: manifest.changes.filter((change) => !change.exported) }
}
export async function removeStage(stageId: string): Promise<void> { const target = stageDir(stageId); if (!target.startsWith(resolve(base) + sep)) throw new Error('暂存清理越界'); await rm(target, { recursive: true, force: true }) }
