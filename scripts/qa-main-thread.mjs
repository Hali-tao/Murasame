#!/usr/bin/env node
/**
 * QA：主线程/渲染线程阻塞测量（「运行流畅」的量化证据）。
 * - 种子数据：批量写入长期记忆、批量新建会话
 * - 在重操作（导出加密包、bootstrap 序列化、记忆页渲染、清空记忆等）期间
 *   从渲染进程持续 ping 主进程 IPC，测量主线程被同步阻塞的时长
 * - 用 PerformanceObserver(longtask) 测量渲染线程长任务
 * 输出 artifacts/qa-runtime-2026-11-13/main-thread/。
 */
import { _electron as electron } from 'playwright'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(ROOT, 'artifacts', 'qa-runtime-2026-11-13', 'main-thread')
mkdirSync(OUT_DIR, { recursive: true })
const MEMORIES = Number(process.env.QA_MEMORIES || 200)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const userData = mkdtempSync(join(tmpdir(), 'murasame-qa-mainthread-'))
writeFileSync(join(userData, 'murasame.json'), JSON.stringify({ settings: { onboardingDone: true } }))
writeFileSync(join(userData, 'qa-passphrase.txt'), 'x'.repeat(200))
const env = { ...process.env, MURASAME_USER_DATA: userData }
delete env.ELECTRON_RUN_AS_NODE

const results = []
const findings = []
const add = (severity, id, title, detail) => {
  findings.push({ severity, id, title, detail })
  console.log(`[${severity}] ${id} ${title}`)
}

function verdictForMain(blockMs) {
  if (blockMs >= 2000) return 'P1'
  if (blockMs >= 500) return 'P2'
  return null
}

async function pingLoop(page, durationMs, intervalMs = 20) {
  return page.evaluate(async ({ duration, every }) => {
    const samples = []
    const started = performance.now()
    while (performance.now() - started < duration) {
      const at = performance.now()
      try {
        await window.murasame.pet.getState()
      } catch {
        /* 记录失败但不中断采样 */
      }
      samples.push(performance.now() - at)
      await new Promise((resolve) => setTimeout(resolve, every))
    }
    samples.sort((a, b) => a - b)
    const pick = (ratio) => Math.round(samples[Math.min(samples.length - 1, Math.floor(samples.length * ratio))] * 10) / 10
    return { count: samples.length, median: pick(0.5), p95: pick(0.95), max: Math.round(samples[samples.length - 1] * 10) / 10 }
  }, { duration: durationMs, every: intervalMs })
}

async function measureMainBlock(page, label, op, budgetMs = 6000) {
  const pingsPromise = pingLoop(page, budgetMs)
  await sleep(250)
  const started = Date.now()
  let opOk = true
  let opError = null
  let opResult = null
  try {
    opResult = await op()
  } catch (error) {
    opOk = false
    opError = String(error).slice(0, 300)
  }
  const opMs = Date.now() - started
  const pings = await pingsPromise
  const record = { label, opMs, opOk, opError, opResult, pings }
  const severity = verdictForMain(pings.max)
  record.blockSeverity = severity
  if (severity) add(severity, `QA-MAINTHREAD-${results.length + 1}`, `${label} 期间主线程阻塞 ${pings.max}ms`, JSON.stringify(pings))
  results.push(record)
  console.log(`[main] ${label}: op=${opMs}ms ping median=${pings.median}ms p95=${pings.p95}ms max=${pings.max}ms`)
  return record
}

async function measureFrameGaps(page, action, windowMs = 3500) {
  const gapsPromise = page.evaluate((ms) => new Promise((resolve) => {
    const gaps = []
    let last = performance.now()
    const started = last
    const tick = () => {
      const now = performance.now()
      if (now - last > 0) gaps.push(now - last)
      last = now
      if (now - started < ms) requestAnimationFrame(tick)
      else resolve(gaps)
    }
    requestAnimationFrame(tick)
  }), windowMs)
  await action()
  const gaps = await gapsPromise
  gaps.sort((a, b) => a - b)
  const pick = (ratio) => Math.round(gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * ratio))] * 10) / 10
  return { frames: gaps.length, median: pick(0.5), p95: pick(0.95), max: Math.round((gaps[gaps.length - 1] ?? 0) * 10) / 10 }
}

