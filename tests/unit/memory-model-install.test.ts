import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { installMemoryModel, verifyMemoryModelFile } from '../../src/main/local/memory-model-install'

afterEach(() => vi.unstubAllGlobals())

it('[FR-14] model downloads require both expected size and SHA-256', () => {
  const file = { size: 3, hash: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' }
  expect(() => verifyMemoryModelFile(Buffer.from('abc'), file)).not.toThrow()
  expect(() => verifyMemoryModelFile(Buffer.from('abd'), file)).toThrow('校验失败')
  expect(() => verifyMemoryModelFile(Buffer.from('abcd'), file)).toThrow('校验失败')
})

it('[FR-14] a corrupt download preserves the installed model and removes only its own staging directory', async () => {
  const root = mkdtempSync(join(tmpdir(), 'memory-installer-'))
  try {
    const target = join(root, 'models', 'bge-small-zh-v1.5')
    mkdirSync(target, { recursive: true }); writeFileSync(join(target, 'config.json'), 'keep-existing')
    const download = vi.fn(async () => new Response('corrupt'))
    vi.stubGlobal('fetch', download)
    await expect(installMemoryModel(root)).rejects.toThrow('校验失败')
    expect(readFileSync(join(target, 'config.json'), 'utf8')).toBe('keep-existing')
    expect(readdirSync(join(root, 'models'))).toEqual(['bge-small-zh-v1.5'])
    expect(download.mock.calls).toHaveLength(1)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
