import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelInput } from '../../src/shared/types'
import { ModelRegistry, type ResolvedModel } from '../../src/main/model/registry'
import { ModelService } from '../../src/main/core/services/model-service'
import { ModelGateway } from '../../src/main/model/gateway'
import { openAiCompatibleAdapter } from '../../src/main/model/adapters/openai-compatible'
import { anthropicAdapter } from '../../src/main/model/adapters/anthropic'
import { ollamaAdapter } from '../../src/main/model/adapters/ollama'
import { createServer } from 'node:http'
import { ConversationService } from '../../src/main/core/services/conversation-service'
import { MemoryDatabase } from '../helpers/memory-db'

const storage = vi.hoisted(() => ({ models: [] as unknown[], failNextWrite: false, encryptionAvailable: true }))
vi.mock('electron-store', () => ({ default: class {
  get() { return structuredClone(storage.models) }
  set(_key: string, value: unknown[]) {
    if (storage.failNextWrite) { storage.failNextWrite = false; throw new Error('配置写入失败') }
    storage.models = structuredClone(value)
  }
} }))
vi.mock('electron', () => ({ safeStorage: {
  isEncryptionAvailable: () => storage.encryptionAvailable,
  encryptString: (value: string) => Buffer.from(`encrypted:${value}`),
  decryptString: (value: Buffer) => value.toString().replace(/^encrypted:/, '')
} }))
vi.mock('../../src/main/logger', () => ({ default: { error: vi.fn() } }))

const input = (overrides: Partial<ModelInput> = {}): ModelInput => ({
  name: '原有模型', provider: 'OpenAI Compatible', endpoint: 'https://old.example/v1',
  key: 'old-credential', model: 'original', caps: [], ...overrides
})
const json = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { headers: { 'content-type': 'application/json' } })
const stream = (data: string) => new Response(data, { headers: { 'content-type': 'text/event-stream' } })
function available(registry: ModelRegistry): ResolvedModel {
  const made = registry.create()
  registry.save(made.id, input())
  registry.markVerified(made.id, 12)
  registry.saveCapabilities(made.id, [{ id: 'text.chat', status: 'verified', detail: 'HTTP 200 + 非空内容', probedAt: new Date().toISOString() }])
  return registry.resolve(made.id)!
}
function probeResponse(init?: RequestInit): Response {
  const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: unknown }>; tools?: Array<{ function: { name: string } }> }
  const tool = body.tools?.[0].function.name
  if (tool) return new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { arguments: JSON.stringify(tool === 'get_color' ? { color: '蓝色' } : { action: 'ADD', category: 'user', text: '不吃辣' }) } }] } }] }), { headers: { 'content-type': 'application/json' } })
  return json(Array.isArray(body.messages[0]?.content) ? '蓝色' : 'OK')
}

