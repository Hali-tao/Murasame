import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { app, safeStorage } from 'electron'
import { closeDatabase, getDatabase, openMigratedDatabase } from '../../src/main/data/db'
import { ConversationService } from '../../src/main/core/services/conversation-service'
import { MemoryService } from '../../src/main/core/services/memory-service'

const scenario = process.argv[2]
const root = process.env.MURASAME_DATABASE_FIXTURE ?? ''
assert(root && resolve(root).startsWith(`${resolve(tmpdir())}${sep}`) && root.includes('murasame-database-recovery-'))
app.setPath('userData', root)
const file = join(root, 'murasame.db')
const keyFile = join(root, 'murasame-db-key.json')
const key = 'ab'.repeat(32)
const note = 'private-fixture-must-survive-startup-failure'

function seed(): void {
  const db = openMigratedDatabase(file, key)
  try { db.exec('CREATE TABLE recovery_fixture(note TEXT NOT NULL)'); db.prepare('INSERT INTO recovery_fixture VALUES (?)').run(note) }
  finally { db.close() }
}

function encodedKey(value = key): string {
  return JSON.stringify({ encryptedKey: safeStorage.encryptString(value).toString('base64') })
}

function readNote(): void {
  assert.equal((getDatabase().prepare('SELECT note FROM recovery_fixture').get() as { note: string }).note, note)
  closeDatabase()
}

function assertRecoveryGuidance(error: unknown): boolean {
  assert(error instanceof Error)
  assert.match(error.message, /保留|未修改/)
  assert.match(error.message, /备份|恢复/)
  assert.match(error.message, /murasame\.db/)
  assert.match(error.message, /murasame-db-key\.json/)
  assert.doesNotMatch(error.message, /请删除.*murasame-db-key/)
  return true
}

