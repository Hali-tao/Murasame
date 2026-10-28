import { buildSync } from 'esbuild'
import { createRequire } from 'node:module'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID, createHash } from 'node:crypto'
import assert from 'node:assert/strict'

const root = fileURLToPath(new URL('..', import.meta.url))
const dir = join(root, 'previews/overnight-2026-10-29/fifth-creation-live')
await mkdir(dir, { recursive: true })
buildSync({ stdin: { contents: "export * from './src/main/isolation/docker-runtime'; export * from './src/main/isolation/creation'; export * from './src/main/isolation/browser-observation'; export * from './src/main/core/services/autonomy-service';", resolveDir: root, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', outfile: join(dir, 'runtime.cjs') })
const api = createRequire(import.meta.url)(join(dir, 'runtime.cjs'))
api.configureContainerOwner(`fifth-${randomUUID()}`)
const image = 'murasame-isolation:fifth-20261029'
const cases = []; const containers = []; const services = []
const runner = async (command, args, options) => {
  const actual = args.map(arg => arg === 'murasame-isolation:local' ? image : arg)
  if (actual[0] === 'run') {
    const port = actual.indexOf('-p'); if (port >= 0) actual[port + 1] = '127.0.0.1::6901'
  }
  const result = await api.runCommandAsync(command, actual, options)
  if (actual[0] === 'run') containers.push(result.trim())
  return result
}
const record = async (name, work) => {
  try { const data = await work(); cases.push({ name, ok: true, data }); console.log(JSON.stringify(cases.at(-1))); return data }
  catch (error) { cases.push({ name, ok: false, error: error.message }); console.log(JSON.stringify(cases.at(-1))); return null }
}
const start = async () => {
  const service = new api.AutonomyService(runner); services.push(service)
  const status = await service.start({ dockerAvailable: true, approved: true, needsPermission: false, share: null, allowNetwork: false })
  assert.equal(status.ok, true, JSON.stringify(status)); return service
}
const agents = (draft, review = () => ({ accepted: true, reason: '合成边界fixture：目标与真实输出吻合' })) => ({
  modelName: 'Synthetic Worker/Critic boundary',
  draft: async (input, control) => { control.beforeSend(); return typeof draft === 'function' ? draft(input) : draft },
  review: async (input, control) => { control.beforeSend(); return review(input) }
})
const capture = async (name) => {
  const id = containers.at(-1)
  await new Promise(resolve => setTimeout(resolve, name.includes('code') ? 18000 : 2500))
  await api.runInContainerAsync(id, ['scrot', '-o', '/tmp/fifth.png'], runner, { desktop: true })
  const raw = await api.runInContainerAsync(id, ['base64', '-w', '0', '/tmp/fifth.png'], runner)
  await writeFile(join(dir, name), Buffer.from(raw, 'base64'))
  if (name.includes('code')) {
    const observation = await api.observeBrowser(id, runner, { expectedUrl: 'http://127.0.0.1:8080/' })
    await writeFile(join(dir, 'editor-observation.json'), JSON.stringify(observation, null, 2))
    assert.match(observation.text, /main.py/i)
    assert.match(observation.text, /print/)
  }
}
try {
  await record('office-real-libreoffice-readback-export', async () => {
    const service = await start()
    const draft = { title: '独立合成学习安排', content: '第一天：阅读并完成练习。\n第二天：复盘错误，整理总结。\n验收：完成5道独立题目。\n字符转义：<任务> & "证据"。', expectedOutput: '' }
    const result = await service.produce('office', '制作两天学习安排，含验收', agents(draft))
    assert.equal(result.ok, true, JSON.stringify(result))
    const artifact = service.status().creation.artifact
    assert.equal(artifact.preview, draft.title + '\n' + draft.content)
    await capture('actual-libreoffice.png')
    const output = join(dir, `office-${randomUUID()}.odt`)
    const exported = await service.exportCreation(artifact.id, output)
    assert.equal(exported.ok, true, JSON.stringify(exported))
    assert.equal(createHash('sha256').update(await readFile(output)).digest('hex'), artifact.sha256)
    assert.equal((await service.exportCreation(artifact.id, output)).ok, false)
    await service.stop({ containerGone: false })
    return { output, sha256: artifact.sha256, status: service.status().result.status }
  })
  await record('python-actual-run-one-review-revision-editor-export', async () => {
    const service = await start(); let reviews = 0; let drafts = 0
    const number = 9 + Math.floor(Math.random() * 40)
    const draft = { title: '平方和', content: `print(sum(i*i for i in range(1, ${number + 1})))`, expectedOutput: String(number * (number + 1) * (2 * number + 1) / 6) }
    const result = await service.produce('code', `计算1到${number}的平方和`, agents(() => { drafts++; return draft }, () => ({ accepted: ++reviews === 2, reason: reviews === 1 ? '合成审阅要求一次修订，以验证有界反馈' : '真实平方和输出正确' })))
    assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(reviews, 2); assert.equal(drafts, 2)
    const artifact = service.status().creation.artifact
    assert.equal(artifact.stdout.trim(), draft.expectedOutput); assert.equal(artifact.attempt, 1)
    await capture('actual-code-server.png')
    const output = join(dir, `script-${randomUUID()}.py`)
    assert.equal((await service.exportCreation(artifact.id, output)).ok, true)
    assert.equal(await readFile(output, 'utf8'), draft.content)
    const id = containers.at(-1)
    const info = JSON.parse(await api.runCommandAsync('docker', ['inspect', '-f', '{{json .HostConfig}}', id]))
    assert.equal(info.NetworkMode, 'none'); assert.equal(info.Binds?.length || 0, 0); assert.equal(info.Devices?.length || 0, 0)
    const versions = await api.runInContainerAsync(id, ['sh', '-c', 'libreoffice --version; code-server --version; id murasame-code'], runner)
    await service.stop({ containerGone: false })
    return { output, actualOutput: artifact.stdout, sha256: artifact.sha256, drafts, reviews, versions, network: info.NetworkMode }
  })
  await record('failed-runtime-cannot-be-accepted-by-critic', async () => {
    const service = await start(); let reviews = 0
    const result = await service.produce('code', '打印42', agents({ title: '失败例', content: 'raise RuntimeError("fixture failure")', expectedOutput: '42' }, () => { reviews++; return { accepted: true, reason: '不应到达' } }))
    assert.equal(result.ok, false); assert.equal(reviews, 0); assert.equal(service.status().result.status, 'failed')
    return { error: result.error, reviews, cleanup: service.status().result.cleanupSucceeded }
  })
} finally {
  for (const service of services) await service.stop({ containerGone: false })
  const remaining = []
  for (const id of containers) if (await api.containerRunningAsync(id)) remaining.push(id)
  await writeFile(join(dir, 'result.json'), JSON.stringify({ image, cases, containers, remaining, boundary: 'Real Docker, LibreOffice, code-server and Python. Worker/Critic callbacks are controlled fixtures, not an external model quality evaluation.' }, null, 2))
  if (remaining.length || cases.some(item => !item.ok)) process.exitCode = 1
}
