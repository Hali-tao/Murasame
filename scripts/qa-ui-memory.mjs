#!/usr/bin/env node
/**
 * QA：界面重复操作的渲染进程内存增长（泄漏判定，按场景隔离）。
 * 场景：页面导航 / 桌宠对话面板开关 / 主窗口显隐 / 空转对照（新实例）。
 * 每个场景单独启动实例，按 PID 采样主窗口与桌宠渲染进程，末尾空闲观察是否回落（GC）。
 * 输出 artifacts/qa-runtime-2026-11-13/ui-memory/。
 */
import { _electron as electron } from 'playwright'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(ROOT, 'artifacts', 'qa-runtime-2026-11-13', 'ui-memory')
mkdirSync(OUT_DIR, { recursive: true })
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const findings = []
const results = []
const add = (severity, id, title, detail) => {
  findings.push({ severity, id, title, detail })
  console.log(`[${severity}] ${id} ${title}`)
}

function makeUserData() {
  const dir = mkdtempSync(join(tmpdir(), 'murasame-qa-uimem-'))
  writeFileSync(join(dir, 'murasame.json'), JSON.stringify({ settings: { onboardingDone: true } }))
  return dir
}

function envFor(userData) {
  const env = { ...process.env, MURASAME_USER_DATA: userData }
  delete env.ELECTRON_RUN_AS_NODE
  return env
}

async function launch() {
  const app = await electron.launch({ args: ['.'], cwd: ROOT, env: envFor(makeUserData()) })
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

/** 主窗口与桌宠渲染进程的 PID 映射（Electron app.getAppMetrics 按 pid 给内存）。 */
async function rendererPids(app) {
  return app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((window) => ({
      kind: window.webContents.getURL().includes('pet.html') ? 'pet' : 'main',
      pid: window.webContents.getOSProcessId()
    }))
  )
}

async function sample(app, pids, page) {
  const metrics = await app.evaluate(({ app }) => app.getAppMetrics().map((item) => ({ pid: item.pid, memoryMB: Math.round((item.memory.workingSetSize / 1024) * 10) / 10 })))
  const byPid = new Map(metrics.map((item) => [item.pid, item.memoryMB]))
  const main = pids.filter((item) => item.kind === 'main').reduce((sum, item) => sum + (byPid.get(item.pid) ?? 0), 0)
  const pet = pids.filter((item) => item.kind === 'pet').reduce((sum, item) => sum + (byPid.get(item.pid) ?? 0), 0)
  const rendererState = page
    ? await page.evaluate(() => {
        const memory = performance.memory
        return { domNodes: document.getElementsByTagName('*').length, jsHeapMB: memory ? Math.round((memory.usedJSHeapSize / 1024 / 1024) * 10) / 10 : null }
      }).catch(() => ({}))
    : {}
  return { at: Date.now(), mainMB: Math.round(main * 10) / 10, petMB: Math.round(pet * 10) / 10, totalMB: Math.round((main + pet) * 10) / 10, ...rendererState }
}

async function runScenario(name, iterations, action) {
  const { app, mainPage } = await launch()
  try {
    const pids = await rendererPids(app)
    await sleep(2500)
    const samples = [await sample(app, pids, mainPage)]
    for (let index = 1; index <= iterations; index += 1) {
      await action({ app, page: mainPage, index })
      if (index % Math.max(1, Math.round(iterations / 8)) === 0) samples.push(await sample(app, pids, mainPage))
    }
    samples.push(await sample(app, pids, mainPage))
    // 空闲 8 秒观察 GC 是否回落
    await sleep(8000)
    const afterIdle = await sample(app, pids, mainPage)
    samples.push(afterIdle)
    const first = samples[0]
    const last = samples[samples.length - 2]
    const growth = Math.round((last.totalMB - first.totalMB) * 10) / 10
    const mainGrowth = Math.round((last.mainMB - first.mainMB) * 10) / 10
    const afterIdleDelta = Math.round((afterIdle.totalMB - last.totalMB) * 10) / 10
    const segments = samples.slice(0, -1)
    const lateStart = Math.max(0, segments.length - 3)
    const lateGrowth = Math.round((segments[segments.length - 1].totalMB - segments[lateStart].totalMB) * 10) / 10
    // 只把「持续增长」判定为泄漏；一次性的渲染预热/图层缓存即使增长明显，只要尾部趋平就不是无界泄漏。
    const heapGrowth = first.jsHeapMB != null && last.jsHeapMB != null ? Math.round((last.jsHeapMB - first.jsHeapMB) * 10) / 10 : null
    const domEnd = last.domNodes ?? null
    const bounded = growth > 20 && lateGrowth < 8
    const verdict = bounded ? 'OK_BOUNDED' : growth > 60 && lateGrowth >= 8 ? 'LEAK' : 'OK'
    const record = { scenario: name, iterations, first, last, growthMB: growth, mainGrowthMB: mainGrowth, afterIdleMB: afterIdle.totalMB, afterIdleDeltaMB: afterIdleDelta, lateGrowthMB: lateGrowth, heapGrowthMB: heapGrowth, domEnd, verdict, samples }
    results.push(record)
    console.log(`[${name}] total ${first.totalMB}→${last.totalMB}MB（增长 ${growth}MB，尾部增长 ${lateGrowth}MB，判定 ${verdict}），空闲后 ${afterIdle.totalMB}MB（${afterIdleDelta >= 0 ? '+' : ''}${afterIdleDelta}MB），JS堆 ${first.jsHeapMB}→${last.jsHeapMB}MB，DOM ${last.domNodes}`)
    if (verdict === 'LEAK') add('P2', 'QA-UI-MEMORY-GROWTH', `${name} 内存持续增长（${growth}MB，尾部 ${lateGrowth}MB）`, JSON.stringify({ mainGrowth, heapGrowth, afterIdleDelta, samples: samples.slice(-3) }))
    return record
  } finally {
    try {
      await app.close()
    } catch {
      /* ignore */
    }
  }
}

