#!/usr/bin/env node
/**
 * QA 稳定性压测（soak/stress）：
 * - 隔离 userData 启动打包后的应用（out/main/index.js）
 * - 阶段：预热 → 交互压力 → 非法输入模糊 → 空闲 soak → 退出
 * - 采样主进程/渲染进程 CPU、内存、IPC 往返延迟；检测未响应、渲染进程崩溃、控制台错误
 * - 输出 artifacts/qa-runtime-2026-11-13/soak/{summary.json,metrics.jsonl,report.md}
 *
 * 用法：
 *   node scripts/qa-soak.mjs                 # 默认（约 4 分钟）
 *   QA_QUICK=1 node scripts/qa-soak.mjs      # 快速（约 90 秒）
 *   QA_IDLE_SECONDS=300 node scripts/qa-soak.mjs
 */
import { _electron as electron } from 'playwright'
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(ROOT, 'artifacts', 'qa-runtime-2026-11-13', 'soak')
const QUICK = process.env.QA_QUICK === '1'
const IDLE_SECONDS = Number(process.env.QA_IDLE_SECONDS || (QUICK ? 20 : 120))
const WARMUP_SECONDS = Number(process.env.QA_WARMUP_SECONDS || (QUICK ? 3 : 8))
const STRESS_SECONDS = Number(process.env.QA_STRESS_SECONDS || (QUICK ? 20 : 60))
const KEEP_USERDATA = process.env.QA_KEEP_USERDATA === '1'
const SAMPLE_MS = 1000

mkdirSync(OUT_DIR, { recursive: true })
const metricsPath = join(OUT_DIR, 'metrics.jsonl')
writeFileSync(metricsPath, '')

const findings = []
const addFinding = (severity, id, title, detail) => {
  findings.push({ severity, id, title, detail })
  console.log(`[${severity}] ${id} ${title}`)
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const now = () => new Date().toISOString()
const metrics = []

const userData = mkdtempSync(join(tmpdir(), 'murasame-qa-soak-'))
writeFileSync(join(userData, 'murasame.json'), JSON.stringify({ settings: { onboardingDone: true } }))

const env = { ...process.env, MURASAME_USER_DATA: userData }
delete env.ELECTRON_RUN_AS_NODE

let app = null
const consoleErrors = []
const crashes = []
let unexpectedExit = false

async function launch() {
  app = await electron.launch({ args: ['.'], cwd: ROOT, env })
  app.process().on('exit', (code, signal) => {
    if (code !== 0 && code !== null) {
      unexpectedExit = true
      addFinding('P0', 'QA-SOAK-EXIT', `应用异常退出 code=${code} signal=${signal}`, '')
    }
  })
}

async function waitForPages() {
  let mainPage = null
  let petPage = null
  for (let attempt = 0; attempt < 120; attempt += 1) {
    for (const page of app.windows()) {
      if (page.isClosed()) continue
      if (page.url().includes('/pet.html')) petPage = page
      else {
        const hasApi = await page.evaluate(() => Boolean(window.murasame)).catch(() => false)
        if (hasApi) mainPage = page
      }
    }
    if (mainPage && petPage) break
    await sleep(100)
  }
  if (!mainPage) throw new Error('主控制台窗口未在 12 秒内出现')
  if (!petPage) throw new Error('桌宠窗口未在 12 秒内出现')
  await mainPage.evaluate(() => window.murasame.window.showMain()).catch(() => undefined)
  return { mainPage, petPage }
}

function attachCrashWatchers(pages) {
  for (const [label, page] of Object.entries(pages)) {
    page.on('crash', () => {
      crashes.push({ page: label, at: now() })
      addFinding('P0', 'QA-SOAK-CRASH', `${label} 渲染进程崩溃`, '页面 crash 事件触发')
    })
    page.on('pageerror', (error) => {
      consoleErrors.push({ page: label, type: 'pageerror', message: String(error).slice(0, 500), at: now() })
    })
    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push({ page: label, type: 'console', message: message.text().slice(0, 500), at: now() })
      }
    })
  }
}

