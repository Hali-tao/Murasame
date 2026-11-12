#!/usr/bin/env node
/**
 * QA：IPC 大载荷 / 不可序列化对象 / 重复导航内存增长 / 大备份恢复阻塞。
 * 输出 artifacts/qa-runtime-2026-11-13/ipc-payload/。
 */
import { _electron as electron } from 'playwright'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(ROOT, 'artifacts', 'qa-runtime-2026-11-13', 'ipc-payload')
mkdirSync(OUT_DIR, { recursive: true })
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const findings = []
const results = []
const add = (severity, id, title, detail) => {
  findings.push({ severity, id, title, detail })
  console.log(`[${severity}] ${id} ${title}`)
}

function makeUserData() {
  const dir = mkdtempSync(join(tmpdir(), 'murasame-qa-ipc-'))
  writeFileSync(join(dir, 'murasame.json'), JSON.stringify({ settings: { onboardingDone: true } }))
  return dir
}

function envFor(userData) {
  const env = { ...process.env, MURASAME_USER_DATA: userData }
  delete env.ELECTRON_RUN_AS_NODE
  return env
}

async function launch(userData) {
  const app = await electron.launch({ args: ['.'], cwd: ROOT, env: envFor(userData) })
  let mainPage = null
  for (let attempt = 0; attempt < 200; attempt += 1) {
    for (const page of app.windows()) {
      if (page.isClosed() || page.url().includes('/pet.html')) continue
      if (await page.evaluate(() => Boolean(window.murasame)).catch(() => false)) mainPage = page
    }
    if (mainPage) break
    await sleep(100)
  }
  if (!mainPage) throw new Error('主窗口未就绪')
  await mainPage.evaluate(() => window.murasame.window.showMain()).catch(() => undefined)
  return { app, mainPage }
}

async function totalMemoryMB(app) {
  const metrics = await app.evaluate(({ app }) => app.getAppMetrics().map((item) => item.memory.workingSetSize))
  return Math.round((metrics.reduce((sum, value) => sum + value, 0) / 1024) * 10) / 10
}

