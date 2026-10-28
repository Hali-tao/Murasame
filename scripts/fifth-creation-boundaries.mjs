import { buildSync } from 'esbuild'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'

const dir = join(process.cwd(), 'previews/overnight-2026-10-29/fifth-creation-boundaries')
await mkdir(dir, { recursive: true })
buildSync({ stdin: { contents: "export * from './src/main/isolation/docker-runtime'; export * from './src/main/isolation/creation';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', outfile: join(dir, 'runtime.cjs') })
const api = createRequire(import.meta.url)(join(dir, 'runtime.cjs'))
const run = api.runCommandAsync; const cases = []
const id = (await run('docker', ['run', '-d', '--network', 'none', '--memory', '512m', '--cpus', '1', '--pids-limit', '32', 'murasame-isolation:fifth-20261029', 'sleep', 'infinity'])).trim()
const check = async (name, work) => { try { const data = await work(); cases.push({ name, ok: true, data }) } catch (error) { cases.push({ name, ok: false, error: error.message }) } console.log(JSON.stringify(cases.at(-1))) }
const execute = async content => api.runCreation(id, randomUUID(), 0, 'code', { title: '独立边界资料', content, expectedOutput: 'fixture' }, undefined, new AbortController().signal)
try {
  await check('separate-nonroot-code-identity', async () => {
    const result = await execute('import os\nprint(os.getuid())')
    assert.equal(result.exitCode, 0); assert.equal(result.stdout.trim(), '1001'); return { uid: result.stdout.trim() }
  })
  await check('candidate-and-collector-files-are-read-only-to-code', async () => {
    const result = await execute('from pathlib import Path\nfor name in ("main.py", "stdout.txt", "stderr.txt"):\n    try:\n        with open(name, "a") as f:\n            f.write("fixture")\n    except PermissionError:\n        print(name + ":protected")')
    assert.equal(result.exitCode, 0)
    assert.equal(result.stdout, 'main.py:protected\nstdout.txt:protected\nstderr.txt:protected\n')
    return { actualOutput: result.stdout }
  })
  await check('generated-script-cannot-connect-to-desktop-services', async () => {
    const result = await execute('import socket\ntry:\n    socket.socket()\nexcept PermissionError:\n    print("network-disabled")')
    assert.equal(result.exitCode, 0); assert.equal(result.stdout.trim(), 'network-disabled'); return { actualOutput: result.stdout }
  })
  await check('child-processes-disabled', async () => {
    const result = await execute('import subprocess\nsubprocess.run(["python3", "-c", "print(42)"])')
    assert.notEqual(result.exitCode, 0); return { exitCode: result.exitCode }
  })
  await check('large-output-rejected', async () => {
    await assert.rejects(execute('print("x" * 40000)')); return { rejected: true }
  })
  await check('wall-time-bounded', async () => {
    const started = Date.now(); const result = await execute('import time\ntime.sleep(60)')
    assert.equal(result.timedOut, true); assert.notEqual(result.exitCode, 0)
    assert.ok(Date.now() - started < 25000); return { elapsedMs: Date.now() - started, exitCode: result.exitCode }
  })
} finally {
  const removed = await api.stopContainerAsync(id)
  await writeFile(join(dir, 'result.json'), JSON.stringify({ cases, removed }, null, 2))
  if (!removed || cases.some(item => !item.ok)) process.exitCode = 1
}
