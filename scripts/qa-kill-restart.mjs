#!/usr/bin/env node
/**
 * QA：崩溃/强杀后的重启韧性。
 * 场景：
 *  A. 首次启动早期（Local State 尚未落盘）强杀：app 必须能通过「备份旧文件 + 重建密钥」恢复启动，
 *     并留下恢复标记；旧加密数据在密码学上不可恢复，属于已知限制（如实记录，不算静默成功）。
 *  B. 首次启动写入记忆后等待 Local State/耐久化重加密完成再强杀：重启后记忆必须还在。
 *  C. 连续强杀/重启 3 轮：每轮都能启动并被强杀。
 * 输出 artifacts/qa-runtime-2026-11-13/kill-restart/。
 */
import { _electron as electron } from 'playwright'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(ROOT, 'artifacts', 'qa-runtime-2026-11-13', 'kill-restart')
mkdirSync(OUT_DIR, { recursive: true })
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const results = []
const findings = []
const activeApps = new Set()
const add = (severity, id, title, detail) => {
  findings.push({ severity, id, title, detail })
  console.log(`[${severity}] ${id} ${title}`)
}

function envFor(userData) {
  const env = { ...process.env, MURASAME_USER_DATA: userData }
  delete env.ELECTRON_RUN_AS_NODE
  return env
}

function killTree(pid) {
  if (!pid) return
  try {
    spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
  } catch {
    /* ignore */
  }
}

function logTail(userData, lines = 25) {
  const file = join(userData, 'logs', 'main.log')
  if (!existsSync(file)) return '(no main.log)'
  return readFileSync(file, 'utf8').split('\n').slice(-lines).join('\n')
}

async function launch(userData) {
  const app = await electron.launch({ args: ['.'], cwd: ROOT, env: envFor(userData) })
  activeApps.add(app)
  let pid = 0
  try {
    pid = app.process().pid
  } catch {
    /* 连接已断开时 pid 保持 0，后续 closeSafely 会兜底 */
  }
  let mainPage = null
  let petPage = null
  for (let attempt = 0; attempt < 250; attempt += 1) {
    for (const page of app.windows()) {
      if (page.isClosed()) continue
      if (page.url().includes('/pet.html')) petPage = page
      else mainPage = page
    }
    if (mainPage && petPage) break
    await sleep(100)
  }
  if (!mainPage || !petPage) {
    const tail = logTail(userData).slice(-900)
    killTree(pid)
    activeApps.delete(app)
    throw new Error(`窗口未就绪（userData=${userData}）。main.log 尾部：${tail}`)
  }
  return { app, mainPage, petPage, pid }
}

async function forceKill(app, pid) {
  killTree(pid)
  const started = Date.now()
  while (Date.now() - started < 8000) {
    try {
      process.kill(pid, 0)
    } catch {
      activeApps.delete(app)
      return { killed: true, killedMs: Date.now() - started }
    }
    await sleep(100)
  }
  activeApps.delete(app)
  return { killed: false, killedMs: Date.now() - started }
}

async function quit(app, pid) {
  const started = Date.now()
  try {
    await Promise.race([app.evaluate(({ app }) => app.quit()), sleep(3000)])
  } catch {
    /* ignore */
  }
  while (Date.now() - started < 12000) {
    try {
      process.kill(pid, 0)
    } catch {
      activeApps.delete(app)
      return { quitMs: Date.now() - started, hung: false }
    }
    await sleep(100)
  }
  killTree(pid)
  activeApps.delete(app)
  return { quitMs: Date.now() - started, hung: true }
}

async function closeSafely(app) {
  if (!app) return
  try {
    await Promise.race([app.close(), sleep(4000)])
  } catch {
    /* ignore */
  }
}

async function verifyRestarted(userData, expectedText) {
  await sleep(700)
  const restarted = await launch(userData)
  try {
    const bootstrap = await restarted.mainPage.evaluate(() => window.murasame.core.getBootstrap())
    const exportResult = await restarted.mainPage.evaluate(
      (path) => window.murasame.data.exportBundle({ passphrase: 'qa-pass-123', path }),
      join(userData, 'after-restart.murapack')
    )
    const after = await restarted.mainPage.evaluate(() => window.murasame.core.addMemory('偏好', '重启后仍可写入'))
    const quitState = await quit(restarted.app, restarted.pid)
    return {
      bootstrapOk: Boolean(bootstrap?.ok),
      bootstrapError: bootstrap?.ok ? null : String(bootstrap?.error ?? '').slice(0, 200),
      memoryPersisted: Boolean(bootstrap?.ok && expectedText && bootstrap.data.memories.some((item) => item.text === expectedText)),
      writeAfterRestart: Boolean(after?.ok),
      exportOk: Boolean(exportResult?.ok),
      quit: quitState
    }
  } finally {
    await closeSafely(restarted.app)
  }
}