beforeEach(() => { storage.models = []; storage.failNextWrite = false; storage.encryptionAvailable = true })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('[UC-08] 验证失败保留原有模型配置', () => {
  it('[FR-25] 新密钥认证失败后旧配置仍能完成对话', async () => {
    const registry = new ModelRegistry(); const old = available(registry)
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      const auth = new Headers(init.headers).get('authorization')
      return auth === 'Bearer old-credential' ? json('原服务仍可用') : new Response('拒绝新密钥', { status: 401 })
    })
    const result = await new ModelService(registry).verify(old.id, input({ endpoint: 'https://new.example/v1', key: 'invalid-new-key' }))
    expect(result.ok).toBe(false)
    expect(registry.resolve(old.id)).toEqual(old)
    await expect(new ModelGateway().chat(registry.getDefault()!, [{ role: 'user', content: '保留输入' }])).resolves.toBe('原服务仍可用')
  })

  it('[NFR-R02] 密钥加密失败不把旧配置误标为离线', async () => {
    const registry = new ModelRegistry(); const old = available(registry)
    storage.encryptionAvailable = false
    const result = await new ModelService(registry).verify(old.id, input({ key: 'new-key' }))
    expect(result.ok).toBe(false)
    expect(registry.resolve(old.id)).toEqual(old)
  })

  it('[NFR-R02] 探测成功但保存失败时原配置完整保留', async () => {
    const registry = new ModelRegistry(); const old = available(registry)
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      storage.failNextWrite = true
      return probeResponse(init)
    })
    const result = await new ModelService(registry).verify(old.id, input({ model: 'replacement', key: 'replacement-key' }))
    expect(result.ok).toBe(false)
    expect(registry.resolve(old.id)).toEqual(old)
  })

  it('[FR-25] 未验证配置不能替换已可用的当前服务', () => {
    const registry = new ModelRegistry(); const old = available(registry); const draft = registry.create()
    const result = new ModelService(registry).setDefault(draft.id)
    expect(result.ok).toBe(false)
    expect(registry.getDefault()).toEqual(old)
  })

  it('[FR-25] 复用超过14天的探测结果切换时明确提示重新验证', () => {
    const registry = new ModelRegistry(); const old = available(registry)
    registry.saveCapabilities(old.id, [{ id: 'text.chat', status: 'verified', detail: '历史探测', probedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString() }])
    const selected = new ModelService(registry).setDefault(old.id)
    expect(selected.ok).toBe(true)
    expect(registry.getDefault()?.probeNote).toContain('建议重新验证')
  })

  it('[UC-08] 探测期间仍使用旧配置且成功后一次性更新', async () => {
    const registry = new ModelRegistry(); const old = available(registry)
    let release!: (response: Response) => void
    let first = true
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      if (first) { first = false; return new Promise<Response>(done => { release = done }) }
      return probeResponse(init)
    })
    const pending = new ModelService(registry).verify(old.id, input({ model: 'replacement', key: 'replacement-key' }))
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    const during = registry.getDefault()
    release(json('OK'))
    const result = await pending
    expect(during).toEqual(old)
    expect(result.ok).toBe(true)
    expect(registry.getDefault()).toMatchObject({ model: 'replacement', apiKey: 'replacement-key', status: '在线' })
  })

  it('[NFR-R02] 较早发起的验证迟到时不能覆盖较新的保存', async () => {
    const registry = new ModelRegistry(); const old = available(registry)
    let release!: (response: Response) => void
    let first = true
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      if (first) { first = false; return new Promise<Response>(done => { release = done }) }
      return probeResponse(init)
    })
    const service = new ModelService(registry)
    const earlier = service.verify(old.id, input({ model: 'earlier-edit' }))
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    registry.save(old.id, input({ model: 'latest-edit' }))
    release(json('OK'))
    const result = await earlier
    expect(result.ok).toBe(false)
    expect(registry.resolve(old.id)).toMatchObject({ model: 'latest-edit', status: '未验证', capabilities: [] })
  })

  it('[FR-25] 切换服务后已发出的请求继续使用启动时快照', async () => {
    const registry = new ModelRegistry(); const original = available(registry)
    const other = registry.create(); registry.save(other.id, input({ model: 'other', key: 'other-key' }))
    registry.markVerified(other.id, 15)
    registry.saveCapabilities(other.id, [{ id: 'text.chat', status: 'verified', detail: '已测', probedAt: new Date().toISOString() }])
    let release!: (response: Response) => void
    let dispatchedModel = ''; let credential = ''
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      dispatchedModel = (JSON.parse(String(init.body)) as { model: string }).model
      credential = new Headers(init.headers).get('authorization') ?? ''
      return new Promise<Response>(done => { release = done })
    })
    const pending = new ModelGateway().chat(original, [{ role: 'user', content: '运行中的请求' }])
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    const selected = new ModelService(registry).setDefault(other.id)
    release(json('原模型完成请求'))
    await expect(pending).resolves.toBe('原模型完成请求')
    expect(dispatchedModel).toBe('original'); expect(credential).toBe('Bearer old-credential')
    expect(registry.getDefault()?.model).toBe('other')
    expect(JSON.stringify(selected)).not.toContain('other-key')
  })
})

