import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { extname, resolve, sep } from 'node:path'
import type { Evidence } from '../../shared/evidence'

export function resolveInside(root: string, target: string): string {
  const base = resolve(root)
  const full = resolve(base, target)
  if (full !== base && !full.startsWith(base + sep)) throw new Error('授权目录外的路径被拒绝')
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
  writeFileSync(file, content, 'utf8')
  return { path: file, hash: createHash('sha256').update(content).digest('hex') }
}

export function readInside(root: string, relativePath: string): string {
  return readFileSync(resolveInside(root, relativePath), 'utf8')
}

export function moveInside(root: string, from: string, to: string): void {
  renameSync(resolveInside(root, from), resolveInside(root, to))
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
}

/** 一个文件一个文件地移动，每移完一个让出事件循环；取消只在两个文件之间生效。 */
export async function organizeByKind(root: string, control?: WorkControl): Promise<{ moved: string[]; total: number; stopped: boolean; note: string }> {
  const entries = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isFile())
  const moved: string[] = []
  let stopped = false
  for (const entry of entries) {
    if (control?.stopped()) {
      stopped = true
      break
    }
    const folder = folderFor(extname(entry.name).toLowerCase())
    mkdirSync(resolveInside(root, folder), { recursive: true })
    const destination = `${folder}/${entry.name}`
    moveInside(root, entry.name, destination)
    moved.push(resolveInside(root, destination))
    control?.progress(moved.length, entries.length, `${entry.name} → ${folder}`)
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  const note = stopped
    ? `取消前移动了 ${moved.length}/${entries.length} 个文件，其余没有动`
    : moved.length ? `移动了 ${moved.length} 个文件` : '目录里没有可归类的文件'
  return { moved, total: entries.length, stopped, note }
}