async function scenarioEarlyKill(userData) {
  const record = { name: 'early-kill-first-run', startedAt: new Date().toISOString() }
  const first = await launch(userData)
  try {
    const text = `首次运行早期写入的记忆 ${Date.now()}`
    const added = await first.mainPage.evaluate((value) => window.murasame.core.addMemory('偏好', value), text)
    record.memoryAdded = Boolean(added?.ok)
    // 立即强杀：此时 Local State 可能尚未落盘（真实窗口期内会出现密钥不可恢复）。
    record.killed = await forceKill(first.app, first.pid)
  } finally {
    await closeSafely(first.app)
  }
  // 真实窗口期依赖 Chromium prefs 落盘时机，测试里不一定稳定命中；
  // 用「删除 Local State」确定性地构造同一状态（密钥文件在、OSCrypt 密钥不在）。
  record.localStateAfterKill = existsSync(join(userData, 'Local State'))
  if (record.localStateAfterKill) {
    rmSync(join(userData, 'Local State'), { force: true })
    record.simulatedUnreadableState = true
  }
  record.databaseBeforeRestart = existsSync(join(userData, 'murasame.db'))
  const markerPath = join(userData, 'murasame-key-recovery.json')
  record.verdict = (await (async () => {
    try {
      const restartedInfo = await verifyRestarted(userData, null)
      record.restart = restartedInfo
      // 恢复标记/备份由「重启时」的恢复逻辑创建，必须在重启之后再检查。
      const marker = existsSync(markerPath) ? JSON.parse(readFileSync(markerPath, 'utf8')) : null
      record.recoveryMarker = marker ? marker.reason : null
      record.backupFiles = readdirSync(userData).filter((name) => name.includes('.unreadable-')).length
      const healthy = restartedInfo.bootstrapOk && restartedInfo.writeAfterRestart && restartedInfo.exportOk && !restartedInfo.quit.hung
      const recovered = Boolean(record.recoveryMarker) && record.backupFiles > 0
      // 恢复 = 应用可用 + 明确备份了不可恢复的旧文件；旧数据丢失是已知限制。
      return healthy && recovered ? 'OK_RECOVERED' : 'RECOVERY_ISSUES'
    } catch (error) {
      record.error = String(error).slice(0, 600)
      record.logTail = logTail(userData)
      return 'BRICKED'
    }
  })())
  results.push(record)
  console.log(`[${record.verdict}] early-kill: marker=${record.recoveryMarker} backups=${record.backupFiles} restart=${JSON.stringify(record.restart)}`)
  if (record.verdict === 'BRICKED') add('P0', 'QA-KILL-01', '首次启动早期强杀后应用仍无法启动（密钥恢复失败）', String(record.error).slice(0, 400))
  else if (record.verdict !== 'OK_RECOVERED') add('P1', 'QA-KILL-02', '首次启动早期强杀后的恢复路径不完整', JSON.stringify(record.restart ?? record.error).slice(0, 400))
  return record
}

async function scenarioDurableKill(userData) {
  const record = { name: 'durable-kill-after-local-state', startedAt: new Date().toISOString() }
  const launched = await launch(userData)
  try {
    const text = `耐久化完成后写入的记忆 ${Date.now()}`
    const added = await launched.mainPage.evaluate((value) => window.murasame.core.addMemory('偏好', value), text)
    record.memoryAdded = Boolean(added?.ok)
    // 等待 Local State（约 9 秒）与耐久化重加密完成后再强杀。
    await sleep(12_000)
    record.localState = existsSync(join(userData, 'Local State'))
    record.killed = await forceKill(launched.app, launched.pid)
    record.restart = await verifyRestarted(userData, text)
    record.verdict = record.restart.bootstrapOk && record.restart.memoryPersisted && record.restart.writeAfterRestart && !record.restart.quit.hung ? 'OK' : 'DATA_LOSS'
  } catch (error) {
    record.error = String(error).slice(0, 600)
    record.verdict = 'DATA_LOSS'
  } finally {
    await closeSafely(launched.app)
  }
  results.push(record)
  console.log(`[${record.verdict}] durable-kill: localState=${record.localState} persisted=${record.restart?.memoryPersisted} killed=${JSON.stringify(record.killed)}`)
  if (record.verdict !== 'OK') add('P1', 'QA-KILL-03', '耐久化完成后强杀仍丢记忆', JSON.stringify(record.restart ?? record.error).slice(0, 400))
  return record
}

