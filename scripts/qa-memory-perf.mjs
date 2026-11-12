#!/usr/bin/env node
/**
 * QA：大量长期记忆 / 长历史的本地性能基准（可重复运行）。
 * - 用隔离 userData 启动真实应用，经 IPC 写入 N 条记忆，再测量记忆页/房间视图/搜索的可见耗时；
 * - 再创建 M 个会话，测量 bootstrap 与历史页可见耗时；
 * - 输出 artifacts/qa-runtime-2026-11-13/memory-perf/{summary.json,report.md}。
 *
 * 用法：
 *   node scripts/qa-memory-perf.mjs
 *   QA_MEM_COUNT=500 QA_CONV_COUNT=300 node scripts/qa-memory-perf.mjs
 */
import { _electron as electron } from 'playwright'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(ROOT, 'artifacts', 'qa-runtime-2026-11-13', 'memory-perf')
mkdirSync(OUT_DIR, { recursive: true })
const MEM_COUNT = Math.max(20, Number(process.env.QA_MEM_COUNT || 500))
const CONV_COUNT = Math.max(10, Number(process.env.QA_CONV_COUNT || 300))
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const findings = []

const userData = mkdtempSync(join(tmpdir(), 'murasame-qa-memperf-'))
writeFileSync(join(userData, 'murasame.json'), JSON.stringify({ settings: { onboardingDone: true } }))
const env = { ...process.env, MURASAME_USER_DATA: userData }
delete env.ELECTRON_RUN_AS_NODE

async function launch() {
  const app = await electron.launch({ args: ['.'], cwd: ROOT, env })
  let page = null
  for (let attempt = 0; attempt < 200; attempt += 1) {
    for (const candidate of app.windows()) {
      if (candidate.isClosed() || candidate.url().includes('/pet.html')) continue
      if (await candidate.evaluate(() => Boolean(window.murasame)).catch(() => false)) page = candidate
    }
    if (page) break
    await sleep(100)
  }
  if (!page) throw new Error('主窗口未就绪')
  await page.evaluate(() => window.murasame.window.showMain()).catch(() => undefined)
  let pid = 0
  try { pid = app.process().pid } catch { /* ignore */ }
  return { app, page, pid }
}

async function cardCount(page, testid) {
  return page.evaluate((id) => document.querySelectorAll(`[data-testid="${id}"]`).length, testid)
}

async function waitCount(page, testid, target, timeout = 30_000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const count = await cardCount(page, testid)
    if (count >= target) return { count, elapsed: Date.now() - started }
    await sleep(50)
  }
  return { count: await cardCount(page, testid), elapsed: Date.now() - started, timedOut: true }
}

