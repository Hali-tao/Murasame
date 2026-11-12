#!/usr/bin/env node
/**
 * QA：IPC 错误形态审计。
 * 对每个 invoke 通道注入非法载荷（undefined），记录「结构化 Result / 抛错 / 挂起 / 无 handler」四类结果，
 * 检查：业务通道（core/data/autonomy/review）必须返回结构化 Result；值通道允许抛中文错误；不允许挂起或裸英文错误。
 * 输出 artifacts/qa-runtime-2026-11-13/ipc-shapes/。
 */
import { _electron as electron } from 'playwright'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(ROOT, 'artifacts', 'qa-runtime-2026-11-13', 'ipc-shapes')
mkdirSync(OUT_DIR, { recursive: true })
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const findings = []

const SKIP = [
  'app:quit', 'app:clear-logs', 'app:open-logs', 'app:open-user-data', 'app:pick-open', 'app:pick-save',
  'data:export-bundle', 'data:import-bundle', 'character:import-asset',
  'core:open-artifact', 'core:analyze-screen', 'pet:begin-drag', 'pet:drag-move', 'pet:end-drag',
  'pet:focus-chat', 'window:open-path', 'updates:check'
]
// 这些前缀会启动持久循环/占设备/联网，审计时跳过。
const SKIP_PREFIX = ['autonomy:', 'screen:', 'voice:']

function makeUserData() {
  const dir = mkdtempSync(join(tmpdir(), 'murasame-qa-ipc-shapes-'))
  writeFileSync(join(dir, 'murasame.json'), JSON.stringify({ settings: { onboardingDone: true } }))
  return dir
}

function envFor(userData) {
  const env = { ...process.env, MURASAME_USER_DATA: userData }
  delete env.ELECTRON_RUN_AS_NODE
  return env
}

function channelsFromSource() {
  const text = readFileSync(join(ROOT, 'src/shared/ipc.ts'), 'utf8')
  const found = new Set()
  for (const match of text.matchAll(/'([a-z]+:[a-z0-9-]+)'/g)) found.add(match[1])
  return [...found].sort().filter((channel) => !SKIP.includes(channel) && !SKIP_PREFIX.some((prefix) => channel.startsWith(prefix)))
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
  return { app, mainPage }
}

function classify(channel, outcome) {
  const business = /^(core|data|autonomy|review):/.test(channel)
  const value = /^(settings|window|pet|app|relationship|tools|models):/.test(channel)
  if (outcome.status === 'hang') return { severity: 'P1', issue: '处理器在 3000ms 内未返回（交互死角）' }
  if (outcome.status === 'rejected') {
    const message = outcome.message || ''
    const chinese = /[\u4e00-\u9fff]/.test(message)
    if (business) return { severity: 'P2', issue: '业务通道以 rejection 返回，与 Result 协议不一致' }
    if (!chinese) return { severity: 'P3', issue: '值通道错误信息不是中文' }
    return null
  }
  if (outcome.status === 'resolved' && value && outcome.shape !== 'value') {
    return { severity: 'P3', issue: '值通道返回了非值形态（可能是 Result）' }
  }
  if (outcome.status === 'resolved' && business && outcome.shape !== 'result') {
    return { severity: 'P2', issue: '业务通道没有返回结构化 Result' }
  }
  return null
}

async function main() {
  const channels = channelsFromSource()
  const userData = makeUserData()
  const { app, mainPage } = await launch(userData)
  let results
  try {
    results = await app.evaluate(async ({ ipcMain }, list) => {
      const handlers = ipcMain._invokeHandlers
      const output = []
      for (const channel of list) {
        const handler = handlers?.get(channel)
        if (!handler) {
          output.push({ channel, status: 'no-handler' })
          continue
        }
        const event = { sender: { id: 999999 }, senderFrame: null, frameId: 1, processId: 999999, returnValue: undefined, reply: () => undefined }
        const started = Date.now()
        try {
          const value = await Promise.race([
            Promise.resolve(handler(event, undefined)),
            new Promise((resolve) => setTimeout(() => resolve(Symbol.for('__timeout__')), 3000))
          ])
          const elapsed = Date.now() - started
          if (typeof value === 'symbol') {
            output.push({ channel, status: 'hang', elapsed })
            continue
          }
          const shape = value && typeof value === 'object' && !Array.isArray(value) && 'ok' in value ? 'result' : 'value'
          output.push({ channel, status: 'resolved', shape, elapsed })
        } catch (error) {
          output.push({ channel, status: 'rejected', message: String(error?.message ?? error).slice(0, 160), elapsed: Date.now() - started })
        }
      }
      return output
    }, channels)
  } finally {
    await Promise.race([app.close().catch(() => undefined), sleep(5000)])
  }
  results ??= []

  for (const item of results) {
    const verdict = classify(item.channel, item)
    if (verdict) {
      findings.push({ severity: verdict.severity, channel: item.channel, issue: verdict.issue, detail: item })
      console.log(`[${verdict.severity}] ${item.channel} — ${verdict.issue}`)
    }
  }

  const summary = { at: new Date().toISOString(), channelCount: channels.length, results, findings }
  writeFileSync(join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2))
  const lines = ['# IPC 错误形态审计', '', `- 时间：${summary.at}`, `- 渠道数：${channels.length}`, '']
  lines.push('| 通道 | 结果 | 形态 | 耗时(ms) |', '| --- | --- | --- | --- |')
  for (const item of results) lines.push(`| ${item.channel} | ${item.status} | ${item.shape ?? item.message ?? ''} | ${item.elapsed ?? ''} |`)
  lines.push('', '## 发现')
  if (!findings.length) lines.push('- 无：业务通道均为结构化 Result，值通道均以中文错误拒绝，未发现挂起。')
  for (const finding of findings) lines.push(`- [${finding.severity}] ${finding.channel}：${finding.issue}`)
  writeFileSync(join(OUT_DIR, 'report.md'), lines.join('\n'))
  console.log(results.map((item) => `${item.channel}:${item.status}${item.shape ? ':' + item.shape : ''}`).join(' '))
  console.log('报告：', join(OUT_DIR, 'report.md'))
  mainPage.on('close', () => undefined)
}

main().catch((error) => {
  console.error(error)
  writeFileSync(join(OUT_DIR, 'failure.txt'), String(error?.stack || error))
  process.exitCode = 1
})
