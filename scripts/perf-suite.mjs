import { _electron as electron } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const seconds = Number(process.argv.find((arg) => arg.startsWith('--seconds='))?.split('=')[1] ?? 12)
const logicalCores = Number(process.env.NUMBER_OF_PROCESSORS ?? 1)
const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
const wait = (ms) => new Promise((done) => setTimeout(done, ms))

/** 采集整棵 Electron 进程树的 CPU 时间与工作集。 */
function snapshot(pids) {
  const script = `
$ids = '${pids.join(',')}'.Split(',')
$total = 0.0
$mem = 0.0
foreach ($id in $ids) {
  $p = Get-Process -Id $id -ErrorAction SilentlyContinue
  if ($p) { $total += $p.TotalProcessorTime.TotalSeconds; $mem += $p.WorkingSet64 }
}
Write-Output ("{0}|{1}" -f $total, $mem)
`
  const raw = execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000
  }).trim()
  const [cpu, mem] = raw.split('|')
  return { cpuSeconds: Number(cpu), memoryBytes: Number(mem) }
}

async function measure(label, pids, drive) {
  const before = snapshot(pids)
  const started = Date.now()
  await drive()
  const remaining = seconds * 1000 - (Date.now() - started)
  if (remaining > 0) await wait(remaining)
  const elapsed = (Date.now() - started) / 1000
  const after = snapshot(pids)
  const cpuLogical = (after.cpuSeconds - before.cpuSeconds) / elapsed
  return {
    scenario: label,
    cpuLogical,
    cpuPercentOfMachine: (cpuLogical / logicalCores) * 100,
    memoryMb: after.memoryBytes / 1024 / 1024,
    elapsed
  }
}

const userData = mkdtempSync(join(tmpdir(), 'murasame-perf-'))
// 新建的 userData 会先显示首次引导，这里直接标记为已看过，避免测量停在引导页。
writeFileSync(join(userData, 'murasame.json'), JSON.stringify({ settings: { onboardingDone: true } }))
const app = await electron.launch({
  args: ['.'],
  cwd: root,
  env: { ...process.env, MURASAME_USER_DATA: userData }
})

const mainPid = app.process().pid
const treeScript = `Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'electron*' } | Select-Object -ExpandProperty ProcessId`
const pids = execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', treeScript], {
  encoding: 'utf8',
  windowsHide: true
}).trim().split(/\s+/).filter(Boolean)
if (pids.length === 0) pids.push(String(mainPid))

let page = null
for (let attempt = 0; attempt < 120 && !page; attempt += 1) {
  for (const candidate of app.windows()) {
    if (candidate.isClosed() || candidate.url().includes('/pet.html')) continue
    if (await candidate.getByTestId('nav-overview').count()) {
      page = candidate
      break
    }
  }
  if (!page) await wait(100)
}
if (!page) throw new Error('主窗口未加载，无法采样')

// 先预热，避免把启动开销记成待机开销。
await page.getByTestId('nav-overview').click()
await wait(15_000)

const rows = []
rows.push(await measure('待机', pids, async () => {
  await wait(500)
}))

rows.push(await measure('语音交流', pids, async () => {
  await page.evaluate(async () => {
    const readiness = await window.murasame.voice.readiness()
    if (readiness.tts) await window.murasame.voice.speak('性能采样用的一句话。')
  })
}))

rows.push(await measure('屏幕理解', pids, async () => {
  await page.getByTestId('nav-screen').click()
  await page.evaluate(async () => {
    await window.murasame.core.analyzeScreen()
  })
}))

rows.push(await measure('任务执行', pids, async () => {
  await page.evaluate(async () => {
    await window.murasame.core.createTask('整理 C:\\Windows\\Temp 下的临时文件')
  })
}))

rows.push(await measure('自主活动', pids, async () => {
  await page.getByTestId('nav-autonomy').click()
  await page.evaluate(async () => {
    await window.murasame.autonomy.start()
  })
}))

await app.close()
rmSync(userData, { recursive: true, force: true })

const table = rows.map((row) =>
  `| ${row.scenario} | ${row.cpuLogical.toFixed(3)} | ${row.cpuPercentOfMachine.toFixed(1)}% | ${row.memoryMb.toFixed(0)} | ${row.elapsed.toFixed(0)} s |`
).join('\n')

const report = [
  '# 性能测量',
  '',
  `测量设备以 \`docs/01-DECISIONS.md\` D-10 为准。本机 ${logicalCores} 个逻辑核。`,
  '',
  '五个场景分别驱动并采样整棵 Electron 进程树的 CPU 时间与工作集，不用单一空闲值代表全部状态。',
  '测量前先预热 15 秒，避免把启动开销记成待机开销。',
  '按已确认的口径，数值未达目标不阻塞交付，这里如实记录。',
  '',
  '| 场景 | CPU（逻辑核） | 占整机 | 内存 MB | 采样时长 |',
  '| --- | --- | --- | --- | --- |',
  table,
  '',
  `目标：待机 CPU ≤ 0.2 逻辑核、内存 ≤ 600 MB。实测待机 ${rows[0].cpuLogical.toFixed(3)} 逻辑核、${rows[0].memoryMb.toFixed(0)} MB。`,
  '',
  '说明：自主活动一栏若 Docker 未运行，记录的是「拒绝启动并提示」路径的开销，不是容器运行时的开销。',
  `重跑：\`node scripts/perf-suite.mjs --seconds=${seconds}\`，需要先执行 \`npm run build\`。`,
  ''
].join('\n')

writeFileSync(join(root, 'docs', '04-PERFORMANCE.md'), report)
console.log(report)