app.whenReady().then(async () => {
  let code = 0
  try {
    assert(safeStorage.isEncryptionAvailable(), 'Windows safeStorage is required for this native test')
    if (scenario === 'fresh-restart-verify') {
      readNote()
    } else if (scenario === 'scoped-clear-restart-verify' || scenario === 'scoped-partial-clear-restart-verify') {
      const reopened = getDatabase()
      assert.equal((reopened.prepare('SELECT count(*) AS n FROM conversations').get() as { n: number }).n, 0)
      assert.equal(new MemoryService(reopened, root).list().length, scenario === 'scoped-partial-clear-restart-verify' ? 1 : 0)
      closeDatabase()
    } else if (scenario === 'fresh-restart') {
      const db = getDatabase()
      db.exec('CREATE TABLE recovery_fixture(note TEXT NOT NULL)')
      db.prepare('INSERT INTO recovery_fixture VALUES (?)').run(note)
      const originalKey = readFileSync(keyFile)
      closeDatabase()
      readNote()
      assert.deepEqual(readFileSync(keyFile), originalKey)
    } else if (scenario === 'orphan-journal' || scenario === 'orphan-journal-with-key') {
      writeFileSync(`${file}-wal`, 'leftover-database-pages')
      const savedKey = scenario === 'orphan-journal-with-key' ? encodedKey() : undefined
      if (savedKey) writeFileSync(keyFile, savedKey)
      assert.throws(() => getDatabase(), assertRecoveryGuidance)
      assert.equal(existsSync(file), false)
      if (savedKey) assert.equal(readFileSync(keyFile, 'utf8'), savedKey)
      else assert.equal(existsSync(keyFile), false)
      assert.equal(readFileSync(`${file}-wal`, 'utf8'), 'leftover-database-pages')
    } else if (scenario === 'migration-failure') {
      seed()
      assert.throws(() => openMigratedDatabase(file, key, [{ version: 4, sql: 'INVALID MIGRATION' }]), /syntax error/)
      // On Windows an unclosed SQLite handle prevents replacing/restoring this file.
      renameSync(file, `${file}.backup`)
      renameSync(`${file}.backup`, file)
      writeFileSync(keyFile, encodedKey())
      readNote()
    } else if (scenario === 'scoped-clear-restart' || scenario === 'scoped-partial-clear-restart') {
      const db = getDatabase()
      const originalKey = readFileSync(keyFile)
      const conversations = new ConversationService(db, { getDefault: () => null, markOffline: () => {}, markVerified: () => {} }, { chat: async () => '' })
      const conversation = conversations.create()
      db.prepare('INSERT INTO memories(id, category, text, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run('fixture-memory', 'user', '我喜欢白茶', conversation.id, 'now', 'now')
      const memory = new MemoryService(db, root)
      const partial = scenario === 'scoped-partial-clear-restart'
      if (partial) db.exec("CREATE TRIGGER reject_memory_clear BEFORE DELETE ON memories BEGIN SELECT RAISE(ABORT, 'controlled clear failure'); END")
      assert.equal((await memory.clear()).ok, !partial)
      conversations.clearCache()
      conversations.deleteHistory(conversation.id)
      closeDatabase()
      const reopened = getDatabase()
      assert.equal((reopened.prepare('SELECT count(*) AS n FROM conversations').get() as { n: number }).n, 0)
      assert.equal(new MemoryService(reopened, root).list().length, partial ? 1 : 0)
      assert.deepEqual(readFileSync(keyFile), originalKey)
      closeDatabase()
    } else if (scenario === 'interrupted-first-run') {
      // 首次启动在 Local State 落盘前被强杀：密钥密文在密码学上不可恢复。
      // 期望：备份旧文件 + 重建密钥 + 应用可继续启动，而不是永久打不开。
      seed()
      writeFileSync(keyFile, JSON.stringify({ encryptedKey: Buffer.from('not-a-Windows-secret').toString('base64') }))
      rmSync(join(root, 'Local State'), { force: true })
      assert.equal(existsSync(join(root, 'Local State')), false)
      const recovered = getDatabase()
      recovered.exec('CREATE TABLE recovery_fixture(note TEXT NOT NULL)')
      recovered.prepare('INSERT INTO recovery_fixture VALUES (?)').run('new-database-works')
      assert.equal((recovered.prepare('SELECT note FROM recovery_fixture').get() as { note: string }).note, 'new-database-works')
      closeDatabase()
      assert(existsSync(join(root, 'murasame-key-recovery.json')), 'must leave a recovery marker')
      const backups = readdirSync(root).filter((name) => name.includes('.unreadable-'))
      assert(backups.length >= 1, 'must back up the unreadable database/key')
    } else {
      seed()
      const originalDatabase = readFileSync(file)
      const goodKeyBackup = encodedKey()
      const badKeys: Record<string, string | undefined> = {
        'missing-key-file': undefined,
        'missing-key-entry': '{}',
        'null-key-entry': '{"encryptedKey":null}',
        'mismatched-key': encodedKey('cd'.repeat(32)),
        'undecryptable-key': JSON.stringify({ encryptedKey: Buffer.from('not-a-Windows-secret').toString('base64') }),
        'invalid-key': encodedKey('not-a-database-key'),
        'malformed-key-file': '{invalid-json'
      }
      assert(scenario in badKeys, `Unknown scenario: ${scenario}`)
      const badKey = badKeys[scenario]
      if (badKey !== undefined) writeFileSync(keyFile, badKey)
      // 「跨账户/跨机器恢复」场景：Local State 存在但密钥密文不属于本机账户，
      // 数据仍可能通过正确账户找回，必须 fail-closed 而不是自动重建。
      if (scenario === 'undecryptable-key' || scenario === 'invalid-key') {
        writeFileSync(join(root, 'Local State'), '{"os_crypt":{"encrypted_key":"fixture"}}')
      }
      assert.throws(() => getDatabase(), assertRecoveryGuidance)
      assert.deepEqual(readFileSync(file), originalDatabase, 'startup must preserve the encrypted database')
      if (badKey === undefined) assert.equal(existsSync(keyFile), false, 'startup must not generate a replacement key')
      else assert.equal(readFileSync(keyFile, 'utf8'), badKey, 'startup must preserve the original key record')
      // A repaired key must work immediately; a failed open must release Windows file locks.
      renameSync(file, `${file}.backup`)
      renameSync(`${file}.backup`, file)
      writeFileSync(keyFile, goodKeyBackup)
      readNote()
    }
    console.log(`PASS database-recovery ${scenario}`)
  } catch (error) {
    console.error(`FAIL database-recovery ${scenario}`, error)
    code = 1
  } finally {
    try {
      closeDatabase()
    } catch (error) {
      console.error('Temporary-fixture database close failed', error)
      code = 1
    }
    // Normal shutdown flushes Chromium's Local State used by Windows safeStorage.
    process.exitCode = code
    app.quit()
  }
})
