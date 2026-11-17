import { closeSync, copyFileSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, realpathSync, renameSync, statfsSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

const locator = 'storage-location.json'
interface Location { current: string; pending?: string; previous?: string; unverified?: boolean }
let anchor = ''
const skipped = new Set([locator, `${locator}.tmp`, 'SingletonLock', 'SingletonCookie', 'SingletonSocket'])

function read(root: string): Location {
  if (!existsSync(join(root, locator))) return { current: root }
  const state = JSON.parse(readFileSync(join(root, locator), 'utf8')) as Location
  if (![state.current, state.pending, state.previous].every(p => p === undefined || (typeof p === 'string' && isAbsolute(p))) || !state.current) throw new Error('存储位置配置损坏，请保留数据并恢复 storage-location.json。')
  return state
}
function save(root: string, state: Location): void {
  mkdirSync(root, { recursive: true })
  const file = join(root, `${locator}.tmp`)
  writeFileSync(file, JSON.stringify(state), { mode: 0o600 })
  const fd = openSync(file, 'r+'); try { fsyncSync(fd) } finally { closeSync(fd) }
  renameSync(file, join(root, locator))
}
function nested(a: string, b: string): boolean {
  const rel = relative(a, b)
  return !rel || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}
function files(root: string): string[] {
  const result: string[] = []
  for (const entry of readdirSync(root)) {
    if (skipped.has(entry)) continue
    const path = join(root, entry)
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) throw new Error(`不能迁移包含链接的目录：${path}`)
    if (stat.isDirectory()) result.push(...files(path))
    else if (stat.isFile()) result.push(path)
  }
  return result
}
function digest(path: string): string {
  const fd = openSync(path, 'r'); const hash = createHash('sha256'); const buffer = Buffer.alloc(1024 * 1024)
  try { let count: number; while ((count = readSync(fd, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, count)) } finally { closeSync(fd) }
  return hash.digest('hex')
}
export function validateDestination(source: string, target: string): void {
  const parent = realpathSync(dirname(target))
  const actualSource = realpathSync(source)
  if (resolve(parent) !== resolve(dirname(target))) throw new Error('请选择不经过目录链接的存储位置。')
  if (nested(actualSource, target) || nested(target, actualSource)) throw new Error('新位置不能是当前目录或其上级、子目录。')
  if (existsSync(target)) throw new Error('目标目录已存在，请选择其他文件夹；不会覆盖已有文件。')
  const required = files(source).reduce((size, file) => size + lstatSync(file).size, 0)
  const disk = statfsSync(parent)
  if (disk.bavail * disk.bsize < required + 100 * 1024 * 1024) throw new Error('目标磁盘空间不足，请至少留出数据大小和额外 100 MB。')
}
/** Runs before Chromium, SQLCipher and electron-store open the profile. */
export function initializeStorage(root: string): string {
  anchor = root
  mkdirSync(root, { recursive: true })
  const state = read(root)
  if (!existsSync(state.current)) throw new Error(`存储目录不可用，请连接对应磁盘后重试：${state.current}`)
  if (!state.pending) return state.current
  const target = state.pending
  try {
    validateDestination(state.current, target)
    const staging = `${target}.migrating-${randomUUID()}`
    mkdirSync(staging)
    for (const file of files(state.current)) {
      const dest = join(staging, relative(state.current, file))
      mkdirSync(dirname(dest), { recursive: true })
      copyFileSync(file, dest)
      if (digest(file) !== digest(dest)) throw new Error(`文件校验失败：${file}`)
    }
    renameSync(staging, target)
    save(root, { current: target, previous: state.current, unverified: true })
    return target
  } catch (error) {
    save(root, { current: state.current, previous: state.previous })
    throw new Error(`迁移失败，原数据已保留，下次启动仍使用原位置。未完成的 .migrating 目录可手动清理。${String(error)}`, { cause: error })
  }
}
export function scheduleStorageMove(target: string): void {
  const state = read(anchor)
  validateDestination(state.current, target)
  save(anchor, { ...state, pending: target })
}
export function previousStoragePath(): string | undefined { return anchor ? read(anchor).previous : undefined }
export function confirmStorageStartup(): void {
  const state = read(anchor)
  if (state.unverified) save(anchor, { current: state.current, previous: state.previous })
}
export function rollbackStorageStartup(): boolean {
  const state = read(anchor)
  if (!state.unverified || !state.previous) return false
  save(anchor, { current: state.previous })
  return true
}