async function sample(tag) {
  const startedAt = Date.now()
  let processes = []
  let mainResponsive = false
  try {
    const evaluated = await Promise.race([
      app.evaluate(async ({ app }) =>
        app.getAppMetrics().map((m) => ({
          pid: m.pid,
          type: m.type,
          name: m.name,
          cpu: Math.round(m.cpu.percentCPUUsage * 10) / 10,
          memoryMB: Math.round((m.memory.workingSetSize / 1024) * 10) / 10
        }))
      ),
      sleep(15000).then(() => 'timeout')
    ])
    if (evaluated === 'timeout') {
      addFinding('P0', 'QA-SOAK-HANG', '主进程 15 秒未响应 app.getAppMetrics', `tag=${tag}`)
    } else {
      processes = evaluated
      mainResponsive = true
    }
  } catch (error) {
    addFinding('P0', 'QA-SOAK-MAIN-ERR', '主进程评估失败', String(error).slice(0, 300))
  }
  const mainLatency = Date.now() - startedAt
  const totals = processes.reduce(
    (acc, p) => ({ cpu: acc.cpu + (p.cpu || 0), memoryMB: acc.memoryMB + (p.memoryMB || 0) }),
    { cpu: 0, memoryMB: 0 }
  )
  const record = {
    at: now(),
    tag,
    mainLatency,
    mainResponsive,
    processes,
    totalCpu: Math.round(totals.cpu * 10) / 10,
    totalMemoryMB: Math.round(totals.memoryMB * 10) / 10,
    consoleErrors: consoleErrors.length,
    crashes: crashes.length
  }
  metrics.push(record)
  appendFileSync(metricsPath, `${JSON.stringify(record)}\n`)
  return record
}

async function ipcLatency(page, iterations = 40) {
  return page.evaluate(async (count) => {
    const samples = []
    for (let i = 0; i < count; i += 1) {
      const started = performance.now()
      await window.murasame.pet.getState()
      samples.push(performance.now() - started)
    }
    samples.sort((a, b) => a - b)
    return {
      count: samples.length,
      median: Math.round(samples[Math.floor(samples.length / 2)] * 100) / 100,
      p95: Math.round(samples[Math.floor(samples.length * 0.95)] * 100) / 100,
      max: Math.round(samples[samples.length - 1] * 100) / 100
    }
  }, iterations)
}

async function uiProbe(page) {
  const started = Date.now()
  try {
    const state = await Promise.race([
      page.evaluate(() => ({
        ready: document.readyState,
        buttons: document.querySelectorAll('button').length,
        bodyLength: document.body?.innerText?.length || 0
      })),
      sleep(8000).then(() => 'timeout')
    ])
    const latency = Date.now() - started
    if (state === 'timeout' || latency > 3000) {
      addFinding('P0', 'QA-SOAK-RENDER-HANG', `渲染进程探针超时（${latency}ms）`, '')
      return { latency, state: 'timeout' }
    }
    return { latency, state }
  } catch (error) {
    addFinding('P1', 'QA-SOAK-RENDER-ERR', '渲染进程探针异常', String(error).slice(0, 300))
    return { latency: Date.now() - started, state: 'error' }
  }
}

