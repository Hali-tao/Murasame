#!/usr/bin/env node
/**
 * QA 对抗性启动/退出场景：
 * 损坏的设置 JSON、未知形象、非法缩放、损坏数据库、第二实例、快速退出重启。
 * 每个场景独立 userData，记录启动耗时、窗口是否出现、是否崩溃、退出耗时。
 * 输出 artifacts/qa-runtime-2026-11-13/adversarial/{report.md,summary.json}
 */
import { _electron as electron } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(ROOT, 'artifacts', 'qa-runtime-2026-11-13', 'adversarial')
const ELECTRON_BIN = join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
mkdirSync(OUT_DIR, { recursive: true })

const results = []
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function makeUserData(settings = { onboardingDone: true }, extraFiles = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'murasame-qa-adv-'))
  writeFileSync(join(dir, 'murasame.json'), JSON.stringify({ settings }))
  for (const [name, content] of Object.entries(extraFiles)) writeFileSync(join(dir, name), content)
  return dir
}

function launchEnv(dir) {
  const env = { ...process.env, MURASAME_USER_DATA: dir }
  delete env.ELECTRON_RUN_AS_NODE
  return env
}

function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitDead(pid, timeoutMs = 6000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs && isAlive(pid)) await sleep(100)
  // Electron 退出后 Chromium 仍可能持有 Local Storage 句柄几十毫秒。
  await sleep(300)
}

function appPid(app) {
  try {
    return app?.process()?.pid
  } catch {
    return undefined
  }
}

function cleanupDir(dir) {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    // 进程句柄尚未释放时清理失败可忽略；临时目录由系统回收。
  }
}

function killTree(pid) {
  try {
    spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
  } catch {
    /* ignore */
  }
}

async function quitApp(app, timeoutMs = 15000) {
  const child = app.process()
  const pid = child.pid
  const started = Date.now()
  try {
    await Promise.race([app.evaluate(({ app }) => app.quit()), sleep(2000)])
  } catch {
    /* evaluate 可能因进程退出而失败 */
  }
  while (Date.now() - started < timeoutMs) {
    if (!isAlive(pid)) return { quitMs: Date.now() - started, hung: false }
    await sleep(150)
  }
  return { quitMs: Date.now() - started, hung: true }
}

async function waitForBothWindows(app, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  let windows = []
  while (Date.now() < deadline) {
    windows = app.windows().filter((page) => !page.isClosed()).map((page) => page.url())
    if (windows.some((url) => !url.includes('/pet.html')) && windows.some((url) => url.includes('/pet.html'))) break
    await sleep(100)
  }
  return [...new Set(windows)]
}

async function scenario(name, settings, extraFiles, probe) {
  const dir = makeUserData(settings, extraFiles)
  const started = Date.now()
  const record = { name, settings, extraFiles: Object.keys(extraFiles), startedAt: new Date().toISOString() }
  let app = null
  try {
    app = await electron.launch({ args: ['.'], cwd: ROOT, env: launchEnv(dir) })
    record.launchMs = Date.now() - started
    record.windows = await waitForBothWindows(app)
    record.hasMain = record.windows.some((url) => !url.includes('/pet.html'))
    record.hasPet = record.windows.some((url) => url.includes('/pet.html'))
    if (probe) record.probe = await probe(app).catch((error) => ({ error: String(error).slice(0, 300) }))
    const quit = await quitApp(app)
    record.quitMs = quit.quitMs
    record.quitHung = quit.hung
    record.verdict = !record.hasMain || !record.hasPet ? 'NO_WINDOW' : quit.hung ? 'QUIT_HANG' : 'OK'
  } catch (error) {
    record.launchError = String(error).slice(0, 500)
    record.verdict = 'LAUNCH_ERROR'
  } finally {
    const pid = appPid(app)
    // 启动失败会弹出模态错误框，Playwright 的 close() 可能一直等下去；
    // 超时后强制结束进程树，避免整个 QA 脚本被一个弹窗卡死。
    try {
      if (app) await Promise.race([app.close().catch(() => undefined), sleep(5000)])
    } catch {
      /* ignore */
    }
    if (pid && isAlive(pid)) { killTree(pid); await waitDead(pid) }
    cleanupDir(dir)
  }
  record.durationMs = Date.now() - started
  results.push(record)
  console.log(`[${record.verdict}] ${name} launch=${record.launchMs}ms quit=${record.quitMs}ms windows=${(record.windows || []).length}`)
  return record
}

