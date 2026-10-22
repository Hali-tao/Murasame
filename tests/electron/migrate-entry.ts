import { app } from 'electron'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openCipherDatabase } from '../../src/main/data/cipher'
import { migrate } from '../../src/main/data/migrate'

const SECRET = 'migration-plaintext-must-not-leak'
const key = 'ab'.repeat(32)

app.whenReady().then(() => {
  const migrationsDir = process.env.MURASAME_MIGRATIONS
  const dir = mkdtempSync(join(tmpdir(), 'murasame-migrate-'))
  const file = join(dir, 'murasame.db')
  let code = 0
  try {
    if (!migrationsDir) throw new Error('未设置 MURASAME_MIGRATIONS')
    const sql = readFileSync(join(migrationsDir, '001_init.sql'), 'utf8')
    const migrations = [{ version: 1, sql }]
    const db = openCipherDatabase(file, key)
    const first = migrate(db, migrations)
    const second = migrate(db, migrations)
    if (first !== 1 || second !== 1) throw new Error(`迁移版本异常：${first} / ${second}`)
    db.prepare(
      `INSERT INTO memories(id, category, text, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run('m1', 'user', SECRET, 'test', 'now', 'now')
    db.close()

    const raw = readFileSync(file)
    if (raw.includes(Buffer.from(SECRET))) throw new Error('迁移后的库文件里出现了明文')

    const again = openCipherDatabase(file, key)
    const row = again.prepare('SELECT text FROM memories WHERE id = ?').get('m1') as { text: string } | undefined
    const version = again.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).get() as { value: string }
    again.close()
    if (row?.text !== SECRET) throw new Error('正确口令未能读回迁移后的数据')
    if (version.value !== '1') throw new Error('重复迁移改变了版本号')
    console.log('PASS [NFR-S01] 迁移后的库保持静态加密且迁移可重复执行')
  } catch (error) {
    console.error('FAIL [NFR-S01]', error instanceof Error ? error.stack ?? error.message : error)
    code = 1
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch (error) {
      console.log(`cleanup-skipped: ${error instanceof Error ? error.message : error}`)
    }
    app.exit(code)
  }
})