async function stressInteractions({ mainPage, petPage }) {
  const deadline = Date.now() + STRESS_SECONDS * 1000
  const presets = ['whale-girl', 'naiwa', 'nailong', 'tororo']
  let round = 0
  while (Date.now() < deadline) {
    round += 1
    const probe = await uiProbe(mainPage)
    if (probe.latency > 2000) addFinding('P1', 'QA-SOAK-UI-SLOW', `交互轮次 ${round} UI 探针 ${probe.latency}ms`, '')

    // 1) 桌宠显隐循环
    for (let i = 0; i < 8; i += 1) {
      await mainPage.evaluate(() => window.murasame.pet.toggle()).catch((error) => {
        addFinding('P1', 'QA-SOAK-PET-TOGGLE', 'pet.toggle 调用失败', String(error).slice(0, 200))
      })
    }

    // 2) 形象快速切换
    for (const preset of presets) {
      await mainPage
        .evaluate((value) => window.murasame.settings.update({ petPreset: value }), preset)
        .catch((error) => addFinding('P1', 'QA-SOAK-PRESET', `切换形象 ${preset} 失败`, String(error).slice(0, 200)))
    }

    // 3) 主窗口显隐
    for (let i = 0; i < 5; i += 1) {
      await mainPage.evaluate(() => window.murasame.window.hideMain()).catch(() => undefined)
      await mainPage.evaluate(() => window.murasame.window.showMain()).catch(() => undefined)
    }

    // 4) 桌宠缩放/位置
    for (let i = 0; i < 10; i += 1) {
      await mainPage
        .evaluate((n) => window.murasame.pet.setScale(0.8 + (n % 5) * 0.1), i)
        .catch(() => undefined)
      await mainPage
        .evaluate((n) => window.murasame.pet.setPosition(100 + n * 7, 100 + n * 5), i)
        .catch(() => undefined)
    }

    // 5) 记忆增删
    for (let i = 0; i < 6; i += 1) {
      const added = await mainPage
        .evaluate((n) => window.murasame.core.addMemory('preference', `QA 压测记忆 ${n} ${Date.now()}`), i)
        .catch(() => null)
      if (added?.ok && added.data?.id) {
        await mainPage.evaluate((id) => window.murasame.core.deleteMemory(id), added.data.id).catch(() => undefined)
      }
    }

    // 6) 对话创建/发送/删除（无模型时应走失败路径而不是崩溃）
    const conversation = await mainPage.evaluate(() => window.murasame.core.createConversation()).catch(() => null)
    if (conversation?.ok && conversation.data?.id) {
      await mainPage
        .evaluate((id) => window.murasame.core.sendMessage(id, 'QA 压力消息'), conversation.data.id)
        .catch(() => undefined)
      await mainPage
        .evaluate((id) => window.murasame.core.deleteConversation(id, ['messages']), conversation.data.id)
        .catch(() => undefined)
    }

    // 7) 任务创建/取消
    const task = await mainPage.evaluate(() => window.murasame.core.createTask('整理 D:\\\\qa-soak')).catch(() => null)
    if (task?.ok && task.data?.id) {
      await mainPage.evaluate((id) => window.murasame.core.cancelTask(id), task.data.id).catch(() => undefined)
    }

    // 8) 桌宠拖拽
    await petPage
      .evaluate(async () => {
        await window.murasame.pet.beginDrag(400, 300)
        for (let i = 0; i < 20; i += 1) await window.murasame.pet.dragMove(400 + i * 3, 300 + i * 2)
        await window.murasame.pet.endDrag()
      })
      .catch(() => undefined)

    await sleep(120)
  }
  return round
}

async function invalidInputFuzz(mainPage) {
  const results = await mainPage
    .evaluate(async () => {
      const cases = [
        ['sendMessage null', () => window.murasame.core.sendMessage(null, undefined)],
        ['sendMessage 超长', () => window.murasame.core.sendMessage('x'.repeat(2000), 'y'.repeat(100000))],
        ['setScale NaN', () => window.murasame.pet.setScale(Number.NaN)],
        ['setScale 负数', () => window.murasame.pet.setScale(-5)],
        ['setPosition 越界', () => window.murasame.pet.setPosition(1e9, -1e9)],
        ['addMemory 空', () => window.murasame.core.addMemory('', '')],
        ['addMemory 超长', () => window.murasame.core.addMemory('preference', 'z'.repeat(200000))],
        ['updateMemory null', () => window.murasame.core.updateMemory(null, null, null)],
        ['deleteMemory 未知 id', () => window.murasame.core.deleteMemory('nonexistent-id')],
        ['cancelTask 未知 id', () => window.murasame.core.cancelTask('nonexistent-id')],
        ['setActiveConversation 未知', () => window.murasame.core.setActiveConversation('nonexistent-id')],
        ['deleteConversation 未知', () => window.murasame.core.deleteConversation('nonexistent-id', [])]
      ]
      const out = []
      for (const [name, fn] of cases) {
        try {
          const value = await Promise.race([
            fn(),
            new Promise((resolve) => setTimeout(() => resolve({ __timeout: true }), 8000))
          ])
          out.push({ name, ok: true, result: value?.__timeout ? 'TIMEOUT' : (value?.ok ?? value) })
        } catch (error) {
          out.push({ name, ok: false, error: String(error).slice(0, 200) })
        }
      }
      return out
    })
    .catch((error) => [{ name: 'fuzz 整体', ok: false, error: String(error) }])
  // 非法输入被校验拒绝是预期行为（表达为中文结构化错误）；只有超时/崩溃/非预期异常才算缺陷。
  const expectedRejection = /请求参数无效|无效|不能为空|长度|过长|至少|请选择|先说|太短/
  for (const item of results) {
    if (item.result === 'TIMEOUT') addFinding('P1', 'QA-SOAK-FUZZ-TIMEOUT', `非法输入导致 8 秒超时：${item.name}`, '')
    else if (!item.ok) {
      if (expectedRejection.test(String(item.error))) item.expectedRejection = true
      else addFinding('P2', 'QA-SOAK-FUZZ-REJECT', `非法输入抛出非预期异常：${item.name}`, item.error)
    }
  }
  // 主进程仍可用？
  const alive = await app.evaluate(({ app }) => app.isReady()).catch(() => false)
  if (!alive) addFinding('P0', 'QA-SOAK-FUZZ-DEAD', '非法输入后主进程不可用', '')
  return results
}