async function measureLongTasks(page, action, observeMs = 4000) {
  const support = await page.evaluate(() => PerformanceObserver.supportedEntryTypes.includes('longtask'))
  const longTasksPromise = page.evaluate((ms) => new Promise((resolve) => {
    const entries = []
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) entries.push({ duration: Math.round(entry.duration), start: Math.round(entry.startTime) })
    })
    try {
      observer.observe({ entryTypes: ['longtask'] })
    } catch {
      /* 环境不支持 longtask 时返回空 */
    }
    setTimeout(() => {
      observer.disconnect()
      resolve(entries)
    }, ms)
  }), observeMs)
  await action()
  const entries = await longTasksPromise
  const total = entries.reduce((sum, entry) => sum + entry.duration, 0)
  return { entries, total, max: entries.reduce((max, entry) => Math.max(max, entry.duration), 0), supported: support }
}

async function main() {
  const app = await electron.launch({ args: ['.'], cwd: ROOT, env })
  let page = null
  let petPage = null
  for (let attempt = 0; attempt < 200; attempt += 1) {
    for (const candidate of app.windows()) {
      if (candidate.isClosed()) continue
      if (candidate.url().includes('/pet.html')) petPage = candidate
      else page = candidate
    }
    if (page && petPage) break
    await sleep(100)
  }
  if (!page) throw new Error('主窗口未就绪')
  await page.evaluate(() => window.murasame.window.showMain()).catch(() => undefined)
  await sleep(300)
  const baseline = await pingLoop(page, 1500)
  console.log('基线 IPC：', JSON.stringify(baseline))

  // 种子：200 条长期记忆 + 120 个空会话
  const seed = await page.evaluate(async (count) => {
    const addStartedAt = performance.now()
    let added = 0
    for (let index = 0; index < count; index += 1) {
      const result = await window.murasame.core.addMemory('偏好', `压测记忆 ${index}：${'细节'.repeat(index % 5)} 编号${index}`)
      if (result?.ok) added += 1
    }
    const conversationsStartedAt = performance.now()
    let conversations = 0
    for (let index = 0; index < Math.round(count * 0.6); index += 1) {
      const result = await window.murasame.core.createConversation()
      if (result?.ok) conversations += 1
    }
    return { added, addMs: Math.round(performance.now() - addStartedAt), conversations, conversationMs: Math.round(performance.now() - conversationsStartedAt) }
  }, MEMORIES)
  console.log('种子数据：', JSON.stringify(seed))

  await measureMainBlock(page, 'getBootstrap（含全部记忆/会话/任务）', async () => {
    return page.evaluate(() => {
      const started = performance.now()
      return window.murasame.core.getBootstrap().then((result) => {
        const json = result?.ok ? JSON.stringify(result.data) : ''
        return { ok: Boolean(result?.ok), ms: Math.round(performance.now() - started), jsonBytes: json.length }
      })
    })
  })
  const bootstrapRecord = results[results.length - 1]
  bootstrapRecord.payloadBytes = bootstrapRecord.opResult?.jsonBytes
  bootstrapRecord.bootstrapOk = bootstrapRecord.opResult?.ok

  // 先测大量记忆下的渲染：clear() 是软删除 + 抑制，之后再导入会被业务规则跳过，
  // 因此「导入到全新资料目录」的恢复路径由 e2e QA-IPC-13 覆盖，这里只测渲染与导出/清空。
  await page.reload()
  await page.waitForSelector('[data-testid="nav-overview"]', { timeout: 15000 }).catch(() => undefined)
  await sleep(1000)

  const frames = await measureFrameGaps(page, async () => {
    await page.getByTestId('nav-memory').click()
    await sleep(600)
  }, 3500)
  const render = await measureLongTasks(page, async () => { await sleep(500) }, 1200)
  const cards = await page.locator('[data-testid="memory-card"]').count()
  console.log(`[render] 记忆页 ${cards} 张卡片，frame max gap=${frames.max}ms，longtask supported=${render.supported} total=${render.total}ms`)
  if (frames.max >= 1000) add('P2', 'QA-MAINTHREAD-RENDER', `记忆页渲染出现 ${frames.max}ms 帧阻塞`, `cards=${cards}, frames=${JSON.stringify(frames)}`)
  results.push({ label: 'memory-page-render', cards, frames, longTaskSupported: render.supported, longTaskTotal: render.total, longTaskMax: render.max })

  const exportPath = join(userData, 'qa-export.murapack')
  await measureMainBlock(page, '导出加密数据包（200 位口令，含全部记忆/会话）', async () => {
    await page.evaluate(async (target) => {
      const result = await window.murasame.data.exportBundle('x'.repeat(200), target)
      if (!result?.ok) throw new Error(result?.error ?? 'export failed')
    }, exportPath)
  })

  await measureMainBlock(page, '清空全部长期记忆', async () => {
    await page.evaluate(async () => {
      const result = await window.murasame.core.clearMemories()
      if (!result?.ok) throw new Error(result?.error ?? 'clear failed')
    })
  })
  const afterClear = await page.evaluate(() => window.murasame.core.getBootstrap().then((result) => (result?.ok ? result.data.memories.length : -1)))
  results.push({ label: 'memory-clear-result', remaining: afterClear })

  const summary = {
    at: new Date().toISOString(),
    baseline,
    seed,
    results,
    findings,
    thresholds: { mainBlockP1ms: 2000, mainBlockP2ms: 500, rendererLongTaskP2ms: 1000 }
  }
  writeFileSync(join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2))
  const lines = [
    '# 主线程/渲染线程阻塞测量',
    '',
    `- 时间：${summary.at}`,
    `- 基线 IPC：median ${baseline.median}ms / p95 ${baseline.p95}ms / max ${baseline.max}ms`,
    `- 种子：${seed.added} 条记忆（${seed.addMs}ms）、${seed.conversations} 个会话（${seed.conversationMs}ms）`,
    '',
    '| 操作 | 操作耗时(ms) | 期间主线程 ping 最大(ms) | 判定 | 备注 |',
    '| --- | --- | --- | --- | --- |'
  ]
  for (const item of results.filter((entry) => entry.pings)) {
    lines.push(`| ${item.label} | ${item.opMs} | ${item.pings.max} | ${item.blockSeverity ?? 'OK'} | ${item.payloadBytes ? `${item.payloadBytes} bytes` : ''}${item.opError ? `；${item.opError}` : ''} |`)
  }
  const renderItem = results.find((item) => item.label === 'memory-page-render')
  lines.push('', '## 渲染线程', `- 记忆页 ${renderItem.cards} 张卡片：帧间隔 median ${renderItem.frames.median}ms / p95 ${renderItem.frames.p95}ms / max ${renderItem.frames.max}ms`, `- longtask 支持：${renderItem.longTaskSupported}（总 ${renderItem.longTaskTotal}ms，最长 ${renderItem.longTaskMax}ms）`, '', '## 发现')
  if (findings.length === 0) lines.push('- 无')
  for (const finding of findings) lines.push(`- [${finding.severity}] ${finding.id} ${finding.title}`)
  writeFileSync(join(OUT_DIR, 'report.md'), lines.join('\n'))
  console.log('报告：', join(OUT_DIR, 'report.md'))
  try {
    await app.close()
  } catch {
    /* ignore */
  }
  process.exitCode = findings.some((item) => item.severity === 'P0' || item.severity === 'P1') ? 2 : 0
}

main().catch((error) => {
  console.error(error)
  writeFileSync(join(OUT_DIR, 'failure.txt'), String(error?.stack || error))
  process.exitCode = 1
})
