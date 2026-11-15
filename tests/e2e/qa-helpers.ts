import { createServer, type ServerResponse } from 'node:http'
import { listenHttp } from '../helpers/http-server'

/**
 * QA 压力用例专用的可控模型服务。
 *
 * 与 helpers.startModelServer 的区别只有一处：真实聊天请求的流式响应不会立即写完，
 * 而是先挂起，由用例决定何时推送下一段 delta / 何时结束 / 何时失败。
 * 模型探测（验证连接、能力探测）仍按协议完整返回，因此 configureTestModel 走的
 * 是真实 IPC、真实 preload、真实网关与适配器，没有 mock 成功结果。
 */
export const QA_MODEL_KEY = 'test-key'
export const QA_MODEL_NAME = 'test-model'

export interface ModelRequestRecord {
  text: string
  stream: boolean
  tools: string[]
  at: number
}

export interface ControlledModelServer {
  url: string
  requests: ModelRequestRecord[]
  held: Map<string, ServerResponse>
  /** 等某个真实聊天请求挂到服务端（说明请求真的发出来了）。 */
  waitHeld(marker: string, timeoutMs?: number): Promise<void>
  requestsFor(marker: string): ModelRequestRecord[]
  /** 只统计真正的聊天流式请求（排除记忆提取等非流式后处理请求）。 */
  chatRequests(marker: string): ModelRequestRecord[]
  /** 在流未结束时推送一段内容。 */
  writeChunk(marker: string, chunk: string): void
  /** 推送剩余内容并结束这轮流式响应。 */
  finishStream(marker: string, chunks?: string[], gapMs?: number): Promise<void>
  /** 以 HTTP 错误结束这轮流式响应。 */
  failStream(marker: string, status?: number): void
  close(): Promise<void>
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function messageText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === 'string') return part
      if (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string') return (part as { text: string }).text
      return ''
    }).join('\n')
  }
  return ''
}

function sseHead(response: ServerResponse): void {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  })
}

function sseChunk(response: ServerResponse, text: string): void {
  if (response.writableEnded) return
  response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`)
}

function sseDone(response: ServerResponse): void {
  if (response.writableEnded) return
  response.write('data: [DONE]\n\n')
  response.end()
}

function jsonContent(response: ServerResponse, content: string): void {
  if (response.writableEnded) return
  response.writeHead(200, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify({ id: 'qa-completion', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }] }))
}

function jsonToolCall(response: ServerResponse, name: string, args: unknown): void {
  if (response.writableEnded) return
  response.writeHead(200, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', tool_calls: [{ type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] }))
}

export async function startControlledModelServer(): Promise<ControlledModelServer> {
  const requests: ModelRequestRecord[] = []
  const held = new Map<string, ServerResponse>()

  const server = createServer((request, response) => {
    if (request.method !== 'POST' || !request.url?.endsWith('/chat/completions')) {
      response.writeHead(404, { 'Content-Type': 'application/json' })
      response.end('{"error":"not found"}')
      return
    }
    if (request.headers.authorization !== `Bearer ${QA_MODEL_KEY}`) {
      response.writeHead(401, { 'Content-Type': 'application/json' })
      response.end('{"error":"invalid key"}')
      return
    }
    let raw = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => { raw += chunk })
    request.on('end', () => {
      let payload: { stream?: boolean; model?: string; messages?: Array<{ role: string; content: unknown }>; tools?: Array<{ function?: { name?: string } }> }
      try {
        payload = JSON.parse(raw) as typeof payload
      } catch {
        response.writeHead(400, { 'Content-Type': 'application/json' })
        response.end('{"error":"bad json"}')
        return
      }
      if (payload.model !== QA_MODEL_NAME) {
        response.writeHead(404, { 'Content-Type': 'application/json' })
        response.end('{"error":"unknown model"}')
        return
      }
      const messages = payload.messages ?? []
      const lastUser = [...messages].reverse().find((item) => item.role === 'user')
      const text = messageText(lastUser?.content)
      const tools = (payload.tools ?? []).map((item) => item.function?.name ?? '').filter(Boolean)
      const stream = Boolean(payload.stream)
      requests.push({ text, stream, tools, at: Date.now() })

      if (stream) {
        // 模型能力探测与验证请求必须立即完成，否则配置页会一直等待。
        if (text.includes('这张图主要是什么颜色')) { sseHead(response); sseChunk(response, '蓝色'); sseDone(response); return }
        if (text.includes('请只回复 OK')) { sseHead(response); sseChunk(response, 'OK'); sseDone(response); return }
        // 真实聊天：先挂住，由用例控制流式节奏。
        sseHead(response)
        held.set(text, response)
        return
      }

      if (tools.includes('get_color')) { jsonToolCall(response, 'get_color', { color: '蓝色' }); return }
      if (tools.includes('remember') || tools.includes('emit_memory') || tools.includes('save_memory')) {
        jsonToolCall(response, tools[0], { memories: [] })
        return
      }
      jsonContent(response, 'OK')
    })
  })

  await listenHttp(server)
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('QA 模型服务启动失败')

  const waitHeld = async (marker: string, timeoutMs = 20_000): Promise<void> => {
    const startedAt = Date.now()
    while (!held.has(marker)) {
      if (Date.now() - startedAt > timeoutMs) throw new Error(`等待模型流式请求「${marker}」超时，已收到的请求：${JSON.stringify(requests.map((item) => item.text.slice(0, 40)))}`)
      await delay(50)
    }
  }

  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    requests,
    held,
    waitHeld,
    requestsFor: (marker) => requests.filter((item) => item.text.includes(marker)),
    chatRequests: (marker) => requests.filter((item) => item.stream && item.text.trim() === marker),
    writeChunk(marker, chunk) {
      const response = held.get(marker)
      if (!response) throw new Error(`没有挂起的流式请求「${marker}」`)
      sseChunk(response, chunk)
    },
    async finishStream(marker, chunks = ['这是来自', '测试模型的', '真实流式回复。'], gapMs = 60) {
      const response = held.get(marker)
      if (!response) throw new Error(`没有挂起的流式请求「${marker}」`)
      held.delete(marker)
      for (const chunk of chunks) { sseChunk(response, chunk); await delay(gapMs) }
      sseDone(response)
    },
    failStream(marker, status = 503) {
      const response = held.get(marker)
      if (!response) throw new Error(`没有挂起的流式请求「${marker}」`)
      held.delete(marker)
      if (!response.writableEnded) {
        response.writeHead(status, { 'Content-Type': 'text/plain' })
        response.end('QA controlled stream failure')
      }
    },
    close: () => new Promise<void>((resolve, reject) => {
      for (const response of held.values()) if (!response.writableEnded) response.destroy()
      held.clear()
      server.closeAllConnections()
      server.close((error) => error ? reject(error) : resolve())
    })
  }
}
