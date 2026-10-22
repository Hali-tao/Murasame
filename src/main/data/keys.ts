import { randomBytes } from 'node:crypto'
import { app, safeStorage } from 'electron'
import Store from 'electron-store'

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
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Windows 安全存储当前不可用，无法保管数据库主密钥')
  }
  const current = keyStore()
  const existing = current.get('encryptedKey')
  if (existing) {
    try {
      return safeStorage.decryptString(Buffer.from(existing, 'base64'))
    } catch (cause) {
      throw new Error(
        '本机安全存储无法解密已保存的数据库密钥。这通常意味着密钥记录已损坏，'
        + `请删除 ${current.path} 后重新启动，原有加密数据将无法再读取。`,
        { cause }
      )
    }
  }
  const key = randomBytes(32).toString('hex')
  current.set('encryptedKey', safeStorage.encryptString(key).toString('base64'))
  return key
}

export function getUserDataDir(): string {
  return app.getPath('userData')
}
