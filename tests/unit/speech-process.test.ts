import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SpeechProcessClient, type SpeechChild } from '../../src/main/local/speech-process'

const request = { modelDirectory: 'E:/synthetic/models/kokoro', phonemes: 'ni xau', voice: 'zf_xiaoxiao' }
const audio = { audio: new Float32Array([0.1, -0.1]), sampleRate: 24000, played: true, message: '本地合成完成' }
class Child extends EventEmitter {
  postMessage = vi.fn()
  kill = vi.fn(() => true)
  reply(id: number, result: unknown = audio): void { this.emit('message', { id, result }) }
}
function setup() {
  const children: Child[] = []
  const factory = vi.fn(() => { const child = new Child(); children.push(child); return child as SpeechChild })
  const client = new SpeechProcessClient(factory, { timeoutMs: 100, maxPending: 4 })
  return { client, children, factory }
}
afterEach(() => vi.useRealTimers())

describe('local speech process lifecycle', () => {
  it('starts lazily and sends one request at a time while retaining audio', async () => {
    const { client, children, factory } = setup()
    expect(factory).not.toHaveBeenCalled()
    const first = client.synthesize(request), second = client.synthesize({ ...request, phonemes: 'second' })
    expect(factory).toHaveBeenCalledTimes(1)
    expect(children[0].postMessage).toHaveBeenCalledTimes(1)
    children[0].reply(1)
    expect(await first).toEqual(audio)
    expect(children[0].postMessage).toHaveBeenLastCalledWith({ id: 2, ...request, phonemes: 'second' })
    children[0].reply(2)
    expect((await second).played).toBe(true)
    client.dispose()
  })
  it('bounds pending work without interrupting accepted speech', async () => {
    const { client, children } = setup()
    const pending = Array.from({ length: 4 }, () => client.synthesize(request))
    const rejected = await client.synthesize(request)
    expect(rejected.played).toBe(false); expect(rejected.message).toContain('繁忙')
    expect(children[0].kill).not.toHaveBeenCalled()
    client.dispose()
    expect((await Promise.all(pending)).every(result => !result.played)).toBe(true)
  })
  it('times out current and queued requests, kills computation and permits a fresh request', async () => {
    vi.useFakeTimers()
    const { client, children } = setup()
    const a = client.synthesize(request), b = client.synthesize(request)
    await vi.advanceTimersByTimeAsync(100)
    expect((await a).message).toContain('超时'); expect((await b).played).toBe(false)
    expect(children[0].kill).toHaveBeenCalledTimes(1)
    const c = client.synthesize(request)
    expect(children).toHaveLength(2)
    children[1].reply(3)
    expect((await c).played).toBe(true)
    client.dispose()
  })
  it('fails all outstanding requests on exit without replaying and ignores the old process', async () => {
    const { client, children } = setup()
    const a = client.synthesize(request), b = client.synthesize(request)
    children[0].emit('exit', 7)
    expect((await a).played).toBe(false); expect((await b).message).toContain('退出')
    const c = client.synthesize(request)
    children[0].reply(3); children[0].emit('exit', 8)
    expect(children[1].kill).not.toHaveBeenCalled()
    children[1].reply(3)
    expect((await c).played).toBe(true)
    client.dispose()
  })
  it('ignores stale or unrelated result ids', async () => {
    const { client, children } = setup()
    const settled = vi.fn()
    const a = client.synthesize(request).then(settled)
    children[0].reply(0); children[0].reply(2)
    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()
    children[0].reply(1); await a
    expect(settled).toHaveBeenCalledWith(audio)
    client.dispose()
  })
  it.each([{}, { ...audio, audio: [1] }, { ...audio, sampleRate: 0 }, { ...audio, audio: null }])('rejects malformed matching result %j', async invalid => {
    const { client, children } = setup()
    const a = client.synthesize(request)
    children[0].reply(1, invalid)
    expect((await a).played).toBe(false)
    expect(children[0].kill).toHaveBeenCalledTimes(1)
    client.dispose()
  })
  it('retains an explicit model error and continues the queue', async () => {
    const { client, children } = setup()
    const a = client.synthesize(request), b = client.synthesize(request)
    children[0].reply(1, { ...audio, audio: null, played: false, message: '音色文件不可读' })
    expect((await a).message).toBe('音色文件不可读')
    children[0].reply(2); expect((await b).played).toBe(true)
    client.dispose()
  })
  it('settles startup failure without throwing or leaving an active timer', async () => {
    vi.useFakeTimers()
    const client = new SpeechProcessClient(() => { throw new Error('cannot spawn') })
    expect((await client.synthesize(request)).message).toContain('cannot spawn')
    expect(vi.getTimerCount()).toBe(0)
    client.dispose()
  })
  it('settles a failed message send and shuts down its process', async () => {
    const child = new Child()
    child.postMessage.mockImplementation(() => { throw new Error('closed pipe') })
    const client = new SpeechProcessClient(() => child as SpeechChild)
    expect((await client.synthesize(request)).message).toContain('closed pipe')
    expect(child.kill).toHaveBeenCalledOnce()
    client.dispose()
  })
  it('dispose is idempotent and late phonemizer completion cannot reopen a process', async () => {
    vi.useFakeTimers()
    const { client, children, factory } = setup()
    const a = client.synthesize(request), b = client.synthesize(request)
    client.dispose(); client.dispose()
    expect((await a).played).toBe(false); expect((await b).played).toBe(false)
    expect((await client.synthesize(request)).message).toContain('关闭')
    expect(factory).toHaveBeenCalledTimes(1)
    expect(children[0].kill).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
})