function summarize() {
  const idle = metrics.filter((m) => m.tag === 'idle')
  const baseline = idle[0] || metrics[0]
  const last = metrics[metrics.length - 1]
  const memoryGrowth = idle.length > 1 ? last.totalMemoryMB - idle[0].totalMemoryMB : 0
  const minutes = IDLE_SECONDS / 60
  const maxMainLatency = Math.max(...metrics.map((m) => m.mainLatency))
  const maxCpu = Math.max(...metrics.map((m) => m.totalCpu))
  const summary = {
    at: now(),
    quick: QUICK,
    durations: { warmup: WARMUP_SECONDS, stress: STRESS_SECONDS, idle: IDLE_SECONDS },
    samples: metrics.length,
    idleMemoryStartMB: baseline?.totalMemoryMB ?? null,
    idleMemoryEndMB: last?.totalMemoryMB ?? null,
    idleMemoryGrowthMB: Math.round(memoryGrowth * 10) / 10,
    idleMemoryGrowthMBPerMinute: minutes > 0 ? Math.round((memoryGrowth / minutes) * 10) / 10 : null,
    maxMainLatencyMS: maxMainLatency,
    maxTotalCpuPercent: maxCpu,
    crashes,
    unexpectedExit,
    consoleErrorCount: consoleErrors.length,
    consoleErrorSamples: consoleErrors.slice(0, 20),
    findings
  }
  return summary
}

function writeReport(summary) {
  const lines = []
  lines.push('# QA 运行时压测报告')
  lines.push('')
  lines.push(`- 时间：${summary.at}`)
  lines.push(`- 模式：${summary.quick ? '快速' : '标准'}（预热 ${summary.durations.warmup}s / 压力 ${summary.durations.stress}s / 空闲 ${summary.durations.idle}s）`)
  lines.push(`- 采样点：${summary.samples}`)
  lines.push('')
  lines.push('## 结论')
  const failures = summary.findings.filter((f) => f.severity === 'P0')
  lines.push(failures.length === 0 ? '- 未发现崩溃/未响应/异常退出（PASS）' : `- 发现 ${failures.length} 个 P0 问题（FAIL）`)
  lines.push(`- 崩溃次数：${summary.crashes.length}；异常退出：${summary.unexpectedExit}`)
  lines.push(`- 控制台错误条数：${summary.consoleErrorCount}`)
  lines.push(`- 非法输入被校验拒绝（预期行为）：${summary.expectedRejections ?? 0} 项`)
  lines.push('')
  lines.push('## 指标')
  lines.push('| 指标 | 值 |')
  lines.push('| --- | --- |')
  lines.push(`| 空闲起始总内存 | ${summary.idleMemoryStartMB} MB |`)
  lines.push(`| 空闲结束总内存 | ${summary.idleMemoryEndMB} MB |`)
  lines.push(`| 空闲内存增长 | ${summary.idleMemoryGrowthMB} MB（${summary.idleMemoryGrowthMBPerMinute} MB/min） |`)
  lines.push(`| 主进程最大响应延迟 | ${summary.maxMainLatencyMS} ms |`)
  lines.push(`| 最大总 CPU | ${summary.maxTotalCpuPercent}% |`)
  lines.push('')
  lines.push('## 发现')
  if (summary.findings.length === 0) lines.push('- 无')
  for (const f of summary.findings) {
    lines.push(`- [${f.severity}] ${f.id} ${f.title}${f.detail ? ` — ${f.detail}` : ''}`)
  }
  lines.push('')
  lines.push('## 控制台错误样本')
  if (summary.consoleErrorSamples.length === 0) lines.push('- 无')
  for (const e of summary.consoleErrorSamples) lines.push(`- ${e.page}/${e.type}: ${e.message}`)
  lines.push('')
  lines.push('## 明细')
  lines.push('```json')
  lines.push(JSON.stringify({ findings: summary.findings, crashes: summary.crashes }, null, 2))
  lines.push('```')
  writeFileSync(join(OUT_DIR, 'report.md'), lines.join('\n'))
  writeFileSync(join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2))
}

