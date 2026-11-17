import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { confirmStorageStartup, initializeStorage, previousStoragePath, rollbackStorageStartup, scheduleStorageMove, validateDestination } from '../../src/main/data/storage-location'

const roots: string[] = []
function fixture(): { root: string; target: string } {
  const temp = mkdtempSync(join(tmpdir(), 'murasame-storage-test-')); roots.push(temp)
  const root = join(temp, 'original'); mkdirSync(root)
  writeFileSync(join(root, 'Local State'), 'encrypted-key-context')
  mkdirSync(join(root, 'models')); writeFileSync(join(root, 'models', 'weights.bin'), Buffer.from([0, 1, 255]))
  return { root, target: join(temp, 'murasame-desktop') }
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
describe('storage migration', () => {
  it('copies encryption context and model bytes, keeps original and persists routing', () => {
    const { root, target } = fixture()
    expect(initializeStorage(root)).toBe(root)
    scheduleStorageMove(target)
    expect(existsSync(target)).toBe(false)
    expect(initializeStorage(root)).toBe(target)
    expect(readFileSync(join(target, 'Local State'), 'utf8')).toBe('encrypted-key-context')
    expect(readFileSync(join(target, 'models', 'weights.bin'))).toEqual(Buffer.from([0, 1, 255]))
    expect(existsSync(join(root, 'Local State'))).toBe(true)
    expect(existsSync(join(target, 'storage-location.json'))).toBe(false)
    expect(initializeStorage(root)).toBe(target)
    expect(previousStoragePath()).toBe(root)
  })
  it('rejects existing and overlapping destinations', () => {
    const { root } = fixture()
    expect(() => validateDestination(root, root)).toThrow()
    expect(() => validateDestination(root, join(root, 'child'))).toThrow()
  })
  it('leaves original usable after destination becomes occupied', () => {
    const { root, target } = fixture(); initializeStorage(root); scheduleStorageMove(target)
    mkdirSync(target); writeFileSync(join(target, 'unrelated'), 'keep')
    expect(() => initializeStorage(root)).toThrow('迁移失败')
    expect(initializeStorage(root)).toBe(root)
    expect(readFileSync(join(target, 'unrelated'), 'utf8')).toBe('keep')
  })
  it('fails closed when custom disk disappears or locator is corrupted', () => {
    const { root, target } = fixture(); initializeStorage(root); scheduleStorageMove(target); initializeStorage(root)
    rmSync(target, { recursive: true })
    expect(() => initializeStorage(root)).toThrow('不可用')
    writeFileSync(join(root, 'storage-location.json'), '{broken')
    expect(() => initializeStorage(root)).toThrow()
  })
  it('rolls back only an unverified migration, never an established profile', () => {
    const { root, target } = fixture(); initializeStorage(root); scheduleStorageMove(target); initializeStorage(root)
    expect(rollbackStorageStartup()).toBe(true)
    expect(initializeStorage(root)).toBe(root)
    expect(existsSync(join(target, 'models', 'weights.bin'))).toBe(true)
    const next = `${target}-next`; scheduleStorageMove(next); initializeStorage(root)
    confirmStorageStartup()
    expect(rollbackStorageStartup()).toBe(false)
    expect(initializeStorage(root)).toBe(next)
  })
})
