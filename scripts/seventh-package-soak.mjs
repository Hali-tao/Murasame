/* global window, document, MutationObserver */
import assert from 'node:assert/strict'
import { _electron as electron } from '@playwright/test'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = process.cwd()
const output = resolve('previews/overnight-2026-10-29/seventh-soak')
const temp = resolve('previews/tmp')
mkdirSync(output, { recursive: true }); mkdirSync(temp, { recursive: true })
const profile = mkdtempSync(join(temp, 'murasame-soak-'))
writeFileSync(join(profile, 'murasame.json'), JSON.stringify({ settings: { onboardingDone: true } }))
const executable = resolve('release/overnight-2026-10-29-sixth-delivery/win-unpacked/Murasame.exe')
const installer = resolve('release/overnight-2026-10-29-sixth-delivery/Murasame-Setup-0.9.0.exe')
const report = {
  startedAt: new Date().toISOString(), executable,
  installerSHA256: createHash('sha256').update(readFileSync(installer)).digest('hex'),
  scope: 'Real packaged Electron/preload/React/Cubism; independent status fixture; no external model or real Docker work in this endurance check.',
  errors: [], checks: [], samples: [], phases: []
}
assert.equal(report.installerSHA256, '4cf9487c442b62ca24c562610e15387d37b843cf0a93caa1dd0214effb8fd6bd')
const app = await electron.launch({ executablePath: executable, cwd: root, args: [], env: { ...process.env, TEMP: temp, TMP: temp, MURASAME_USER_DATA: profile } })
const bind = page => page.on('pageerror', error => report.errors.push({ url: page.url(), message: error.message }))
app.windows().forEach(bind); app.on('window', bind)
let pet
try {
  for (let i = 0; i < 200 && !pet; i++) {
    pet = app.windows().find(page => page.url().includes('pet.html'))
    if (!pet) await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert.ok(pet, 'pet window exists')
  const main = app.windows().find(page => !page.url().includes('pet.html'))
  await main.waitForFunction(() => Boolean(window.murasame))
  await main.evaluate(() => window.murasame.settings.update({ petPreset: 'naiwa', speakReplies: false, doNotDisturb: false }))
  await pet.waitForSelector('[data-model-id="naiwa"][data-live2d-state="ready"]', { timeout: 20_000 })
  await pet.evaluate(() => {
    window.__soakEvents = []
    new MutationObserver(records => {
      for (const record of records) window.__soakEvents.push({ at: Date.now(), group: record.target.getAttribute('data-motion-group') })
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-motion-group'] })
  })
  await app.evaluate(({ ipcMain }) => {
    globalThis.__soak = { current: { running: false, phase: 'idle', reason: '独立持续运行验收', viewUrl: '', notes: [], taskStatus: '' }, polls: 0, sent: 0, inflight: 0, maxInflight: 0 }
    ipcMain.removeHandler('autonomy:status')
    ipcMain.handle('autonomy:status', async () => {
      const tracking = globalThis.__soak
      const snapshot = structuredClone(tracking.current)
      tracking.polls++; tracking.inflight++; tracking.maxInflight = Math.max(tracking.maxInflight, tracking.inflight)
      try {
        if (tracking.polls % 7 === 0) await new Promise(resolve => setTimeout(resolve, 1500))
        return snapshot
      } finally { tracking.inflight-- }
    })
  })
  const base = { activityId: 'independent-soak', kind: 'code', running: true, phase: 'running', reason: '独立持续运行验收', viewUrl: '', notes: [], taskStatus: '', canStop: true, busy: true, allowNetwork: false }
  const publish = async state => app.evaluate(({ BrowserWindow }, next) => {
    const tracking = globalThis.__soak
    if (next) tracking.current = next
    tracking.sent++
    for (const item of BrowserWindow.getAllWindows()) item.webContents.send('autonomy:updated', structuredClone(tracking.current))
  }, state)
  const state = async () => pet.evaluate(() => ({
    phase: document.querySelector('.pet-stage')?.getAttribute('data-work-phase') ?? 'hidden',
    model: document.querySelector('.live2d-pet-host')?.getAttribute('data-model-id') ?? '',
    group: document.querySelector('.live2d-pet-host')?.getAttribute('data-motion-group') ?? '',
    canvases: document.querySelectorAll('canvas').length,
    events: window.__soakEvents.length
  }))
  const sample = async label => {
    const metrics = await app.evaluate(({ app }) => app.getAppMetrics().map(item => ({
      pid: item.pid, type: item.type, cpuPercent: item.cpu.percentCPUUsage, workingSetKiB: item.memory.workingSetSize
    })))
    report.samples.push({ at: new Date().toISOString(), label, state: await state(), metrics })
    writeFileSync(join(output, 'progress.json'), JSON.stringify(report, null, 2))
  }
  const phase = async (label, seconds, expected, change = async () => {}) => {
    console.log(`START ${label} ${seconds}s`)
    await change()
    await pet.waitForFunction(expected => {
      const host = document.querySelector('.live2d-pet-host')
      return expected.hidden ? Boolean(document.querySelector('.pet-hidden-root'))
        : host?.getAttribute('data-live2d-state') === 'ready' && host?.getAttribute('data-model-id') === expected.model && host?.getAttribute('data-motion-group') === expected.group
    }, expected, { timeout: 20_000 })
    const began = Date.now()
    const startEvents = await pet.evaluate(() => window.__soakEvents.length)
    for (let tick = 0; tick < seconds; tick++) {
      await publish()
      await new Promise(resolve => setTimeout(resolve, Math.max(0, began + (tick + 1) * 1000 - Date.now())))
      const observed = await state()
      if (expected.hidden) assert.equal(observed.canvases, 0, label)
      else { assert.equal(observed.model, expected.model, label); assert.equal(observed.group, expected.group, label); assert.equal(observed.canvases, 1, label) }
      if ((tick + 1) % 10 === 0) await sample(label)
    }
    const events = await pet.evaluate(index => window.__soakEvents.slice(index), startEvents)
    if (expected.group === 'WorkingLoop') assert.equal(events.length, 0, 'steady work must not restart or drop to Idle')
    if (!expected.hidden) await pet.screenshot({ path: join(output, `${label}.png`) })
    report.phases.push({ label, seconds, elapsedMs: Date.now() - began, expected, subsequentMotionEvents: events })
    console.log(`PASS ${label}`)
  }
  const working = { ...base, creation: { phase: 'executing', message: '正在运行独立持续检查，不访问用户文件' } }
  await phase('continuous-work', 120, { model: 'naiwa', group: 'WorkingLoop' }, () => publish(working))
  await phase('hidden', 20, { hidden: true }, () => main.evaluate(() => window.murasame.pet.hide()))
  await phase('shown-again', 20, { model: 'naiwa', group: 'WorkingLoop' }, () => main.evaluate(() => window.murasame.pet.show()))
  await phase('do-not-disturb', 20, { model: 'naiwa', group: 'Idle' }, () => main.evaluate(() => window.murasame.settings.update({ doNotDisturb: true })))
  await phase('work-restored', 20, { model: 'naiwa', group: 'WorkingLoop' }, () => main.evaluate(() => window.murasame.settings.update({ doNotDisturb: false })))
  await phase('cat', 20, { model: 'tororo', group: 'Idle' }, () => main.evaluate(() => window.murasame.settings.update({ petPreset: 'tororo' })))
  await phase('whale', 20, { model: 'whale-girl', group: 'idle' }, () => main.evaluate(() => window.murasame.settings.update({ petPreset: 'whale-girl' })))
  await phase('nailong-restored', 40, { model: 'naiwa', group: 'WorkingLoop' }, () => main.evaluate(() => window.murasame.settings.update({ petPreset: 'naiwa' })))
  await phase('reviewing', 20, { model: 'naiwa', group: 'Think' }, () => publish({ ...base, creation: { phase: 'reviewing', message: '独立核验阶段' } }))
  await phase('work-after-review', 20, { model: 'naiwa', group: 'WorkingLoop' }, () => publish(working))
  await phase('stopped', 20, { model: 'naiwa', group: 'Idle' }, () => publish({ ...base, phase: 'stopped', running: false, canStop: false, busy: false }))
  assert.equal(await pet.getByTestId('pet-isolation-progress').count(), 0)
  report.statusBridge = await app.evaluate(() => ({ polls: globalThis.__soak.polls, sent: globalThis.__soak.sent, maxInflight: globalThis.__soak.maxInflight }))
  assert.equal(report.statusBridge.maxInflight, 1, 'health reads remain serial')
  assert.deepEqual(report.errors, [])
  report.motionEvents = await pet.evaluate(() => window.__soakEvents)
  report.checks = ['340 seconds of real-time phase holds', '120 seconds continuous native work without restart', 'one canvas while visible; none when hidden', 'hide/show and do-not-disturb recovery', 'all three real models and return', 'review/work/stop transition', 'serial delayed health reads', 'no uncaught page errors', 'stopped progress removed']
  report.passed = true
} catch (error) {
  report.passed = false; report.failure = error.stack ?? String(error)
  if (pet && !pet.isClosed()) await pet.screenshot({ path: join(output, 'failure.png') }).catch(() => {})
  throw error
} finally {
  report.finishedAt = new Date().toISOString()
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2))
  await app.close()
  // Only this freshly created test profile is removed; real user data is untouched.
  assert.ok(profile.startsWith(temp + '\\') || profile.startsWith(temp + '/'))
  rmSync(profile, { recursive: true, force: true })
}
console.log(JSON.stringify({ passed: report.passed, phases: report.phases.length, samples: report.samples.length, bridge: report.statusBridge }))