async function main() {
  const run = { at: new Date().toISOString(), memCount: MEM_COUNT, convCount: CONV_COUNT, measurements: {}, counts: {} }
  const { app, page, pid } = await launch()
  try {
    let bootstrapError = ''
    for (let attempt = 0; attempt < 40; attempt += 1) {
      bootstrapError = await page.evaluate(async () => {
        const result = await window.murasame.core.getBootstrap()
        return result.ok ? '' : result.error
      }).catch((error) => String(error))
      if (!bootstrapError) break
      await sleep(250)
    }
    run.bootstrapWarmupError = bootstrapError
    // 1) 播种记忆（每批 50 条，记录总耗时与单条均值）
    const seedStarted = Date.now()
    const batchTimes = []
    for (let offset = 0; offset < MEM_COUNT; offset += 50) {
      const size = Math.min(50, MEM_COUNT - offset)
      const batch = Date.now()
      const outcome = await page.evaluate(async ({ start, count }) => {
        let failures = 0
        let firstError = ''
        for (let index = 0; index < count; index += 1) {
          const result = await window.murasame.core.addMemory('偏好', `第${start + index + 1}条：关于偏好与项目上下文的长期记忆样本。`)
          if (!result.ok) {
            failures += 1
            if (!firstError) firstError = result.error
          }
        }
        return { failures, firstError }
      }, { start: offset, count: size })
      batchTimes.push({ size, ms: Date.now() - batch, failed: outcome.failures, firstError: outcome.firstError })
    }
    run.measurements.seedMemoriesTotalMs = Date.now() - seedStarted
    run.measurements.seedBatches = batchTimes
    run.counts.seedFailures = batchTimes.reduce((sum, item) => sum + item.failed, 0)

    // 2) 记忆页第一屏 / 全部卡片 / 搜索 / 房间视图
    const navStarted = Date.now()
    await page.getByTestId('nav-memory').click()
    const firstCard = await waitCount(page, 'memory-card', 1)
    run.measurements.memoryFirstCardMs = firstCard.elapsed
    const allCards = await waitCount(page, 'memory-card', MEM_COUNT, 30_000)
    run.measurements.memoryAllCardsMs = Date.now() - navStarted
    run.counts.memoryCards = allCards.count

    const searchStarted = Date.now()
    await page.getByLabel('搜索记忆').fill(`第${MEM_COUNT}条`)
    const filtered = await waitCount(page, 'memory-card', 1, 10_000)
    run.measurements.memorySearchFirstResultMs = Date.now() - searchStarted
    run.counts.filteredCards = filtered.count
    await page.getByLabel('搜索记忆').fill('')

    const roomStarted = Date.now()
    await page.getByTestId('memory-view-room').click()
    const roomFirst = await waitCount(page, 'memory-room-card', 1)
    run.measurements.roomFirstCardMs = roomFirst.elapsed
    const roomAll = await waitCount(page, 'memory-room-card', MEM_COUNT, 30_000)
    run.measurements.roomAllCardsMs = Date.now() - roomStarted
    run.counts.roomCards = roomAll.count
    await page.getByTestId('memory-view-list').click()

    // 3) 长历史：创建会话 → bootstrap → 历史页
    const convStarted = Date.now()
    run.counts.conversationFailures = await page.evaluate(async (count) => {
      let failures = 0
      for (let index = 0; index < count; index += 1) {
        const result = await window.murasame.core.createConversation()
        if (!result.ok) failures += 1
      }
      return failures
    }, CONV_COUNT)
    run.measurements.createConversationsTotalMs = Date.now() - convStarted

    run.measurements.bootstrapMs = await page.evaluate(async () => {
      const started = performance.now()
      const result = await window.murasame.core.getBootstrap()
      return {
        elapsed: Math.round((performance.now() - started) * 10) / 10,
        ok: result.ok,
        sizes: result.ok ? { conversations: result.data.conversations.length, memories: result.data.memories.length } : null
      }
    })

    const historyStarted = Date.now()
    await page.getByTestId('nav-history').click()
    const historyFirst = await waitCount(page, 'history-item', 1)
    run.measurements.historyFirstItemMs = Date.now() - historyStarted
    run.counts.historyItems = historyFirst.count

    run.measurements.rendererHeapMB = await page.evaluate(() => {
      const memory = performance.memory
      return memory ? Math.round((memory.usedJSHeapSize / 1024 / 1024) * 10) / 10 : null
    })
    run.measurements.mainHeapMB = await app.evaluate(({ app }) => {
      try {
        const metrics = app.getAppMetrics()
        const main = metrics.find((item) => item.type === 'Browser')
        return main ? Math.round((main.memory.workingSetSize / 1024) * 10) / 10 : null
      } catch {
        return null
      }
    })

    // 4) 阈值判定（宽松基准；如实记录实际值，超出才报 P2/P3）
    const m = run.measurements
    if ((m.memoryFirstCardMs ?? 0) > 2000) findings.push({ severity: 'P2', id: 'QA-PERF-MEM-01', detail: `500 条记忆首次可见 ${m.memoryFirstCardMs}ms（>2000ms）` })
    if ((m.roomAllCardsMs ?? 0) > 15_000) findings.push({ severity: 'P3', id: 'QA-PERF-MEM-02', detail: `房间视图渲染 ${MEM_COUNT} 张卡片 ${m.roomAllCardsMs}ms` })
    if ((m.memorySearchFirstResultMs ?? 0) > 1500) findings.push({ severity: 'P3', id: 'QA-PERF-MEM-03', detail: `搜索首次结果 ${m.memorySearchFirstResultMs}ms（>1500ms）` })
    if (!m.bootstrapMs?.ok) findings.push({ severity: 'P2', id: 'QA-PERF-MEM-04', detail: '大量数据后 bootstrap 失败' })
    if (run.counts.memoryCards !== MEM_COUNT) findings.push({ severity: 'P2', id: 'QA-PERF-MEM-05', detail: `记忆条数不符：${run.counts.memoryCards}/${MEM_COUNT}` })
    run.findings = findings
    run.passed = findings.every((item) => item.severity !== 'P0' && item.severity !== 'P1')
  } finally {
    try { await app.close() } catch { /* ignore */ }
    try { process.kill(pid) } catch { /* ignore */ }
  }

  writeFileSync(join(OUT_DIR, 'summary.json'), JSON.stringify(run, null, 2))
  const lines = ['# 大量记忆 / 长历史本地性能基准', '', `- 时间：${run.at}`, `- 记忆数：${MEM_COUNT}；会话数：${CONV_COUNT}`, '', '## 测量', '']
  for (const [key, value] of Object.entries(run.measurements)) {
    if (key === 'seedBatches') continue
    lines.push(`- ${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`)
  }
  lines.push('', '## 计数', '')
  for (const [key, value] of Object.entries(run.counts)) lines.push(`- ${key}: ${value}`)
  lines.push('', '## 发现', '')
  if (!findings.length) lines.push('- 无（未超过本次宽松阈值；数值见上）')
  for (const item of findings) lines.push(`- [${item.severity}] ${item.id} ${item.detail}`)
  writeFileSync(join(OUT_DIR, 'report.md'), lines.join('\n'))
  console.log(JSON.stringify(run.measurements, null, 2))
  console.log('报告：', join(OUT_DIR, 'report.md'))
  process.exitCode = run.passed ? 0 : 2
}

main().catch((error) => {
  console.error(error)
  writeFileSync(join(OUT_DIR, 'failure.txt'), String(error?.stack || error))
  process.exitCode = 1
})
