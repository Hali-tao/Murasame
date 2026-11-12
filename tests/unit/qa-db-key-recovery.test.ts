import { mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  userData: '',
  decryptOk: true,
  encryptCalls: 0
}))

vi.mock('electron', () => ({
  app: { getPath: () => h.userData },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => {
      h.encryptCalls += 1
      // 每次密文不同，便于断言「耐久化重加密」确实写入了新密文。
      return Buffer.from(`enc:${h.encryptCalls}:${value}`)
    },
    decryptString: (buffer: Buffer) => {
      if (!h.decryptOk) throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.')
      const raw = buffer.toString()
      if (!raw.startsWith('enc:')) throw new Error('bad ciphertext')
      return raw.split(':').slice(2).join(':')
    }
  }
}))

vi.mock('electron-store', () => ({
  default: class MemoryStore {
    private values: Record<string, unknown>
    private readonly name: string
    constructor(options: { name: string; defaults: Record<string, unknown> }) {
      this.name = options.name
      this.values = structuredClone(options.defaults)
    }
    get(key: string): unknown {
      return this.values[key]
    }
    set(key: string, value: unknown): void {
      this.values[key] = value
      if (this.name === 'murasame-db-key') {
        writeFileSync(join(h.userData, 'murasame-db-key.json'), JSON.stringify({ encryptedKey: value }))
      }
    }
  }
}))

vi.mock('../../src/main/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

const DB = () => join(h.userData, 'murasame.db')
const KEY_FILE = () => join(h.userData, 'murasame-db-key.json')
const LOCAL_STATE = () => join(h.userData, 'Local State')

async function loadKeys(): Promise<typeof import('../../src/main/data/keys')> {
  vi.resetModules()
  return import('../../src/main/data/keys')
}

function seedUnreadableDatabase(): void {
  writeFileSync(DB(), 'fake-sqlcipher-database')
  writeFileSync(KEY_FILE(), JSON.stringify({ encryptedKey: Buffer.from('enc:1:' + 'a'.repeat(64)).toString('base64') }))
}

describe('[QA-KEY-00] 数据库密钥的崩溃恢复与耐久化', () => {
  beforeEach(() => {
    h.userData = mkdtempSync(join(tmpdir(), 'murasame-key-test-'))
    h.decryptOk = true
    h.encryptCalls = 0
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('[QA-KEY-01] 首次启动被中断（无 Local State 且解密失败）时备份旧文件并重建密钥，不再永久打不开', async () => {
    seedUnreadableDatabase()
    h.decryptOk = false
    const keys = await loadKeys()
    const key = keys.getDatabaseKey()
    expect(key).toMatch(/^[0-9a-f]{64}$/)
    // 旧数据库与密钥被移走（备份保留），新密钥已写入。
    expect(existsSync(DB())).toBe(false)
    const backups = readdirSync(h.userData).filter((name) => name.includes('.unreadable-'))
    expect(backups.length).toBeGreaterThanOrEqual(2)
    expect(JSON.parse(readFileSync(KEY_FILE(), 'utf8')).encryptedKey).toBeTruthy()
    const marker = JSON.parse(readFileSync(join(h.userData, 'murasame-key-recovery.json'), 'utf8'))
    expect(marker.reason).toBe('safe-storage-key-unreadable-and-local-state-missing')
    // 告知 UI：必须明确「已备份并重新开始」，不能静默。
    const notice = keys.consumeKeyRecoveryNotice()
    expect(notice).toContain('初始化完成前')
    expect(keys.consumeKeyRecoveryNotice()).toBeNull()
    // 下一次启动（安全存储可用）能拿回同一把新密钥。
    h.decryptOk = true
    expect(keys.getDatabaseKey()).toBe(key)
  })

  it('[QA-KEY-02] Local State 存在但解密失败时仍 fail-closed，绝不删除可能可恢复的数据', async () => {
    seedUnreadableDatabase()
    writeFileSync(LOCAL_STATE(), '{"os_crypt":{"encrypted_key":"x"}}')
    h.decryptOk = false
    const keys = await loadKeys()
    expect(() => keys.getDatabaseKey()).toThrow(/无法解密/)
    expect(existsSync(DB())).toBe(true)
    expect(existsSync(KEY_FILE())).toBe(true)
    expect(readdirSync(h.userData).filter((name) => name.includes('.unreadable-'))).toEqual([])
  })

  it('[QA-KEY-03] 正常可解密时返回原密钥，不备份、不重写', async () => {
    seedUnreadableDatabase()
    writeFileSync(LOCAL_STATE(), '{}')
    const keys = await loadKeys()
    expect(keys.getDatabaseKey()).toBe('a'.repeat(64))
    expect(h.encryptCalls).toBe(0)
    expect(readdirSync(h.userData).filter((name) => name.includes('.unreadable-'))).toEqual([])
  })

  it('[QA-KEY-04] 新密钥写入后若 Local State 稍后才落盘，后台用同一密钥重加密一次以跨崩溃恢复', async () => {
    const keys = await loadKeys()
    const key = keys.getDatabaseKey()
    expect(h.encryptCalls).toBe(1)
    // Local State 尚未落盘：定时器继续等待。
    vi.advanceTimersByTime(500)
    expect(h.encryptCalls).toBe(1)
    // Local State 落盘后再触发一次重加密（同一把密钥，不同密文）。
    writeFileSync(LOCAL_STATE(), '{}')
    vi.advanceTimersByTime(500)
    expect(h.encryptCalls).toBe(2)
    const stored = JSON.parse(readFileSync(KEY_FILE(), 'utf8')).encryptedKey
    expect(stored).toBe(Buffer.from(`enc:2:${key}`).toString('base64'))
  })

  it('[QA-KEY-05] Local State 已存在时创建密钥不做多余的耐久化重写', async () => {
    writeFileSync(LOCAL_STATE(), '{}')
    const keys = await loadKeys()
    keys.getDatabaseKey()
    expect(h.encryptCalls).toBe(1)
    vi.advanceTimersByTime(5000)
    expect(h.encryptCalls).toBe(1)
    expect(keys.consumeKeyRecoveryNotice()).toBeNull()
  })

  it('[QA-KEY-06] 已有数据库但缺少密钥记录时拒绝生成替代密钥（避免把可恢复数据当新库覆盖）', async () => {
    writeFileSync(DB(), 'fake-sqlcipher-database')
    const keys = await loadKeys()
    expect(() => keys.getDatabaseKey()).toThrow(/缺少对应的密钥记录/)
    expect(existsSync(DB())).toBe(true)
  })
})
