import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { afterEach, expect, it } from 'vitest'
import { AutonomyService, type AutonomyState } from '../../src/main/core/services/autonomy-service'
import type { CreationAgents } from '../../src/main/isolation/creation'
import type { DockerRunner } from '../../src/main/isolation/docker-runtime'

const draft = { title: '独立状态样例', content: 'print(42)', expectedOutput: '42' }
const data = Buffer.from(draft.content)
const evidence = { name: 'main.py', bytes: data.length, sha256: createHash('sha256').update(data).digest('hex'), base64: data.toString('base64'), text: draft.content, stdout: '42\n', stderr: '', exitCode: 0, timedOut: false }
const start = { dockerAvailable: true, approved: true, needsPermission: false, share: null, allowNetwork: false, kind: 'code' as const }
const services: AutonomyService[] = []

function deferred<T>() {
  let resolve!: (value: T) => void
  return { promise: new Promise<T>(done => { resolve = done }), resolve: (value: T) => resolve(value) }
}

function fixture(exec?: DockerRunner) {
  const calls: string[][] = []
  const service = new AutonomyService((command, args, options) => {
    calls.push(args)
    if (args[0] === 'image') return '3'
    if (args[0] === 'run') return `status-container-${calls.filter(item => item[0] === 'run').length}`
    if (args[0] === 'inspect') return 'true'
    if (args[0] === 'exec') return exec ? exec(command, args, options) : args.includes('/opt/murasame/creation-runner.py') ? JSON.stringify(evidence) : ''
    return ''
  }, async () => {})
  const agents: CreationAgents = {
    modelName: 'synthetic-status-model',
    draft: async (_input, control) => { control.beforeSend(); return draft },
    review: async (_input, control) => { control.beforeSend(); return { accepted: true, reason: '独立输出吻合' } }
  }
  services.push(service)
  return { service, agents, calls }
}

afterEach(async () => {
  await Promise.all(services.splice(0).map(service => service.stop({ containerGone: false })))
})

it('[FR-28] publishes actual preparation, creation stages and final ready without polling Docker', async () => {
  const { service, agents, calls } = fixture()
  const events: AutonomyState[] = []
  service.subscribe(state => events.push(state))
  expect(calls).toEqual([])
  await service.start(start)
  expect(events.map(state => state.phase)).toEqual(['preparing', 'running'])
  const activityId = events.at(-1)!.activityId
  await service.produce('code', '打印42', agents)
  const stages = events.flatMap((state, index) => state.creation && state.creation.phase !== events[index - 1]?.creation?.phase ? [state.creation.phase] : [])
  expect(stages).toEqual(['drafting', 'executing', 'reviewing', 'ready'])
  expect(events.some(state => state.busy && state.creation?.phase === 'drafting')).toBe(true)
  expect(events.at(-1)).toMatchObject({ activityId, running: true, busy: false, creation: { phase: 'ready', artifact: { name: 'main.py', preview: 'print(42)' } } })
  expect(events.every(state => state.activityId === activityId)).toBe(true)
  expect(calls.filter(args => args[0] === 'inspect')).toHaveLength(0)
})

it('[FR-30] publishes cancellation and discards a late worker result', async () => {
  const { service, agents } = fixture()
  const events: AutonomyState[] = []
  const entered = deferred<void>(); const worker = deferred<typeof draft>()
  agents.draft = async () => { entered.resolve(); return worker.promise }
  service.subscribe(state => events.push(state))
  await service.start(start)
  const pending = service.produce('code', '取消样例', agents)
  await entered.promise
  await service.stop({ containerGone: false }); await pending
  expect(events.some(state => state.phase === 'stopping' && !state.running)).toBe(true)
  expect(events.at(-1)).toMatchObject({ phase: 'stopped', running: false, busy: false, result: { status: 'cancelled', cleanupSucceeded: true } })
  const count = events.length
  worker.resolve(draft); await Promise.resolve()
  expect(events).toHaveLength(count)
  expect(events.some(state => state.creation?.phase === 'ready')).toBe(false)
})

it('[FR-21] publishes failed creation and busy release without inventing a verified artifact', async () => {
  const { service, agents } = fixture()
  const events: AutonomyState[] = []
  agents.draft = async () => { throw new Error('synthetic draft failure') }
  service.subscribe(state => events.push(state))
  await service.start(start)
  expect((await service.produce('code', '失败样例', agents)).ok).toBe(false)
  expect(events.at(-1)).toMatchObject({ phase: 'failed', running: false, busy: false, creation: { phase: 'failed' }, result: { status: 'failed', cleanupSucceeded: true } })
  expect(events.at(-1)?.creation?.artifact).toBeUndefined()
})

