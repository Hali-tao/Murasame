import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')

describe('[NFR-S01] 加密数据库', () => {
  it('[NFR-S01] 加密数据库在错误口令下不可读', () => {
    const output = execFileSync(process.execPath, ['scripts/verify-native.mjs'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 60_000,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '' }
    })
    expect(output).toContain('PASS [NFR-S01]')
    expect(output).toContain('plaintext-in-file: false')
    expect(output).toContain('right-key-roundtrip: ok')
  }, 60_000)

  it('[NFR-S01] 迁移后的库保持静态加密且迁移可重复执行', () => {
    const output = execFileSync(process.execPath, ['scripts/verify-data.mjs'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 60_000,
      env: process.env
    })
    expect(output).toContain('PASS [NFR-S01] 迁移后的库保持静态加密且迁移可重复执行')
  }, 60_000)
})