async function scenarioRestartLoop(userData) {
  const record = { name: 'kill-restart-loop', runs: [] }
  for (let index = 0; index < 3; index += 1) {
    const started = Date.now()
    let launched = null
    try {
      launched = await launch(userData)
      const alive = await launched.app.evaluate(({ app }) => app.isReady())
      const killed = await forceKill(launched.app, launched.pid)
      record.runs.push({ run: index + 1, launchMs: Date.now() - started, alive, killed: killed.killed })
    } catch (error) {
      record.runs.push({ run: index + 1, error: String(error).slice(0, 400), logTail: logTail(userData).slice(-600) })
    } finally {
      if (launched) await closeSafely(launched.app)
    }
    await sleep(800)
  }
  record.verdict = record.runs.some((run) => run.error || !run.alive || !run.killed) ? 'LOOP_ISSUES' : 'OK'
  results.push(record)
  console.log(`[${record.verdict}] kill-restart-loop`, JSON.stringify(record.runs.map((run) => ({ run: run.run, launchMs: run.launchMs, error: Boolean(run.error) }))))
  if (record.verdict !== 'OK') add('P1', 'QA-KILL-04', '连续强杀/重启出现启动失败', JSON.stringify(record.runs.map((run) => run.error ?? '')).slice(0, 400))
  return record
}

function userDataFiles(userData) {
  const names = readdirSync(userData)
  return { fileCount: names.length, suspicious: names.filter((name) => /lock|singleton/i.test(name)) }
}

async function main() {
  // A：全新 userData，首次启动早期强杀
  const earlyDir = mkdtempSync(join(tmpdir(), 'murasame-qa-kill-early-'))
  writeFileSync(join(earlyDir, 'murasame.json'), JSON.stringify({ settings: { onboardingDone: true } }))
  const early = await scenarioEarlyKill(earlyDir)

  // B：同一 userData 重启成功后，等待耐久化再强杀
  const durable = await scenarioDurableKill(earlyDir)

  // C：连续强杀/重启
  await scenarioRestartLoop(earlyDir)

  const files = userDataFiles(earlyDir)
  if (files.suspicious.length > 0) add('P3', 'QA-KILL-05', '强杀后 userData 留下疑似锁文件', JSON.stringify(files.suspicious))

  const summary = { at: new Date().toISOString(), results, findings }
  writeFileSync(join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2))
  const lines = [
    '# 强杀/重启韧性探测',
    '',
    `- 时间：${summary.at}`,
    '',
    '| 场景 | 结论 | 关键证据 |',
    '| --- | --- | --- |',
    `| 首次启动早期强杀（Local State 未落盘） | ${early.verdict} | 恢复标记=${early.recoveryMarker ?? '-'}, 备份文件=${early.backupFiles}, 重启=${JSON.stringify(early.restart ?? early.error)} |`,
    `| 耐久化完成后强杀 | ${durable.verdict} | Local State=${durable.localState}, 记忆保留=${durable.restart?.memoryPersisted} |`,
    `| 连续强杀/重启 3 轮 | ${results.find((item) => item.name === 'kill-restart-loop')?.verdict} | 见 summary.json |`
  ]
  lines.push('', '## 发现')
  if (findings.length === 0) lines.push('- 无')
  for (const finding of findings) lines.push(`- [${finding.severity}] ${finding.id} ${finding.title}`)
  lines.push('', '## 已知限制')
  lines.push('- 首次启动前约 10 秒内（Local State 未落盘）被强杀时，旧加密数据库在密码学上无法解密；现在的行为是**备份旧文件并明确告知用户后重新开始**，不是静默丢数据，但旧数据无法恢复。')
  writeFileSync(join(OUT_DIR, 'report.md'), lines.join('\n'))
  console.log('报告：', join(OUT_DIR, 'report.md'))
  process.exitCode = findings.some((item) => item.severity === 'P0' || item.severity === 'P1') ? 2 : 0
}

main().catch(async (error) => {
  console.error(error)
  writeFileSync(join(OUT_DIR, 'failure.txt'), String(error?.stack || error))
  for (const app of activeApps) {
    await closeSafely(app)
  }
  process.exitCode = 1
})
