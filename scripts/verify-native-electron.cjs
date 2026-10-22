const { app } = require('electron')
const Database = require('better-sqlite3-multiple-ciphers')
const { mkdtempSync, readFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const SECRET = 'plaintext-must-not-leak-murasame'
const GOOD_KEY = 'correct-horse-battery-staple'
const BAD_KEY = 'definitely-wrong-password'

function openEncrypted(file, key) {
  const db = new Database(file)
  db.pragma(`cipher='sqlcipher'`)
  db.pragma('legacy=4')
  db.pragma(`key='${key}'`)
  return db
}

app.whenReady().then(() => {
  const dir = mkdtempSync(join(tmpdir(), 'murasame-nfr-s01-'))
  const file = join(dir, 'probe.db')
  let code = 0
  try {
    const created = new Database(file)
    created.pragma(`cipher='sqlcipher'`)
    created.pragma('legacy=4')
    created.pragma(`rekey='${GOOD_KEY}'`)
    created.exec('CREATE TABLE secret (note TEXT NOT NULL)')
    created.prepare('INSERT INTO secret (note) VALUES (?)').run(SECRET)
    created.close()

    const raw = readFileSync(file)
    if (raw.includes(Buffer.from(SECRET))) {
      throw new Error('明文出现在数据库文件中，静态加密未生效')
    }

    let rejected = false
    let rejectError = ''
    try {
      const bad = openEncrypted(file, BAD_KEY)
      bad.prepare('SELECT note FROM secret').get()
      bad.close()
    } catch (error) {
      rejected = true
      rejectError = error instanceof Error ? error.message : String(error)
    }
    if (!rejected) throw new Error('错误口令居然读到了数据')

    const good = openEncrypted(file, GOOD_KEY)
    const row = good.prepare('SELECT note FROM secret').get()
    good.close()
    if (!row || row.note !== SECRET) throw new Error('正确口令未能读回原数据')

    console.log('PASS [NFR-S01] 错误口令无法读取加密数据库')
    console.log('  cipher=sqlcipher legacy=4')
    console.log(`  wrong-key: ${rejectError}`)
    console.log('  plaintext-in-file: false')
    console.log('  right-key-roundtrip: ok')
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
