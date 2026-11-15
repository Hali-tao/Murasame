import { EventEmitter } from 'node:events'
import { createServer, type Server } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { listenHttp } from '../helpers/http-server'

class ListenerFixture extends EventEmitter {
  readonly ports: number[] = []
  constructor(private readonly failures: Array<string | undefined>) { super() }
  listen(port: number): this {
    this.ports.push(port)
    const code = this.failures.shift()
    queueMicrotask(() => {
      if (code) this.emit('error', Object.assign(new Error(code), { code }))
      else this.emit('listening')
    })
    return this
  }
}

describe('[NFR-M02] HTTP测试夹具的高位端口与失败语义', () => {
  it.each(['EADDRINUSE', 'EACCES'])('[NFR-M02] %s 后重新绑定高位端口并移除临时监听器', async code => {
    const fixture = new ListenerFixture([code, undefined])
    await listenHttp(fixture as unknown as Server)
    expect(fixture.ports).toHaveLength(2)
    expect(fixture.ports.every(port => port >= 49152 && port <= 65535)).toBe(true)
    expect(fixture.listenerCount('error') + fixture.listenerCount('listening')).toBe(0)
  })

  it('[NFR-M02] 不吞掉非端口占用类错误，也不继续重试', async () => {
    const fixture = new ListenerFixture(['ECONNRESET', undefined])
    await expect(listenHttp(fixture as unknown as Server)).rejects.toMatchObject({ code: 'ECONNRESET' })
    expect(fixture.ports).toHaveLength(1)
    expect(fixture.listenerCount('error') + fixture.listenerCount('listening')).toBe(0)
  })

  it('[NFR-M02] 同步监听异常原样传播并清理监听器', async () => {
    const fixture = new ListenerFixture([])
    const failure = new Error('同步监听失败')
    const attempt = vi.spyOn(fixture, 'listen').mockImplementation(() => { throw failure })
    await expect(listenHttp(fixture as unknown as Server)).rejects.toBe(failure)
    expect(attempt).toHaveBeenCalledTimes(1)
    expect(fixture.listenerCount('error') + fixture.listenerCount('listening')).toBe(0)
  })

  it('[NFR-M02] 端口持续冲突时在16次内结束，保留最后错误', async () => {
    const fixture = new ListenerFixture(Array.from({ length: 16 }, () => 'EADDRINUSE'))
    await expect(listenHttp(fixture as unknown as Server)).rejects.toMatchObject({ cause: { code: 'EADDRINUSE' } })
    expect(fixture.ports).toHaveLength(16)
    expect(fixture.listenerCount('error') + fixture.listenerCount('listening')).toBe(0)
  })

  it('[NFR-M02] 真实服务仅接受一次真实HTTP请求并正常关闭', async () => {
    let requests = 0
    const server = createServer((_request, response) => { requests++; response.end('safe-fixture') })
    try {
      await listenHttp(server)
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('No HTTP fixture address')
      expect(address.port).toBeGreaterThanOrEqual(49152)
      const response = await fetch(`http://127.0.0.1:${address.port}`)
      expect(await response.text()).toBe('safe-fixture')
      expect(requests).toBe(1)
    } finally {
      if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  })
})