it('[FR-28] isolates observer mutations and exceptions so another observer receives the verified artifact', async () => {
  const { service, agents } = fixture()
  const events: AutonomyState[] = []
  service.subscribe(state => { state.notes.push('observer mutation'); if (state.creation?.artifact) state.creation.artifact.name = 'changed'; throw new Error('synthetic observer error') })
  service.subscribe(async () => { throw new Error('synthetic async observer error') })
  service.subscribe(state => events.push(state))
  await service.start(start)
  expect((await service.produce('code', '真实状态不由订阅者改变', agents)).ok).toBe(true)
  expect(events.every(state => !state.notes.includes('observer mutation'))).toBe(true)
  expect(events.at(-1)?.creation?.artifact?.name).toBe('main.py')
  events.at(-1)!.creation!.artifact!.name = 'retained snapshot mutation'
  expect(service.status().creation?.artifact?.name).toBe('main.py')
})

it('[FR-30] unsubscribe removes only its listener and is safe to repeat', async () => {
  const { service } = fixture()
  const detached: AutonomyState[] = []; const active: AutonomyState[] = []
  const unsubscribe = service.subscribe(state => detached.push(state))
  service.subscribe(state => active.push(state))
  await service.start(start)
  const count = detached.length
  unsubscribe(); unsubscribe()
  await service.stop({ containerGone: false })
  expect(detached).toHaveLength(count)
  expect(active.at(-1)?.phase).toBe('stopped')
})

it('[FR-30] an older operation finishing after replacement cannot emit a stale activity or busy flag', async () => {
  const gate = deferred<string>(); const entered = deferred<void>()
  const { service } = fixture((_command, args) => {
    if (args.includes('https://synthetic.invalid/held')) { entered.resolve(); return gate.promise }
    return ''
  })
  const events: AutonomyState[] = []
  service.subscribe(state => events.push(state))
  await service.start({ ...start, allowNetwork: true })
  const oldId = service.status().activityId
  const pending = service.openPage('https://synthetic.invalid/held')
  await entered.promise
  await service.stop({ containerGone: false })
  await service.start(start)
  const newId = service.status().activityId
  const count = events.length
  gate.resolve(''); await pending
  expect(newId).not.toBe(oldId)
  expect(events).toHaveLength(count)
  expect(events.at(-1)).toMatchObject({ activityId: newId, running: true, busy: false })
})

it('[FR-28] failed export releases busy while preserving the exact verified artifact in status events', async () => {
  const reading = deferred<string>(); const entered = deferred<void>()
  const { service, agents } = fixture((_command, args, options) => {
    if (!args.includes('/opt/murasame/creation-runner.py')) return ''
    if (JSON.parse(options?.input ?? '{}').action === 'read') { entered.resolve(); return reading.promise }
    return JSON.stringify(evidence)
  })
  const events: AutonomyState[] = []
  service.subscribe(state => events.push(state))
  await service.start(start); await service.produce('code', '导出核验产物', agents)
  const artifact = service.status().creation!.artifact!
  const pending = service.exportCreation(artifact.id, join(process.cwd(), 'previews', 'tmp', 'unused-status-export.py'))
  await entered.promise
  expect(events.at(-1)).toMatchObject({ busy: true, creation: { phase: 'ready', artifact } })
  reading.resolve(JSON.stringify({ ...evidence, base64: Buffer.from('changed').toString('base64') }))
  expect((await pending).ok).toBe(false)
  expect(events.at(-1)).toMatchObject({ running: true, busy: false, creation: { phase: 'ready', artifact } })
  expect(events.at(-1)?.creation).not.toHaveProperty('saved')
})

it('[FR-28] publishes a saved receipt only after actual host bytes are verified and preserves it on a rejected overwrite', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'murasame-export-status-'))
  try {
    const { service, agents } = fixture()
    const events: AutonomyState[] = []
    service.subscribe(state => events.push(state))
    await service.start(start); await service.produce('code', '保存独立核验产物', agents)
    const artifact = service.status().creation!.artifact!
    const path = join(directory, 'result.py')
    expect(service.status().creation).not.toHaveProperty('saved')
    expect((await service.exportCreation(artifact.id, path)).ok).toBe(true)
    expect(readFileSync(path).equals(data)).toBe(true)
    const saved = { artifactId: artifact.id, path, bytes: artifact.bytes, sha256: artifact.sha256 }
    expect(events.at(-1)).toMatchObject({ busy: false, creation: { phase: 'ready', artifact, saved } })
    expect((await service.exportCreation(artifact.id, path)).ok).toBe(false)
    expect(service.status().creation).toMatchObject({ artifact, saved })
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