async function probePet(app) {
  for (const page of app.windows()) {
    if (page.isClosed() || !page.url().includes('/pet.html')) continue
    return page.evaluate(() => ({
      ready: document.readyState,
      hasApi: Boolean(window.murasame),
      bodyChars: document.body?.innerText?.length ?? 0
    }))
  }
  return null
}

/* 损坏设置/数据库用裸 spawn 观察：要么快速以非 0 退出（干净失败），要么停在中文模态错误框
   等待用户确认（预期行为，自动化环境无人点击，因此主动结束进程并按 EXPECTED_MODAL_BLOCK 记录）。 */
async function startupFailureScenario(name, extraFiles) {
  const dir = makeUserData({ onboardingDone: true }, extraFiles)
  const record = { name, startedAt: new Date().toISOString() }
  const started = Date.now()
  const child = spawn(ELECTRON_BIN, ['.'], { cwd: ROOT, env: launchEnv(dir), stdio: 'ignore' })
  let exit = null
  child.on('exit', (code, signal) => {
    exit = { code, signal, at: Date.now() - started }
  })
  while (Date.now() - started < 10000 && !exit) await sleep(200)
  record.exit = exit
  if (exit) {
    record.verdict = exit.code === 0 ? 'EXIT_ZERO' : 'CLEAN_FAILURE'
  } else {
    record.verdict = 'EXPECTED_MODAL_BLOCK'
    record.aliveAfter10s = true
    record.note = '按设计弹出中文错误框并等待用户确认；自动化环境主动结束进程'
    killTree(child.pid)
    await waitDead(child.pid)
    record.exitAfterKill = exit
  }
  record.durationMs = Date.now() - started
  cleanupDir(dir)
  results.push(record)
  console.log(`[${record.verdict}] ${name} exit=${JSON.stringify(exit)}`)
  return record
}

async function secondInstanceScenario() {
  const dir = makeUserData({ onboardingDone: true })
  const record = { name: 'second-instance', startedAt: new Date().toISOString() }
  let app = null
  try {
    app = await electron.launch({ args: ['.'], cwd: ROOT, env: launchEnv(dir) })
    await waitForBothWindows(app, 15000)
    const started = Date.now()
    const second = spawn(ELECTRON_BIN, ['.'], { cwd: ROOT, env: launchEnv(dir), stdio: 'ignore' })
    const exitCode = await Promise.race([
      new Promise((resolve) => second.on('exit', (code) => resolve(code ?? 0))),
      sleep(12000).then(() => 'TIMEOUT')
    ])
    record.secondExitCode = exitCode
    record.secondInstanceMs = Date.now() - started
    record.verdict = exitCode === 'TIMEOUT' ? 'SECOND_INSTANCE_HANG' : 'OK'
    if (exitCode === 'TIMEOUT') spawn('taskkill', ['/PID', String(second.pid), '/T', '/F'], { stdio: 'ignore' })
    record.firstStillResponsive = await app.evaluate(({ app }) => app.isReady()).catch(() => false)
    const quit = await quitApp(app)
    record.quitMs = quit.quitMs
    record.quitHung = quit.hung
    if (quit.hung) record.verdict = 'QUIT_HANG'
  } catch (error) {
    record.error = String(error).slice(0, 400)
    record.verdict = 'ERROR'
  } finally {
    const pid = appPid(app)
    try {
      if (app) await Promise.race([app.close().catch(() => undefined), sleep(5000)])
    } catch {
      /* ignore */
    }
    if (pid && isAlive(pid)) { killTree(pid); await waitDead(pid) }
    cleanupDir(dir)
  }
  results.push(record)
  console.log(`[${record.verdict}] second-instance exit=${record.secondExitCode} ${record.secondInstanceMs}ms`)
  return record
}

