import { createHash } from 'node:crypto'
import { copyFileSync, constants, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, extname, resolve, sep } from 'node:path'
import type { Evidence } from '../../shared/evidence'

export function resolveInside(root: string, target: string): string {
  const base = resolve(root)
  const full = resolve(base, target)
  if (full !== base && !full.startsWith(base + sep)) throw new Error('授权目录外的路径被拒绝')
  // Resolve every existing ancestor, including junctions and dangling links.
  if (existsSync(base)) {
    const realBase = realpathSync(base)
    let ancestor = full
    while (!existsSync(ancestor)) {
      try { if (lstatSync(ancestor).isSymbolicLink()) throw new Error('授权目录外的重解析路径被拒绝') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      if (dirname(ancestor) === ancestor) throw new Error('授权目录外的路径被拒绝')
      ancestor = dirname(ancestor)
    }
    const actual = realpathSync(ancestor)
    if (actual !== realBase && !actual.startsWith(realBase + sep)) throw new Error('授权目录外的真实路径被拒绝')
    // Reject in-root reparse traversal too: it can be retargeted between checks.
    for (let part = full; part !== base; part = dirname(part)) {
      try { if (lstatSync(part).isSymbolicLink()) throw new Error('授权目录外的重解析路径被拒绝') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    }
  }
  return full
}

export function verifyWritten(file: string, claimed: boolean): Evidence {
  const exists = (() => {
    try {
      return statSync(file).isFile()
    } catch {
      return false
    }
  })()
  return {
    kind: 'fs-stat',
    target: file,
    expected: claimed ? '存在' : '不存在',
    actual: exists ? '存在' : '不存在',
    matched: claimed === exists
  }
}

export function writeInside(root: string, relativePath: string, content: string): { path: string; hash: string } {
  const file = resolveInside(root, relativePath)
  mkdirSync(resolve(file, '..'), { recursive: true })
  resolveInside(root, relativePath)
  writeFileSync(file, content, { encoding: 'utf8', flag: 'wx' })
  return { path: file, hash: createHash('sha256').update(content).digest('hex') }
}

export function readInside(root: string, relativePath: string): string {
  return readFileSync(resolveInside(root, relativePath), 'utf8')
}

export function moveInside(root: string, from: string, to: string): void {
  const source = resolveInside(root, from)
  const target = resolveInside(root, to)
  // Exclusive copy protects a concurrently created destination; unlink only after
  // the complete copy exists. The caller records both paths even on later errors.
  copyFileSync(source, target, constants.COPYFILE_EXCL)
  unlinkSync(resolveInside(root, from))
}

export function removeInside(root: string, relativePath: string): void {
  rmSync(resolveInside(root, relativePath), { force: true })
}

function folderFor(extension: string): string {
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].includes(extension)) return '图片'
  if (['.txt', '.md', '.doc', '.docx', '.pdf', '.csv', '.json'].includes(extension)) return '文档'
  if (['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.cs', '.go', '.rs'].includes(extension)) return '代码'
  return '其他'
}

/** 把授权目录根上的文件按类型移入子目录，不另写一份“已整理”说明来冒充结果。 */
export interface WorkControl {
  stopped(): boolean
  progress(done: number, total: number, note: string): void
  signal?: AbortSignal
  guard?(): string | null
  effect?(effect: FileEffect): void
  files?: FileIntent[]
}

export interface FileEffect { operation?: 'delete'; source: string; destination: string; hash: string; status: 'moved' | 'failed'; error?: string }
export interface OrganizeResult { moved: string[]; effects: FileEffect[]; total: number; stopped: boolean; note: string; error?: string }

export interface FileIntent { source: string; destination: string; hash: string; conflict: boolean; blocked?: string }
export function organizeManifest(root: string): FileIntent[] {
  return readdirSync(resolveInside(root, '.'), { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => {
    const destination = `${folderFor(extname(entry.name).toLowerCase())}/${entry.name}`
    let blocked: string | undefined
    try { resolveInside(root, destination) } catch (error) { blocked = error instanceof Error ? error.message : String(error) }
    return { source: entry.name, destination, hash: createHash('sha256').update(readFileSync(resolveInside(root, entry.name))).digest('hex'), conflict: existsSync(resolve(root, destination)), ...(blocked ? { blocked } : {}) }
  })
}
/** Runs only the immutable approved source/target list, preserving every effect. */
export async function organizeByKind(root: string, control?: WorkControl): Promise<OrganizeResult> {
  const intents = control?.files ?? organizeManifest(root)
  const moved: string[] = []; const effects: FileEffect[] = []
  let stopped = false; let observerError: string | undefined
  for (const intent of intents) {
    if (control?.stopped() || control?.signal?.aborted) { stopped = true; break }
    const effect: FileEffect = { source: resolve(root, intent.source), destination: resolve(root, intent.destination), hash: intent.hash, status: 'failed' }
    try {
      const blocked = control?.guard?.(); if (blocked) throw new Error(blocked)
      if (intent.blocked) throw new Error(intent.blocked)
      const hash = createHash('sha256').update(readFileSync(resolveInside(root, intent.source))).digest('hex')
      if (hash !== intent.hash) throw new Error(`批准后原文件已变化，未移动：${intent.source}`)
      mkdirSync(resolveInside(root, dirname(intent.destination)), { recursive: true })
      moveInside(root, intent.source, intent.destination); effect.status = 'moved'
    } catch (error) {
      effect.error = error instanceof Error ? error.message : String(error); effects.push(effect)
      try { control?.effect?.(effect) } catch (error) { observerError = error instanceof Error ? error.message : String(error) }
      break
    }
    effects.push(effect); moved.push(effect.destination)
    try { control?.effect?.(effect); control?.progress(moved.length, intents.length, `${intent.source} → ${dirname(intent.destination)}`) } catch (error) { observerError = error instanceof Error ? error.message : String(error); break }
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  const note = stopped ? `取消前移动了 ${moved.length}/${intents.length} 个文件，其余没有动` : moved.length ? `移动了 ${moved.length} 个批准清单中的文件` : '批准清单里没有已移动的文件'
  return { moved, effects, total: intents.length, stopped, error: observerError, note: observerError ? `${note}；停止：${observerError}` : effects.some((item) => item.status === 'failed') ? `${note}；停止：${effects.at(-1)?.error}` : note }
}
