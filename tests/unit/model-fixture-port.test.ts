import { Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startModelServer } from '../e2e/helpers'

afterEach(() => vi.restoreAllMocks())

describe('[NFR-M02] 模型夹具不使用Fetch禁用的低位端口', () => {
  it('[NFR-M02] 即使操作系统的零端口分配返回1723，模型夹具仍可完成真实请求', async () => {
    const originalListen = Server.prototype.listen
    vi.spyOn(Server.prototype, 'listen').mockImplementation(function (this: Server, ...args: unknown[]) {
      if (args[0] === 0) args[0] = 1723
      return Reflect.apply(originalListen, this, args)
    })
    const fixture = await startModelServer()
    try {
      const response = await fetch(`${fixture.url}/chat/completions`, {
        method: 'POST', headers: { authorization: 'Bearer test-key', 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'test-model', messages: [{ role: 'user', content: 'fixture connection' }] })
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ choices: [{ message: { content: 'OK' } }] })
      expect(Number(new URL(fixture.url).port)).toBeGreaterThanOrEqual(49152)
    } finally { await fixture.close() }
  })
})
