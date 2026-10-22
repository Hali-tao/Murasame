import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { ModelApiClient } from '../../src/main/core/model-client'
import type { ResolvedModel } from '../../src/main/core/model-repository'

let server: Server
let baseUrl = ''

function profile(overrides: Partial<ResolvedModel>): ResolvedModel {
  return {
    id: 'test-model',
    name: '测试模型',
    provider: 'OpenAI Compatible',
    endpoint: baseUrl,
    key: '',
    hasKey: true,
    model: 'test-model',
    caps: ['文本'],
    status: '未验证',
    tone: 'gray',
    default: true,
    latency: '—',
    apiKey: 'test-key',
    ...overrides
  }
}

beforeAll(async () => {
  server = createServer((request, response) => {
    let raw = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => { raw += chunk })
    request.on('end', () => {
      const payload = JSON.parse(raw) as { stream?: boolean }
      if (request.url?.endsWith('/v1/chat/completions')) {
        if (request.headers.authorization !== 'Bearer test-key') {
          response.writeHead(401, { 'Content-Type': 'application/json' })
          response.end('{"error":"invalid key"}')
          return
        }
        if (!payload.stream) {
          response.writeHead(200, { 'Content-Type': 'application/json' })
          response.end(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }))
          return
        }
        response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8' })
        response.write('data: {"choices":[{"delta":{"content":"你"}}]}\n\n')
        response.write('data: {"choices":[{"delta":{"content":"好"}}]}\n\n')
        response.end('data: [DONE]\n\n')
        return
      }
      if (request.url?.endsWith('/v1/messages')) {
        if (request.headers['x-api-key'] !== 'anthropic-key') {
          response.writeHead(401, { 'Content-Type': 'application/json' })
          response.end('{"error":"invalid key"}')
          return
        }
        if (!payload.stream) {
          response.writeHead(200, { 'Content-Type': 'application/json' })
          response.end(JSON.stringify({ content: [{ type: 'text', text: 'OK' }] }))
          return
        }
        response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8' })
        response.write('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"村雨"}}\n\n')
        response.end('data: {"type":"message_stop"}\n\n')
        return
      }
      response.writeHead(404, { 'Content-Type': 'application/json' })
      response.end('{"error":"not found"}')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('测试服务启动失败')
  baseUrl = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
})

describe('ModelApiClient', () => {
  it('streams an OpenAI-compatible response and reports deltas', async () => {
    const client = new ModelApiClient()
    const deltas: string[] = []
    const result = await client.stream(
      profile({ endpoint: `${baseUrl}/v1` }),
      [{ role: 'user', content: '你好' }],
      (delta) => deltas.push(delta)
    )
    expect(result).toBe('你好')
    expect(deltas).toEqual(['你', '好'])
  })

  it('tests an OpenAI-compatible connection without streaming', async () => {
    const client = new ModelApiClient()
    const outcome = await client.test(profile({ endpoint: `${baseUrl}/v1` }))
    expect(outcome.preview).toBe('OK')
    expect(outcome.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it('adds the /v1 path when only a host URL is supplied', async () => {
    const client = new ModelApiClient()
    const outcome = await client.test(profile({ endpoint: baseUrl }))
    expect(outcome.preview).toBe('OK')
  })

  it('reports an invalid API key without exposing the key', async () => {
    const client = new ModelApiClient()
    await expect(client.test(profile({ endpoint: `${baseUrl}/v1`, apiKey: 'wrong-key' })))
      .rejects.toThrow(/API Key 无效/)
  })

  it('streams an Anthropic Messages response', async () => {
    const client = new ModelApiClient()
    const deltas: string[] = []
    const result = await client.stream(
      profile({
        provider: 'Anthropic',
        endpoint: `${baseUrl}/v1`,
        apiKey: 'anthropic-key',
        model: 'claude-test'
      }),
      [{ role: 'user', content: '你好' }],
      (delta) => deltas.push(delta)
    )
    expect(result).toBe('村雨')
    expect(deltas).toEqual(['村雨'])
  })
})
