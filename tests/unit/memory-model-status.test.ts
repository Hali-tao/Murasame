import { beforeEach, expect, it, vi } from 'vitest'
const runtime = vi.hoisted(() => ({ missing: vi.fn(), embed: vi.fn(), install: vi.fn() }))
vi.mock('../../src/main/local/embedding', () => ({ missingEmbeddingFiles: runtime.missing, embedLocally: runtime.embed, resetEmbeddingRuntime: vi.fn() }))
vi.mock('../../src/main/local/memory-model-install', () => ({ installMemoryModel: runtime.install }))
beforeEach(() => { vi.resetModules(); vi.resetAllMocks(); runtime.missing.mockReturnValue([]) })

it('[FR-14] complete files are not ready until real inference succeeds; concurrent checks share work', async () => {
  let resolve!: (value: number[]) => void
  runtime.embed.mockReturnValue(new Promise<number[]>(done => { resolve = done }))
  const api = await import('../../src/main/local/memory-status')
  api.refreshMemoryStatus('profile')
  expect(api.memoryReady()).toBe(false)
  const first = api.checkMemoryModel('profile'), second = api.checkMemoryModel('profile')
  expect(first).toBe(second)
  expect(api.memoryModelStatus().state).toBe('preparing')
  resolve([1])
  expect((await first).state).toBe('ready')
  expect(runtime.embed).toHaveBeenCalledTimes(1)
})

it('[FR-14] missing and damaged models stay unavailable and a subsequent check can recover', async () => {
  const api = await import('../../src/main/local/memory-status')
  runtime.missing.mockReturnValue(['config.json'])
  expect((await api.checkMemoryModel('profile')).state).toBe('missing')
  expect(runtime.embed).not.toHaveBeenCalled()
  runtime.missing.mockReturnValue([]); runtime.embed.mockResolvedValue(null)
  expect((await api.checkMemoryModel('profile')).state).toBe('error')
  expect(api.memoryReady()).toBe(false)
  runtime.embed.mockResolvedValue([1])
  expect((await api.checkMemoryModel('profile')).state).toBe('ready')
})

it('[FR-14] downloads require explicit installation and failed downloads never claim readiness', async () => {
  const api = await import('../../src/main/local/memory-status')
  runtime.missing.mockReturnValue(['config.json'])
  await api.checkMemoryModel('profile')
  expect(runtime.install).not.toHaveBeenCalled()
  runtime.install.mockRejectedValue(new Error('offline'))
  expect((await api.checkMemoryModel('profile', true)).state).toBe('error')
  expect(api.memoryReady()).toBe(false)
})