async function ping(page, count = 10) {
  return page.evaluate(async (times) => {
    const samples = []
    for (let index = 0; index < times; index += 1) {
      const started = performance.now()
      try {
        await window.murasame.pet.getState()
      } catch {
        /* ignore */
      }
      samples.push(performance.now() - started)
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    samples.sort((a, b) => a - b)
    return { median: Math.round(samples[Math.floor(samples.length / 2)] * 10) / 10, max: Math.round(samples[samples.length - 1] * 10) / 10 }
  }, count)
}

async function oversizedPayloads(app, page) {
  const cases = [
    { name: 'sendMessage-8MB', label: 'sendMessage 8MB 文本' },
    { name: 'addMemory-4MB', label: 'addMemory 4MB 文本' },
    { name: 'transcribe-2M-samples', label: 'transcribe 200 万个样本' },
    { name: 'updateSettings-4MB', label: 'updateSettings 4MB 字段' }
  ]
  for (const item of cases) {
    const memoryBefore = await totalMemoryMB(app)
    const outcome = await page.evaluate(async (name) => {
      const started = performance.now()
      try {
        let result
        if (name === 'sendMessage-8MB') result = await window.murasame.core.sendMessage('chat-ipc', 'x'.repeat(8 * 1024 * 1024))
        else if (name === 'addMemory-4MB') result = await window.murasame.core.addMemory('偏好', 'y'.repeat(4 * 1024 * 1024))
        else if (name === 'transcribe-2M-samples') result = await window.murasame.voice.transcribe(new Array(2_000_000).fill(0.1))
        else result = await window.murasame.settings.update({ userName: 'z'.repeat(4 * 1024 * 1024) })
        return { resolved: true, ok: Boolean(result?.ok), error: String(result?.error ?? '').slice(0, 120), ms: Math.round(performance.now() - started) }
      } catch (error) {
        return { resolved: false, thrown: String(error).slice(0, 200), ms: Math.round(performance.now() - started) }
      }
    }, item.name).catch((error) => ({ evaluateError: String(error).slice(0, 200) }))
    await sleep(300)
    const memoryAfter = await totalMemoryMB(app)
    const responsiveness = await ping(page, 6)
    results.push({ kind: 'oversized', label: item.label, outcome, memoryBefore, memoryAfter, responsiveness })
    console.log(`[ipc] ${item.label}: ${JSON.stringify(outcome)} mem ${memoryBefore}->${memoryAfter}MB ping max=${responsiveness.max}ms`)
    if (!outcome || outcome.evaluateError) add('P1', 'QA-IPC-PAYLOAD-CRASH', `${item.label} 导致渲染进程求值失败`, JSON.stringify(outcome))
    else if (outcome.ms > 5000) add('P2', 'QA-IPC-PAYLOAD-SLOW', `${item.label} 处理超过 5 秒（${outcome.ms}ms）`, JSON.stringify(outcome))
    if (responsiveness.max > 2000) add('P1', 'QA-IPC-PAYLOAD-BLOCK', `${item.label} 后主进程 ${responsiveness.max}ms 不可响应`, '')
  }

  // 不可序列化对象：structured clone 应在渲染进程被拒绝，不能影响主进程。
  const cyclic = await page.evaluate(async () => {
    const value = { name: '循环引用' }
    value.self = value
    try {
      await window.murasame.core.sendMessage('chat-ipc', value)
      return { resolved: true }
    } catch (error) {
      return { resolved: false, thrown: String(error).slice(0, 200) }
    }
  })
  const afterCyclic = await ping(page, 6)
  results.push({ kind: 'cyclic-object', cyclic, responsiveness: afterCyclic })
  console.log('[ipc] 循环引用对象：', JSON.stringify(cyclic), 'ping max=', afterCyclic.max)
  if (afterCyclic.max > 2000) add('P1', 'QA-IPC-CYCLIC-BLOCK', '循环引用对象导致主进程不可响应', '')
}

async function navigationMemoryLoop(app, page) {
  const routes = ['nav-overview', 'nav-chat', 'nav-memory', 'nav-tasks', 'nav-character', 'nav-settings']
  const samples = []
  const startMemory = await totalMemoryMB(app)
  for (let round = 0; round < 20; round += 1) {
    for (const route of routes) {
      await page.getByTestId(route).click({ timeout: 5000 }).catch(() => undefined)
      await sleep(15)
    }
    // 桌宠对话面板开关与窗口显隐
    await page.evaluate(async () => {
      await window.murasame.pet.setChatOpen(true).catch(() => undefined)
      await window.murasame.pet.setChatOpen(false).catch(() => undefined)
      await window.murasame.window.hideMain().catch(() => undefined)
      await window.murasame.window.showMain().catch(() => undefined)
    }).catch(() => undefined)
    if (round % 4 === 0 || round === 19) {
      samples.push({ round: round + 1, at: Date.now(), memoryMB: await totalMemoryMB(app) })
    }
  }
  const last = samples[samples.length - 1]
  const growthMB = Math.round((last.memoryMB - startMemory) * 10) / 10
  const record = { kind: 'navigation-memory', startMemory, endMemory: last.memoryMB, growthMB, samples }
  results.push(record)
  console.log(`[memory] 120 次导航+开关：${startMemory}MB -> ${last.memoryMB}MB（增长 ${growthMB}MB）`)
  // 内存平台判定由专门的 qa-ui-memory.mjs 负责（含 320 轮复测），这里只记录观察值，不直接下泄漏结论。
  return record
}

async function restoreImport(app, page) {
  const bundleDir = mkdtempSync(join(tmpdir(), 'murasame-qa-ipc-bundle-'))
  const path = join(bundleDir, 'restore.murapack')
  const seed = await page.evaluate(async () => {
    const started = performance.now()
    for (let index = 0; index < 200; index += 1) {
      await window.murasame.core.addMemory('偏好', `恢复压测记忆 ${index}：${'内容'.repeat(index % 6)}`)
    }
    return Math.round(performance.now() - started)
  })
  const exported = await page.evaluate((target) => window.murasame.data.exportBundle('qa-pass-123', target), path)
  return { bundleDir, path, seedMs: seed, exported: exported.ok }
}

async function measureImportBlock(app, page, path) {
  const pingPromise = page.evaluate(async () => {
    const samples = []
    const started = performance.now()
    while (performance.now() - started < 5000) {
      const at = performance.now()
      try {
        await window.murasame.pet.getState()
      } catch {
        /* ignore */
      }
      samples.push(performance.now() - at)
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    samples.sort((a, b) => a - b)
    return { median: Math.round(samples[Math.floor(samples.length / 2)] * 10) / 10, max: Math.round(samples[samples.length - 1] * 10) / 10 }
  })
  await sleep(200)
  const started = Date.now()
  const imported = await page.evaluate((target) => window.murasame.data.importBundle(target, 'qa-pass-123'), path)
  const opMs = Date.now() - started
  const pings = await pingPromise
  const after = await page.evaluate(async () => {
    const bootstrap = await window.murasame.core.getBootstrap()
    return bootstrap.ok ? bootstrap.data.memories.length : -1
  })
  console.log(`[import] 200 条真实恢复：op=${opMs}ms ping max=${pings.max}ms 记忆数=${after}`)
  return { opMs, pings, importedOk: Boolean(imported?.ok), memoriesAfter: after }
}

async function main() {
  const userDataA = makeUserData()
  const appA = await launch(userDataA)
  let bundle
  try {
    await oversizedPayloads(appA.app, appA.mainPage)
    await navigationMemoryLoop(appA.app, appA.mainPage)
    bundle = await restoreImport(appA.app, appA.mainPage)
  } finally {
    try {
      await appA.app.close()
    } catch {
      /* ignore */
    }
  }

  const userDataB = makeUserData()
  const appB = await launch(userDataB)
  try {
    const memoryBefore = await totalMemoryMB(appB.app)
    const importRecord = await measureImportBlock(appB.app, appB.mainPage, bundle.path)
    const memoryAfter = await totalMemoryMB(appB.app)
    results.push({ kind: 'restore-import', seedMs: bundle.seedMs, exported: bundle.exported, ...importRecord, memoryBefore, memoryAfter })
    if (importRecord.pings.max > 2000) add('P1', 'QA-IMPORT-BLOCK', `200 条恢复导入时主线程 ${importRecord.pings.max}ms 不可响应`, JSON.stringify(importRecord))
    else if (importRecord.pings.max > 500) add('P2', 'QA-IMPORT-BLOCK', `200 条恢复导入时主线程阻塞 ${importRecord.pings.max}ms`, JSON.stringify(importRecord))
  } finally {
    try {
      await appB.app.close()
    } catch {
      /* ignore */
    }
  }

  const summary = { at: new Date().toISOString(), findings, results }
  writeFileSync(join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2))
  const lines = [
    '# IPC 大载荷 / 重复导航 / 大备份恢复',
    '',
    `- 时间：${summary.at}`,
    '',
    '| 场景 | 结果 | 主线程最大延迟 | 内存 |',
    '| --- | --- | --- | --- |'
  ]
  for (const item of results) {
    if (item.kind === 'oversized') lines.push(`| ${item.label} | ${JSON.stringify(item.outcome)} | ${item.responsiveness.max}ms | ${item.memoryBefore}→${item.memoryAfter}MB |`)
    if (item.kind === 'cyclic-object') lines.push(`| 循环引用对象 | ${JSON.stringify(item.cyclic)} | ${item.responsiveness.max}ms | - |`)
    if (item.kind === 'navigation-memory') lines.push(`| 120 次页面导航+窗口开关 | ${item.startMemory}→${item.endMemory}MB | - | 增长 ${item.growthMB}MB |`)
    if (item.kind === 'restore-import') lines.push(`| 200 条备份恢复到全新资料目录 | op=${item.opMs}ms, ok=${item.importedOk}, 记忆数=${item.memoriesAfter} | ${item.pings.max}ms | ${item.memoryBefore}→${item.memoryAfter}MB |`)
  }
  lines.push('', '## 发现')
  if (findings.length === 0) lines.push('- 无')
  for (const finding of findings) lines.push(`- [${finding.severity}] ${finding.id} ${finding.title}`)
  writeFileSync(join(OUT_DIR, 'report.md'), lines.join('\n'))
  console.log('报告：', join(OUT_DIR, 'report.md'))
  process.exitCode = findings.some((item) => item.severity === 'P0' || item.severity === 'P1') ? 2 : 0
}

main().catch((error) => {
  console.error(error)
  writeFileSync(join(OUT_DIR, 'failure.txt'), String(error?.stack || error))
  process.exitCode = 1
})