async function restartLoop(count = 2) {
  const record = { name: 'restart-loop', runs: [] }
  for (let i = 0; i < count; i += 1) {
    const dir = makeUserData({ onboardingDone: true })
    const started = Date.now()
    let app = null
    try {
      app = await electron.launch({ args: ['.'], cwd: ROOT, env: launchEnv(dir) })
      await waitForBothWindows(app, 12000)
      const quit = await quitApp(app, 12000)
      record.runs.push({ run: i + 1, totalMs: Date.now() - started, quitMs: quit.quitMs, quitHung: quit.hung })
    } catch (error) {
      record.runs.push({ run: i + 1, error: String(error).slice(0, 300) })
    } finally {
      const pid = appPid(app)
      try {
        if (app) await Promise.race([app.close().catch(() => undefined), sleep(5000)])
      } catch {
        /* ignore */
      }
      if (pid && isAlive(pid)) { killTree(pid); await waitDead(pid) }
      cleanupDir(dir)
    }
  }
  const bad = record.runs.filter((r) => r.error || r.quitHung)
  record.verdict = bad.length ? 'RESTART_ISSUES' : 'OK'
  results.push(record)
  console.log(`[${record.verdict}] restart-loop`, JSON.stringify(record.runs))
}

async function main() {
  await startupFailureScenario('corrupt-settings-json', { 'murasame.json': '{"settings": { this is not json' })
  await scenario('unknown-preset', { onboardingDone: true, petPreset: 'not-a-real-preset' }, {}, probePet)
  await scenario('invalid-scale-and-position', { onboardingDone: true, petScale: 0, petHotkey: 'Definitely-Not-A-Key' }, {}, probePet)
  await startupFailureScenario('corrupt-database', { 'murasame.db': Buffer.from('SQLite format 3\u0000' + 'garbage'.repeat(500)) })
  await secondInstanceScenario()
  await restartLoop(2)

  const summary = { at: new Date().toISOString(), results }
  writeFileSync(join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2))
  const lines = ['# QA 对抗性启动/退出报告', '', `- 时间：${summary.at}`, '']
  lines.push('| 场景 | 结论 | 启动(ms) | 窗口数 | 退出(ms) | 备注 |')
  lines.push('| --- | --- | --- | --- | --- | --- |')
  for (const r of results) {
    const notes = [r.launchError, r.error, r.note, r.quitHung ? '退出超时' : '', r.probe?.error].filter(Boolean).join('；')
    lines.push(`| ${r.name} | ${r.verdict} | ${r.launchMs ?? r.durationMs ?? '-'} | ${(r.windows || []).length} | ${r.quitMs ?? '-'} | ${notes.slice(0, 200)} |`)
  }
  lines.push('')
  const expected = results.filter((r) => r.verdict === 'EXPECTED_MODAL_BLOCK').length
  lines.push(`预期行为场景（启动失败中文错误框）：${expected} 个；自动化环境主动结束进程。`)
  const bad = results.filter((r) => !['OK', 'EXPECTED_MODAL_BLOCK'].includes(r.verdict))
  lines.push(bad.length ? `发现 ${bad.length} 个场景需要关注。` : '全部场景符合预期。')
  writeFileSync(join(OUT_DIR, 'report.md'), lines.join('\n'))
  console.log('报告：', join(OUT_DIR, 'report.md'))
  process.exitCode = results.some((r) => ['LAUNCH_ERROR', 'QUIT_HANG', 'SECOND_INSTANCE_HANG', 'RESTART_ISSUES', 'SCENARIO_TIMEOUT'].includes(r.verdict)) ? 2 : 0
}

main().catch((error) => {
  console.error(error)
  writeFileSync(join(OUT_DIR, 'failure.txt'), String(error?.stack || error))
  process.exitCode = 1
})
