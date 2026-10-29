import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { SqliteDatabase } from './sqlite-types'
import initSql from './migrations/001_init.sql?raw'
import memorySql from './migrations/002_memory.sql?raw'
import traceSql from './migrations/003_trace.sql?raw'
import { capacityStatus, databasePath } from './capacity'
import { openCipherDatabase } from './cipher'
import { getDatabaseKey, getUserDataDir } from './keys'
import { migrate, type Migration } from './migrate'

export const embeddedMigrations: readonly Migration[] = [
  { version: 1, sql: initSql },
  { version: 2, sql: memorySql },
  { version: 3, sql: traceSql }
]

let cached: SqliteDatabase | null = null

export function openMigratedDatabase(
  file: string,
  key: string,
  migrations: readonly Migration[] = embeddedMigrations
): SqliteDatabase {
  const db = openCipherDatabase(file, key)
  try {
    migrate(db, migrations)
    return db
  } catch (error) {
    db.close()
    throw error
  }
}

export function readMigrationFile(migrationsDir: string, fileName: string): Migration {
  const match = /^(\d{3})_/.exec(fileName)
  if (!match) throw new Error(`迁移文件名无效：${fileName}`)
  return { version: Number(match[1]), sql: readFileSync(join(migrationsDir, fileName), 'utf8') }
}

export function getDatabase(): SqliteDatabase {
  if (cached) return cached
  cached = openMigratedDatabase(databasePath(getUserDataDir()), getDatabaseKey())
  return cached
}

export function databaseCapacityWarning(file = databasePath(getUserDataDir())): string | null {
  try {
    return capacityStatus(statSync(file).size).message
  } catch {
    return null
  }
}

export function closeDatabase(): void {
  cached?.close()
  cached = null
}