async function main() {
  console.log('启动应用…')
  await launch()
  const pages = await waitForPages()
  attachCrashWatchers(pages)
  console.log(`窗口就绪：主控制台 ${pages.mainPage.url()}，桌宠 ${pages.petPage.url()}`)

  console.log(`预热 ${WARMUP_SECONDS}s…`)
  const warmupDeadline = Date.now() + WARMUP_SECONDS * 1000
  while (Date.now() < warmupDeadline) {
    await sample('warmup')
    await sleep(SAMPLE_MS)
  }

  const ipcBefore = await ipcLatency(pages.mainPage)
  console.log('IPC 延迟（压力前）：', JSON.stringify(ipcBefore))

  console.log(`交互压力 ${STRESS_SECONDS}s…`)
  const stressRounds = await stressInteractions(pages)

  const ipcAfter = await ipcLatency(pages.mainPage)
  console.log('IPC 延迟（压力后）：', JSON.stringify(ipcAfter))
  if (ipcAfter.p95 > 250 || ipcAfter.p95 > ipcBefore.p95 * 5 + 50) {
    addFinding('P1', 'QA-SOAK-IPC-LATENCY', '压力后 IPC 延迟显著上升', JSON.stringify({ ipcBefore, ipcAfter }))
  }

  console.log('非法输入模糊测试…')
  const fuzz = await invalidInputFuzz(pages.mainPage)

  console.log(`空闲 soak ${IDLE_SECONDS}s…`)
  const idleDeadline = Date.now() + IDLE_SECONDS * 1000
  while (Date.now() < idleDeadline) {
    await sample('idle')
    const probe = await uiProbe(pages.mainPage)
    if (probe.latency > 2000) addFinding('P1', 'QA-SOAK-IDLE-UI', `空闲期渲染探针 ${probe.latency}ms`, '')
    await sleep(SAMPLE_MS)
  }

  const summary = summarize()
  summary.ipcBefore = ipcBefore
  summary.ipcAfter = ipcAfter
  summary.fuzz = fuzz
  summary.expectedRejections = fuzz.filter((item) => item.expectedRejection).length
  summary.stressRounds = stressRounds
  writeReport(summary)
  console.log('报告已写入：', join(OUT_DIR, 'report.md'))

  try {
    await app.close()
  } catch {
    /* ignore */
  }
  if (!KEEP_USERDATA) rmSync(userData, { recursive: true, force: true })
  else console.log('userData 保留于：', userData)

  const p0 = summary.findings.filter((f) => f.severity === 'P0')
  process.exitCode = p0.length === 0 ? 0 : 2
}

main().catch(async (error) => {
  console.error('压测执行失败：', error)
  try {
    if (app) await app.close()
  } catch {
    /* ignore */
  }
  writeFileSync(join(OUT_DIR, 'failure.txt'), String(error?.stack || error))
  process.exitCode = 1
})
