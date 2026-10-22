import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { ModelGateway } from '../../src/main/model/gateway'
import { memoryCandidateSchema } from '../../src/main/model/contracts'
import type { ResolvedModel } from '../../src/main/model/types'

let server: Server
let baseUrl = ''
let mode: 'no-image' | 'bad-schema' | 'good-schema' = 'no-image'

function model(): ResolvedModel {
  return {
    id: 'm',
    name: '测试',
    provider: 'OpenAI Compatible',
    endpoint: `${baseUrl}/v1`,
    key: '',
    hasKey: true,
    model: 'plain-text',
    caps: ['文本'],
    capabilities: [],
    probeNote: '',
    status: '未验证',
    tone: 'gray',
    default: true,
    latency: '—',
    apiKey: 'test-key'
  }
}

beforeAll(async () => {
  server = createServer((request, response) => {
    request.setEncoding('utf8')
    request.on('data', () => undefined)
    request.on('end', () => {
      if (mode === 'no-image') {
        response.writeHead(400, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ error: { message: 'This model does not support image' } }))
        return
      }
      const payload = mode === 'good-schema'
        ? { action: 'ADD', category: 'user', text: '不吃辣' }
        : { action: 'ADD' }
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({
        choices: [{ message: { tool_calls: [{ function: { arguments: JSON.stringify(payload) } }] } }]
      }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('测试服务启动失败')
  baseUrl = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
})

describe('[IF-05] 图像与结构化输出', () => {
  it('[IF-05] 纯文本模型收到图片时返回明确的能力错误', async () => {
    mode = 'no-image'
    const gateway = new ModelGateway()
    await expect(
      gateway.chatWithImages(model(), '这是什么颜色', [{ mime: 'image/png', base64: 'aGVsbG8=' }])
    ).rejects.toThrow('该模型不支持图像输入')
  })

  it('[NFR-R01] schema 校验失败不使用部分结果', async () => {
    mode = 'bad-schema'
    const gateway = new ModelGateway()
    await expect(
      gateway.callStructured(model(), memoryCandidateSchema, 'emit_memory', '返回记忆', [{ role: 'user', content: '记住我不吃辣' }])
    ).rejects.toThrow(/未使用不完整结果/)
  })

  it('[FR-25] 符合结构的工具结果可以读回', async () => {
    mode = 'good-schema'
    const gateway = new ModelGateway()
    const value = await gateway.callStructured(
      model(),
      z.object({ action: z.literal('ADD'), category: z.literal('user'), text: z.string() }),
      'emit_memory',
      '返回记忆',
      [{ role: 'user', content: '记住我不吃辣' }]
    )
    expect(value.text).toBe('不吃辣')
  })
})
