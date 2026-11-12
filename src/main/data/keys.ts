import { randomBytes } from 'node:crypto'
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import Store from 'electron-store'
import { databasePath } from './capacity'
import { DATABASE_KEY_FILE, databaseRecoveryError } from './recovery'
import log from '../logger'

interface KeyShape {
  encryptedKey: string | null
}

const LOCAL_STATE_FILE = 'Local State'
const RECOVERY_MARKER_FILE = 'murasame-key-recovery.json'
const DURABILITY_INTERVAL_MS = 250
const DURABILITY_ATTEMPTS = 120

let store: Store<KeyShape> | null = null
let pendingRecoveryNotice: string | null = null

/**
 * 首次启动被中断导致密钥不可恢复时，把「已备份并重新开始」的事实告知 UI 层（只消费一次）。
 */
export function consumeKeyRecoveryNotice(): string | null {
  const notice = pendingRecoveryNotice
  pendingRecoveryNotice = null
  return notice
}

function localStatePath(): string {
  return join(getUserDataDir(), LOCAL_STATE_FILE)
}

/**
 * Electron 44 的 safeStorage 在 Windows 上使用 Chromium OSCrypt（v10）密钥，而该密钥
 * 存在 Local State 里、首次启动约 10 秒后才落盘。若在此之前写入数据库密钥并被强杀，
 * 下一次启动将永远无法解密。等 Local State 落盘后用同一内存密钥重加密一次，
 * 保证之后（包括崩溃/强杀）都能恢复。
 */
function scheduleDurabilityRekey(key: string): void {
  if (existsSync(localStatePath())) return
  let attempts = 0
  const timer = setInterval(() => {
    attempts += 1
    if (existsSync(localStatePath())) {
      clearInterval(timer)
      try {
        keyStore().set('encryptedKey', safeStorage.encryptString(key).toString('base64'))
        log.info('数据库密钥已在安全存储就绪后重新加密，可跨崩溃恢复')
      } catch (error) {
        log.warn('数据库密钥耐久化重加密失败', error)
      }
      return
    }
    if (attempts >= DURABILITY_ATTEMPTS) clearInterval(timer)
  }, DURABILITY_INTERVAL_MS)
  timer.unref?.()
}

function backupUnreadableKeyMaterial(file: string): string[] {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const sources: Array<[string, string]> = [
    [file, ''],
    [`${file}-wal`, '-wal'],
    [`${file}-shm`, '-shm'],
    [join(getUserDataDir(), DATABASE_KEY_FILE), '.key']
  ]
  const backups: string[] = []
  for (const [source, suffix] of sources) {
    if (!existsSync(source)) continue
    const target = `${file}.unreadable-${stamp}${suffix}`
    try {
      copyFileSync(source, target)
      backups.push(target)
    } catch (error) {
      log.warn(`备份不可解的密钥材料失败：${source}`, error)
    }
  }
  return backups
}

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
      // 首次启动在 Local State 落盘前被强杀：OSCrypt 密钥从未持久化，旧密文在密码学上
      // 已不可恢复（不是误删/账户恢复能解决的）。此处把旧文件原样备份后重建，避免应用永久打不开。
      if (!existsSync(localStatePath())) {
        const backups = backupUnreadableKeyMaterial(file)
        try {
          for (const path of [file, `${file}-wal`, `${file}-shm`, join(getUserDataDir(), DATABASE_KEY_FILE)]) {
            if (existsSync(path)) rmSync(path, { force: true })
          }
        } catch (cleanupError) {
          throw databaseRecoveryError('无法隔离不可恢复的数据库与密钥文件，未创建新密钥', file, cleanupError)
        }
        const notice = `上次启动在初始化完成前被中断，原有加密数据库无法解密。已把旧文件备份为 *.unreadable-* 并重新开始（旧数据在密码学上不可恢复）。备份位置：${backups.join('；') || '无（文件已不存在）'}`
        pendingRecoveryNotice = notice
        try {
          writeFileSync(join(getUserDataDir(), RECOVERY_MARKER_FILE), JSON.stringify({
            at: new Date().toISOString(),
            reason: 'safe-storage-key-unreadable-and-local-state-missing',
            backups,
            notice
          }, null, 2))
        } catch (markerError) {
          log.warn('写入密钥恢复标记失败', markerError)
        }
        log.error('检测到首次启动中断导致数据库密钥不可恢复；已备份旧文件并重建新密钥', { backups, cause })
        const key = randomBytes(32).toString('hex')
        keyStore().set('encryptedKey', safeStorage.encryptString(key).toString('base64'))
        scheduleDurabilityRekey(key)
        return key
      }
      throw databaseRecoveryError('本机安全存储无法解密或验证已保存的数据库密钥', file, cause)
    }
  }
  const key = randomBytes(32).toString('hex')
  keyStore().set('encryptedKey', safeStorage.encryptString(key).toString('base64'))
  scheduleDurabilityRekey(key)
  return key
}

export function getUserDataDir(): string {
  return app.getPath('userData')
}