describe('[IF-08] 模型传输边界', () => {
  it.each([openAiCompatibleAdapter, anthropicAdapter, ollamaAdapter])('[IF-08] $id 拒绝向远程 HTTP 发送凭据或对话', (adapter) => {
    const model = available(new ModelRegistry())
    for (const endpoint of ['http://remote.example/v1', 'http://localhost.attacker.example/v1', 'http://127.0.0.1.attacker.example/v1']) {
      expect(() => adapter.buildChat({ ...model, endpoint }, [{ role: 'user', content: '私有对话' }], true)).toThrow(/HTTPS/)
    }
  })

  it('[IF-08] 保留本机 Ollama HTTP 并拒绝地址内嵌的凭据', () => {
    const model = available(new ModelRegistry())
    expect(ollamaAdapter.buildChat({ ...model, endpoint: 'http://127.0.0.1:11434', apiKey: '' }, [{ role: 'user', content: '本机对话' }], true).url).toBe('http://127.0.0.1:11434/v1/chat/completions')
    expect(() => openAiCompatibleAdapter.buildChat({ ...model, endpoint: 'https://name:secret@remote.example/v1' }, [], false)).toThrow(/凭据/)
  })

  it('[NFR-S01] 服务商错误不得回显任意格式的真实密钥', async () => {
    const model = available(new ModelRegistry()); model.apiKey = 'private.provider-key/with+characters'
    vi.stubGlobal('fetch', async () => new Response(`request rejected: ${model.apiKey}`, { status: 500 }))
    const error = await new ModelGateway().chat(model, [{ role: 'user', content: '你好' }]).catch(error => error as Error)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain('500')
    expect((error as Error).message).not.toContain(model.apiKey)
  })

  it('[NFR-R01] HTTP 200 空内容不能通过连接验证', async () => {
    const model = available(new ModelRegistry())
    vi.stubGlobal('fetch', async () => json('  '))
    await expect(new ModelGateway().testConnection(model)).rejects.toThrow(/空内容/)
  })

  it('[IF-09] 服务重定向不得把对话与凭据自动发给另一个地址', async () => {
    let redirected = 0
    const server = createServer((request, response) => {
      if (request.url === '/forwarded') { redirected += 1; response.setHeader('content-type', 'application/json'); response.end('{"choices":[{"message":{"content":"unexpected"}}]}') }
      else { response.writeHead(307, { Location: '/forwarded' }); response.end() }
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('测试服务未启动')
    try {
      const model = { ...available(new ModelRegistry()), endpoint: `http://127.0.0.1:${address.port}` }
      const result = await new ModelGateway().chat(model, [{ role: 'user', content: '仅授权给配置地址' }]).catch(error => error as Error)
      expect(result).toBeInstanceOf(Error)
      expect(redirected).toBe(0)
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
  })

  it('[NFR-R01] SSE 错误帧不能把此前的半句当成成功回复', async () => {
    const model = available(new ModelRegistry())
    vi.stubGlobal('fetch', async () => stream('data: {"choices":[{"delta":{"content":"半句"}}]}\n\ndata: {"type":"error","error":{"message":"upstream unavailable"}}\n\n'))
    await expect(new ModelGateway().chat(model, [{ role: 'user', content: '保留用户草稿' }])).rejects.toThrow(/响应流|失败/)
  })

  it('[NFR-R01] SSE 未收到结束帧便关闭时不能返回部分回复', async () => {
    const model = available(new ModelRegistry())
    vi.stubGlobal('fetch', async () => stream('data: {"choices":[{"delta":{"content":"尚未说完"}}]}\n\n'))
    await expect(new ModelGateway().chat(model, [{ role: 'user', content: '保留用户草稿' }])).rejects.toThrow(/响应流|中断/)
  })

  it('[IF-05] 正常 stop 结束帧可确认完整回复', async () => {
    const model = available(new ModelRegistry())
    vi.stubGlobal('fetch', async () => stream('data: {"choices":[{"delta":{"content":"完整回复"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n'))
    await expect(new ModelGateway().chat(model, [{ role: 'user', content: '正常请求' }])).resolves.toBe('完整回复')
  })

  it.each(['length', 'content_filter'])('[NFR-R01] %s 截断结束帧即使附带DONE也不能认作完整回复', async reason => {
    const model = available(new ModelRegistry())
    vi.stubGlobal('fetch', async () => stream(`data: {"choices":[{"delta":{"content":"PRIVATE_PARTIAL_CONTENT"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"${reason}"}]}\n\ndata: [DONE]\n\n`))
    const result = await new ModelGateway().chat(model, [{ role: 'user', content: '保留用户草稿' }]).catch(error => error as Error)
    expect(result).toBeInstanceOf(Error)
    expect((result as Error).message).toMatch(/未完成|不完整|截断/)
    expect((result as Error).message).not.toContain('PRIVATE_PARTIAL_CONTENT')
    expect((result as Error).message).not.toContain(model.apiKey)
  })

  it('[NFR-R01] Anthropic 达到token上限不能由message_stop掩盖截断状态', async () => {
    const model = { ...available(new ModelRegistry()), provider: 'Anthropic' }
    vi.stubGlobal('fetch', async () => stream('data: {"type":"content_block_delta","delta":{"text":"未写完的半句"}}\n\ndata: {"type":"message_delta","delta":{"stop_reason":"max_tokens"}}\n\ndata: {"type":"message_stop"}\n\n'))
    await expect(new ModelGateway().chat(model, [{ role: 'user', content: '保留用户草稿' }])).rejects.toThrow(/未完成|不完整|截断/)
  })

  it.each(['empty', 'broken', 'error'])('[UC-01] %s 响应向会话返回失败且不保存伪造的完整回复', async (mode) => {
    const registry = new ModelRegistry(); available(registry)
    const service = new ConversationService(new MemoryDatabase(), registry, new ModelGateway())
    const conversation = service.create()
    vi.stubGlobal('fetch', async () => mode === 'empty' ? json('') : stream('data: {"choices":[{"delta":{"content":"半句"}}]}\n\n' + (mode === 'error' ? 'data: {"error":{"message":"连接失败"}}\n\n' : '')))
    const result = await service.send(conversation.id, '请保留我输入的原文')
    expect(result.ok).toBe(false)
    expect(service.list()[0].messages).toEqual(conversation.messages)
    vi.stubGlobal('fetch', async () => json('重试后完整回复'))
    const retried = await service.send(conversation.id, '请保留我输入的原文')
    expect(retried.ok).toBe(true)
    expect(service.list()[0].messages.slice(-2).map(item => item.text)).toEqual(['请保留我输入的原文', '重试后完整回复'])
  })
})