async function main() {
  const routes = ['nav-overview', 'nav-chat', 'nav-memory', 'nav-tasks', 'nav-character', 'nav-settings']
  if (process.env.QA_MODE === 'probe') {
    // 同路由重复点击（不触发挂载/卸载）与真实切换对照，判断泄漏是「每次点击」还是「每次挂载」。
    await runScenario('same-route-click-120', 120, async ({ page }) => {
      await page.getByTestId('nav-overview').click({ timeout: 5000 }).catch(() => undefined)
    })
    await runScenario('switch-overview-chat-60', 60, async ({ page }) => {
      await page.getByTestId('nav-overview').click({ timeout: 5000 }).catch(() => undefined)
      await page.getByTestId('nav-chat').click({ timeout: 5000 }).catch(() => undefined)
    })
    const summary = { at: new Date().toISOString(), results, findings }
    writeFileSync(join(OUT_DIR, 'summary-probe.json'), JSON.stringify(summary, null, 2))
    const lines = ['# 同路由/切换对照', '', '| 场景 | 起始 | 结束 | 增长 |', '| --- | --- | --- | --- |']
    for (const item of results) lines.push(`| ${item.scenario} | ${item.first.totalMB}MB | ${item.last.totalMB}MB | ${item.growthMB}MB |`)
    writeFileSync(join(OUT_DIR, 'report-probe.md'), lines.join('\n'))
    console.log('probe 报告：', join(OUT_DIR, 'report-probe.md'))
    return
  }

  if (process.env.QA_MODE === 'routes') {
    // 逐路由判定泄漏来源：每次在总览与该页之间来回切换，强制挂载/卸载。
    for (const route of routes.slice(1)) {
      await runScenario(`route-${route}-120`, 120, async ({ page }) => {
        await page.getByTestId('nav-overview').click({ timeout: 5000 }).catch(() => undefined)
        await page.getByTestId(route).click({ timeout: 5000 }).catch(() => undefined)
      })
    }
    const summary = { at: new Date().toISOString(), results, findings }
    writeFileSync(join(OUT_DIR, 'summary-routes.json'), JSON.stringify(summary, null, 2))
    const lines = ['# 逐路由内存增长（每次挂载/卸载 120 轮）', '', '| 场景 | 起始 | 结束 | 增长 | 尾部增长 | 判定 | 空闲后变化 |', '| --- | --- | --- | --- | --- | --- | --- |']
    for (const item of results) lines.push(`| ${item.scenario} | ${item.first.totalMB}MB | ${item.last.totalMB}MB | ${item.growthMB}MB | ${item.lateGrowthMB}MB | ${item.verdict} | ${item.afterIdleDeltaMB}MB |`)
    lines.push('', '## 发现')
    if (findings.length === 0) lines.push('- 无')
    for (const finding of findings) lines.push(`- [${finding.severity}] ${finding.id} ${finding.title}`)
    writeFileSync(join(OUT_DIR, 'report-routes.md'), lines.join('\n'))
    console.log('routes 报告：', join(OUT_DIR, 'report-routes.md'))
    process.exitCode = findings.some((item) => item.severity === 'P0' || item.severity === 'P1') ? 2 : 0
    return
  }
  await runScenario('idle-control', 1, async () => { await sleep(20_000) })
  await runScenario('navigation-240', 240, async ({ page, index }) => {
    await page.getByTestId(routes[index % routes.length]).click({ timeout: 5000 }).catch(() => undefined)
  })
  await runScenario('pet-chat-toggle-150', 150, async ({ page }) => {
    await page.evaluate(async () => {
      await window.murasame.pet.setChatOpen(true).catch(() => undefined)
      await window.murasame.pet.setChatOpen(false).catch(() => undefined)
    }).catch(() => undefined)
  })
  await runScenario('window-hide-show-150', 150, async ({ page }) => {
    await page.evaluate(async () => {
      await window.murasame.window.hideMain().catch(() => undefined)
      await window.murasame.window.showMain().catch(() => undefined)
    }).catch(() => undefined)
  })

  const summary = { at: new Date().toISOString(), results, findings }
  writeFileSync(join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2))
  const lines = [
    '# 界面重复操作的内存增长（泄漏判定）',
    '',
    `- 时间：${summary.at}`,
    '',
    '| 场景 | 起始总内存 | 结束总内存 | 增长 | 尾部增长 | 判定 | 空闲后变化 |',
    '| --- | --- | --- | --- | --- | --- | --- |'
  ]
  for (const item of results) {
    lines.push(`| ${item.scenario} | ${item.first.totalMB}MB | ${item.last.totalMB}MB | ${item.growthMB}MB | ${item.lateGrowthMB}MB | ${item.verdict ?? '-'} | ${item.afterIdleDeltaMB}MB |`)
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
