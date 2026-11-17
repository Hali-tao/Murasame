import { createHash } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ActivityStatus, MurasameApi } from '../../src/shared/types'
import type { MurasameCore } from '../../src/main/core/murasame-core'
import { AutonomyService } from '../../src/main/core/services/autonomy-service'
import type { CreationAgents } from '../../src/main/isolation/creation'

const bridge = vi.hoisted(() => ({
  api: null as MurasameApi | null,
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  listeners: new Map<string, Set<(event: unknown, payload: unknown) => void>>()
}))
vi.mock('electron', () => ({
  app: { getAppPath: () => process.cwd(), getPath: () => process.cwd(), isPackaged: false }, dialog: {}, shell: {}, safeStorage: {}, globalShortcut: {}, nativeImage: {}, screen: {},
  BrowserWindow: { getAllWindows: () => [
    { isDestroyed: () => false, webContents: { send: (channel: string, payload: unknown) => { for (const listener of bridge.listeners.get(channel) ?? []) listener({}, structuredClone(payload)) } } },
    { isDestroyed: () => true, webContents: { send: () => { throw new Error('destroyed window cannot receive events') } } }
  ] },
  ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => bridge.handlers.set(channel, handler) },
  contextBridge: { exposeInMainWorld: (_name: string, api: MurasameApi) => { bridge.api = api } },
  ipcRenderer: {
    invoke: (channel: string, ...args: unknown[]) => bridge.handlers.get(channel)?.({ sender: { isDestroyed: () => false, send() {} } }, ...args),
    on: (channel: string, listener: (event: unknown, payload: unknown) => void) => { const listeners = bridge.listeners.get(channel) ?? new Set(); listeners.add(listener); bridge.listeners.set(channel, listeners) },
    removeListener: (channel: string, listener: (event: unknown, payload: unknown) => void) => bridge.listeners.get(channel)?.delete(listener)
  }
}))
vi.mock('../../src/main/settings', async () => {
  const { initialSettings } = await import('../../src/shared/default-settings')
  return { getSettings: () => initialSettings, onSettingsChanged: () => () => {}, updateSettings: () => initialSettings, readRelationship: () => null, writeRelationship() {} }
})
vi.mock('../../src/main/logger', () => ({ default: { info() {}, warn() {}, error() {} } }))
vi.mock('../../src/main/updater', () => ({ checkForUpdates: async () => ({ status: 'disabled', message: 'synthetic' }) }))
vi.mock('../../src/main/isolation/docker-runtime', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/main/isolation/docker-runtime')>(),
  ensureDocker: vi.fn(async () => ({ ok: true as const })),
  isolationEnvironmentAsync: vi.fn(async () => ({ docker: true, image: true, detail: 'synthetic ready' }))
}))

let service: AutonomyService
let api: MurasameApi
const draft = { title: '真实事件通路', content: 'print(42)', expectedOutput: '42' }
const bytes = Buffer.from(draft.content)
const evidence = { name: 'main.py', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), base64: bytes.toString('base64'), text: draft.content, stdout: '42\n', stderr: '', exitCode: 0, timedOut: false }
const agents: CreationAgents = {
  modelName: 'synthetic', draft: async () => draft,
  review: async () => ({ accepted: true, reason: '独立核验成功' })
}
const start = { dockerAvailable: true, approved: true, needsPermission: false, share: null, allowNetwork: false, kind: 'code' as const }
function deferred<T>() { let resolve!: (value: T) => void; return { promise: new Promise<T>(done => { resolve = done }), resolve: (value: T) => resolve(value) } }

beforeEach(async () => {
  vi.resetModules(); bridge.api = null; bridge.handlers.clear(); bridge.listeners.clear()
  service = new AutonomyService((_command, args) => args[0] === 'image' ? '3' : args[0] === 'run' ? 'bridge-fixture' : args[0] === 'inspect' ? 'true' : args.includes('/opt/murasame/creation-runner.py') ? JSON.stringify(evidence) : '', async () => {})
  const core = { autonomy: service, subscribeModels() {}, memory: { subscribe() {}, subscribeIndex() {} }, tasks: { onChange() {} } } as unknown as MurasameCore
  const { registerIpcHandlers } = await import('../../src/main/ipc')
  registerIpcHandlers(core)
  await import('../../src/preload/index')
  api = bridge.api!
})
afterEach(async () => { await service?.stop({ containerGone: false }); bridge.listeners.clear(); vi.restoreAllMocks() })

it('[FR-28] delivers real service stages and verified artifact through IPC and preload, then detaches', async () => {
  const events: ActivityStatus[] = []
  const off = api.autonomy.onStatusChanged(state => events.push(state))
  await service.start(start); await service.produce('code', '打印42', agents)
  expect(events.some(state => state.creation?.phase === 'drafting')).toBe(true)
  expect(events.some(state => state.creation?.phase === 'executing')).toBe(true)
  expect(events.some(state => state.creation?.phase === 'reviewing')).toBe(true)
  expect(events.at(-1)).toMatchObject({ activityId: service.status().activityId, running: true, busy: false, creation: { phase: 'ready', artifact: { name: 'main.py' } } })
  const count = events.length
  off(); off(); await service.stop({ containerGone: false })
  expect(events).toHaveLength(count)
})

it('[FR-30] exposes preparation and cancellation without claiming an unstarted activity completed', async () => {
  const { ensureDocker } = await import('../../src/main/isolation/docker-runtime')
  const preparation = deferred<{ ok: false; detail: string }>()
  vi.mocked(ensureDocker).mockReturnValue(preparation.promise)
  const events: ActivityStatus[] = []
  api.autonomy.onStatusChanged(state => events.push(state))
  const pending = api.autonomy.start({ confirmed: true, allowNetwork: false, kind: 'code' })
  expect(events.at(-1)).toMatchObject({ phase: 'preparing', running: false, busy: true, canStop: true })
  expect((await api.autonomy.status()).phase).toBe('preparing')
  await api.autonomy.stop()
  expect(events.at(-1)).toMatchObject({ phase: 'stopping', running: false, busy: true })
  preparation.resolve({ ok: false, detail: 'synthetic cancelled preparation' })
  expect((await pending).ok).toBe(false)
  expect(events.at(-1)).toMatchObject({ phase: 'idle', running: false, busy: false, canStop: false })
  expect(events.some(state => state.running || state.creation?.phase === 'ready')).toBe(false)
})

it('[FR-28] preparing an image never overlays an active verified creation in events or status', async () => {
  const { ensureDocker } = await import('../../src/main/isolation/docker-runtime')
  const preparation = deferred<{ ok: true }>()
  vi.mocked(ensureDocker).mockReturnValue(preparation.promise)
  await service.start(start); await service.produce('code', '保留产物', agents)
  const artifact = service.status().creation!.artifact!
  const events: ActivityStatus[] = []
  api.autonomy.onStatusChanged(state => events.push(state))
  const pending = api.autonomy.buildImage()
  expect(await api.autonomy.status()).toMatchObject({ phase: 'running', creation: { artifact } })
  preparation.resolve({ ok: true }); await pending
  expect(events.every(state => state.running && state.phase === 'running' && state.creation?.artifact?.id === artifact.id)).toBe(true)
  expect(service.status().creation?.artifact).toEqual(artifact)
})
