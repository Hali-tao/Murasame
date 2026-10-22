import { existsSync, statSync } from 'node:fs'
import Database from 'better-sqlite3-multiple-ciphers'
import type { SqliteDatabase } from './sqlite-types'

export function openCipherDatabase(file: string, key: string): SqliteDatabase {
  if (!/^[0-9a-f]{64}$/.test(key)) {
    throw new Error('数据库密钥格式无效')
  }
  const isNew = !existsSync(file) || statSync(file).size === 0
  const db = new Database(file)
  db.pragma(`cipher='sqlcipher'`)
  db.pragma('legacy=4')
  db.pragma(isNew ? `rekey='${key}'` : `key='${key}'`)
  db.pragma('foreign_keys = ON')
  return db
}
