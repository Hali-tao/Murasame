#!/usr/bin/env node
/**
 * QA：渲染进程崩溃恢复探测。
 * 分别崩溃桌宠与控制台渲染进程，从主进程侧探测窗口是否恢复渲染
 * （Playwright 的 page 在崩溃后不可用，因此用 webContents.executeJavaScript 取状态）。
 * 输出 artifacts/qa-runtime-2026-11-13/crash-recovery/。
 */
import { _electron as electron } from 'playwright'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(ROOT, 'artifacts', 'qa-runtime-2026-11-13', 'crash-recovery')
mkdirSync(OUT_DIR, { recursive: true })
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const userData = mkdtempSync(join(tmpdir(), 'murasame-qa-crash-'))
writeFileSync(join(userData, 'murasame.json'), JSON.stringify({ settings: { onboardingDone: true } }))
const env = { ...process.env, MURASAME_USER_DATA: userData }
delete env.ELECTRON_RUN_AS_NODE

const results = []
const findings = []
const add = (severity, id, title, detail) => {
  findings.push({ severity, id, title, detail })
  console.log(`[${severity}] ${id} ${title}`)
}

/** 从主进程侧探测窗口状态；崩溃后 Playwright page 不可用，但 webContents 仍在。 */
async function probe(app, target) {
  return app.evaluate(async ({ BrowserWindow }, which) => {
    const all = BrowserWindow.getAllWindows()
    const window = all.find((item) => {
      const url = item.webContents.getURL()
      return which === 'pet' ? url.includes('pet.html') : !url.includes('pet.html')
    })
    if (!window) return { windows: all.length, exists: false }
    const contents = window.webContents
    const state = {
      windows: all.length,
      exists: true,
      crashed: contents.isCrashed(),
      url: contents.getURL(),
      visible: window.isVisible()
    }
    if (contents.isCrashed()) return state
    try {
      state.ready = await contents.executeJavaScript('document.readyState')
      state.hasApi = await contents.executeJavaScript('Boolean(window.murasame)')
      state.bodyLength = await contents.executeJavaScript('document.body ? document.body.innerText.length : 0')
      if (which === 'pet') {
        state.petOpaque = await contents.executeJavaScript(`(async () => {
          const canvas = document.querySelector('canvas')
          if (!canvas) return -1
          try {
            const bitmap = await createImageBitmap(canvas)
            const copy = new OffscreenCanvas(bitmap.width, bitmap.height)
            const context = copy.getContext('2d')
            context.drawImage(bitmap, 0, 0)
            const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data
            let opaque = 0
            for (let index = 3; index < data.length; index += 4) if (data[index] > 200) opaque += 1
            return opaque
          } catch { return -2 }
        })()`)
      }
    } catch (error) {
      state.probeError = String(error).slice(0, 160)
    }
    return state
  }, target)
}

async function main() {
  const app = await electron.launch({ args: ['.'], cwd: ROOT, env })
  let mainPage = null
  let petPage = null
  for (let attempt = 0; attempt < 150; attempt += 1) {
    for (const page of app.windows()) {
      if (page.isClosed()) continue
      if (page.url().includes('/pet.html')) petPage = page
      else mainPage = page
    }
    if (mainPage && petPage) break
    await sleep(100)
  }
  if (!mainPage || !petPage) throw new Error('窗口未就绪')
  const before = { pet: await probe(app, 'pet'), main: await probe(app, 'main') }
  console.log('崩溃前：', JSON.stringify(before))

  const crash = async (label) => {
    const started = Date.now()
    const page = label === 'pet' ? petPage : mainPage
    page.on('crash', () => console.log(`[info] ${label} page crash 事件`))
    await app.evaluate(({ BrowserWindow }, target) => {
      const window = BrowserWindow.getAllWindows().find((item) => {
        const url = item.webContents.getURL()
        return target === 'pet' ? url.includes('pet.html') : !url.includes('pet.html')
      })
      if (!window) throw new Error(`找不到目标窗口：${target}`)
      window.webContents.forcefullyCrashRenderer()
    }, label)

    const timeline = []
    let recovered = false
    for (let attempt = 0; attempt < 48; attempt += 1) {
      await sleep(250)
      const state = await probe(app, label).catch((error) => ({ probeError: String(error).slice(0, 120) }))
      timeline.push({ at: Date.now() - started, ...state })
      const rendered = state.exists && state.crashed === false && state.ready === 'complete' && (!state.petOpaque || state.petOpaque > 0)
      if (rendered) {
        recovered = true
        break
      }
    }
    const finalState = timeline[timeline.length - 1]
    const record = {
      target: label,
      recovered,
      recoveryMs: recovered ? finalState.at : null,
      finalState,
      firstFrames: timeline.slice(0, 6),
      windows: app.windows().length
    }
    results.push(record)
    console.log(`崩溃 ${label}：`, JSON.stringify({ recovered, recoveryMs: record.recoveryMs, finalState }))
    if (!recovered) {
      add(
        label === 'pet' ? 'P1' : 'P0',
        `QA-CRASH-${label.toUpperCase()}`,
        `${label === 'pet' ? '桌宠' : '控制台'}渲染进程崩溃后未恢复：窗口保留但空白`,
        JSON.stringify(finalState)
      )
    }
  }

  try {
    await crash('pet')
    const mainAlive = await app.evaluate(({ app }) => app.isReady()).catch(() => false)
    if (!mainAlive) add('P0', 'QA-CRASH-MAIN-DEAD', '渲染进程崩溃后主进程不可用', '')
    await crash('main')
  } finally {
    const summary = { at: new Date().toISOString(), before, results, findings }
    writeFileSync(join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2))
    const lines = [
      '# 渲染进程崩溃恢复探测',
      '',
      `- 时间：${summary.at}`,
      '',
      '| 崩溃目标 | 是否恢复 | 恢复耗时(ms) | 最终 crashed | 窗口数 |',
      '| --- | --- | --- | --- | --- |'
    ]
    for (const item of results) {
      lines.push(`| ${item.target} | ${item.recovered ? '是' : '否'} | ${item.recoveryMs ?? '-'} | ${item.finalState?.crashed ?? '-'} | ${item.windows} |`)
    }
    lines.push('', '## 发现')
    if (findings.length === 0) lines.push('- 无')
    for (const finding of findings) lines.push(`- [${finding.severity}] ${finding.id} ${finding.title}`)
    lines.push('', '## 崩溃后前 6 帧状态')
    lines.push('```json')
    lines.push(JSON.stringify(results.map((item) => ({ target: item.target, frames: item.firstFrames })), null, 2))
    lines.push('```')
    writeFileSync(join(OUT_DIR, 'report.md'), lines.join('\n'))
    console.log('报告：', join(OUT_DIR, 'report.md'))
    try {
      await app.close()
    } catch {
      /* ignore */
    }
  }
  process.exitCode = findings.some((item) => item.severity === 'P0' || item.severity === 'P1') ? 2 : 0
}

main().catch((error) => {
  console.error(error)
  writeFileSync(join(OUT_DIR, 'failure.txt'), String(error?.stack || error))
  process.exitCode = 1
})
