import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import Store from 'electron-store'
import { databasePath } from './capacity'
import { DATABASE_KEY_FILE, databaseRecoveryError } from './recovery'

interface KeyShape {
  encryptedKey: string | null
}

let store: Store<KeyShape> | null = null

/**
 * 延迟构造：electron-store 在构造时就固定 userData 路径，
 * 过早创建会让 MURASAME_USER_DATA 这类路径覆盖失效。
 */
function keyStore(): Store<KeyShape> {
  if (!store) {
    store = new Store<KeyShape>({
      name: 'murasame-db-key',
      defaults: { encryptedKey: null }
    })
  }
  return store
}

export function getDatabaseKey(): string {
  const file = databasePath(getUserDataDir())
  const keyFile = join(getUserDataDir(), DATABASE_KEY_FILE)
  // Check before constructing electron-store: its defaults may write a key file.
  // Sidecars may be the only surviving part of a partially removed database.
  const hasDatabase = existsSync(file)
  const hasSidecars = ['-wal', '-shm', '-journal'].some(suffix => existsSync(`${file}${suffix}`))
  if (!hasDatabase && hasSidecars) {
    throw databaseRecoveryError('数据库主文件缺失，但仍有数据库日志文件；没有创建新数据库', file)
  }
  let existing: unknown
  if (existsSync(keyFile)) {
    try {
      const saved: unknown = JSON.parse(readFileSync(keyFile, 'utf8'))
      if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('密钥记录格式无效')
      existing = (saved as Partial<KeyShape>).encryptedKey
    } catch (cause) {
      throw databaseRecoveryError('无法读取已保存的数据库密钥记录', file, cause)
    }
  }
  if (hasDatabase && (typeof existing !== 'string' || !existing)) {
    throw databaseRecoveryError('检测到已有数据库，但缺少对应的密钥记录；没有生成替代密钥', file)
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw databaseRecoveryError('Windows 安全存储当前不可用，无法读取或保管数据库主密钥；请先恢复 Windows 安全存储后重试', file)
  }
  if (existing !== undefined && existing !== null) {
    try {
      if (typeof existing !== 'string' || !existing) throw new Error('密钥记录格式无效')
      const key = safeStorage.decryptString(Buffer.from(existing, 'base64'))
      if (!/^[0-9a-f]{64}$/.test(key)) throw new Error('数据库密钥格式无效')
      return key
    } catch (cause) {
      throw databaseRecoveryError('本机安全存储无法解密或验证已保存的数据库密钥', file, cause)
    }
  }
  const key = randomBytes(32).toString('hex')
  keyStore().set('encryptedKey', safeStorage.encryptString(key).toString('base64'))
  return key
}

export function getUserDataDir(): string {
  return app.getPath('userData')
}
