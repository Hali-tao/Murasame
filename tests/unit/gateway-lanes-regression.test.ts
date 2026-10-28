import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModelGateway } from '../../src/main/model/gateway'
import type { ResolvedModel } from '../../src/main/model/types'

const profile = { id: 'lanes', provider: 'Ollama', endpoint: 'http://127.0.0.1:11434', model: 'test', apiKey: '' } as ResolvedModel
const response = () => new Response(JSON.stringify({ choices: [{ message: { content: '完成' } }] }), { headers: { 'content-type': 'application/json' } })
afterEach(() => vi.unstubAllGlobals())

describe('model queue isolation', () => {
  it('a pending visual request does not block a text conversation', async () => {
    let release!: (value: Response) => void
    const pending = new Promise<Response>(resolve => { release = resolve })
    const fetcher = vi.fn().mockReturnValueOnce(pending).mockResolvedValue(response())
    vi.stubGlobal('fetch', fetcher)
    const gateway = new ModelGateway()
    const vision = gateway.chatWithImages(profile, '观察', [{ mime: 'image/png', base64: 'fixture' }])
    await Promise.resolve(); await Promise.resolve()
    const chat = gateway.chat(profile, [{ role: 'user', content: '你好' }])
    try {
      await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2), { timeout: 300 })
    } finally {
      release(response())
      await Promise.all([vision, chat])
    }
  })
})

it('a queued visual request checks revoked authorization before fetch', async () => {
  let release!: (value: Response) => void
  const fetcher = vi.fn().mockReturnValueOnce(new Promise<Response>(resolve => { release = resolve })).mockResolvedValue(response())
  vi.stubGlobal('fetch', fetcher)
  const gateway = new ModelGateway()
  const first = gateway.chatWithImages(profile, 'first', [{ mime: 'image/png', base64: 'fixture' }])
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
  let allowed = true
  const second = gateway.chatWithImages(profile, 'second', [{ mime: 'image/png', base64: 'fixture' }], undefined, undefined, { beforeSend: () => { if (!allowed) throw new Error('revoked') } })
  const assertion = expect(second).rejects.toThrow('revoked')
  allowed = false; release(response())
  await first; await assertion
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it('a cancelled queued request never reaches transport', async () => {
  let release!: (value: Response) => void
  const fetcher = vi.fn().mockReturnValueOnce(new Promise<Response>(resolve => { release = resolve })).mockResolvedValue(response())
  vi.stubGlobal('fetch', fetcher)
  const gateway = new ModelGateway()
  const first = gateway.chatWithImages(profile, 'first', [{ mime: 'image/png', base64: 'fixture' }])
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
  const controller = new AbortController()
  const second = gateway.chatWithImages(profile, 'second', [{ mime: 'image/png', base64: 'fixture' }], undefined, undefined, { signal: controller.signal })
  const assertion = expect(second).rejects.toBeTruthy()
  controller.abort(); release(response())
  await first; await assertion
  expect(fetcher).toHaveBeenCalledTimes(1)
})
