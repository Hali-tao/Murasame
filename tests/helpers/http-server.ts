import { randomInt } from 'node:crypto'
import type { Server } from 'node:http'

/** Low ephemeral ports can be blocked by Fetch before any request is sent. */
export async function listenHttp(server: Server): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt < 16; attempt++) {
    const port = randomInt(49152, 65536)
    try {
      await new Promise<void>((resolve, reject) => {
        const cleanup = (): void => {
          server.off('error', onError)
          server.off('listening', onListening)
        }
        const onError = (error: Error): void => { cleanup(); reject(error) }
        const onListening = (): void => { cleanup(); resolve() }
        server.once('error', onError)
        server.once('listening', onListening)
        try { server.listen(port, '127.0.0.1') }
        catch (error) { cleanup(); reject(error) }
      })
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EADDRINUSE' && code !== 'EACCES') throw error
      lastError = error
    }
  }
  throw new Error('16 次尝试后仍无法为 HTTP 测试服务分配可用端口', { cause: lastError })
}
