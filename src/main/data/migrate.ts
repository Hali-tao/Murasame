import type { SqliteDatabase } from './sqlite-types'
import { rejectDowngrade } from './upgrade'

export interface Migration {
  version: number
  sql: string
}

export function migrate(db: SqliteDatabase, migrations: readonly Migration[]): number {
  db.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`)
  const currentRow = db.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).get() as
    | { value: string }
    | undefined
  let current = Number(currentRow?.value ?? 0)
  const newest = [...migrations].reduce((max, item) => Math.max(max, item.version), 0)
  const rejection = rejectDowngrade(current, newest)
  if (rejection) throw new Error(rejection)
  const writeVersion = db.prepare(
    `INSERT INTO meta(key, value) VALUES('schema_version', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  )
  const ordered = [...migrations].sort((a, b) => a.version - b.version)
  for (const migration of ordered) {
    if (migration.version <= current) continue
    const apply = db.transaction(() => {
      db.exec(migration.sql)
      writeVersion.run(String(migration.version))
    })
    apply()
    current = migration.version
  }
  return current
}
