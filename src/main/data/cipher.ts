import { existsSync, statSync } from 'node:fs'
import Database from 'better-sqlite3-multiple-ciphers'
import type { SqliteDatabase } from './sqlite-types'
import { databaseRecoveryError } from './recovery'

export function openCipherDatabase(file: string, key: string): SqliteDatabase {
  if (!/^[0-9a-f]{64}$/.test(key)) {
    throw new Error('数据库密钥格式无效')
  }
  const isNew = !existsSync(file) || statSync(file).size === 0
  const db = new Database(file)
  try {
    db.pragma(`cipher='sqlcipher'`)
    db.pragma('legacy=4')
    db.pragma(isNew ? `rekey='${key}'` : `key='${key}'`)
    // Setting the key is lazy; read the schema before migrations can write anything.
    db.prepare('SELECT count(*) FROM sqlite_master').get()
    db.pragma('foreign_keys = ON')
    return db
  } catch (cause) {
    db.close()
    if (!isNew && cause && typeof cause === 'object' && 'code' in cause
      && (cause.code === 'SQLITE_NOTADB' || cause.code === 'SQLITE_CORRUPT')) {
      throw databaseRecoveryError('现有数据库无法使用已保存的密钥打开，可能是密钥不匹配或数据库已损坏', file, cause)
    }
    throw cause
  }
}
