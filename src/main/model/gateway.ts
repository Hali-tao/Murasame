import type { ZodType } from 'zod'
import { anthropicAdapter } from './adapters/anthropic'
import { ollamaAdapter } from './adapters/ollama'
import { openAiCompatibleAdapter, withSystem } from './adapters/openai-compatible'
import { classifyProviderFailure, extractText, readEventStream } from './transport'
import { RequestQueue } from '../agent/runtime'
import type { ChatImage, ChatTurn, ProviderAdapter, ResolvedModel, ToolDeclaration } from './types'
import { toolDeclarationFromSchema } from './contracts'

const adapters: ProviderAdapter[] = [anthropicAdapter, ollamaAdapter, openAiCompatibleAdapter]

/** 对话单独排队，任务和屏幕分析走另一条队列，避免长任务堵住聊天。 */
const chatQueue = new RequestQueue()
const workQueue = new RequestQueue()

export interface RequestControl {
  signal?: AbortSignal
  beforeSend?: () => void
  onDispatch?: (waitMs: number) => void
}

export function waitingRequests(): number {
  return chatQueue.waitingCount + workQueue.waitingCount
}

export function adapterFor(provider: string): ProviderAdapter {
  return adapters.find((adapter) => adapter !== openAiCompatibleAdapter && adapter.matches(provider)) ?? openAiCompatibleAdapter
}

async function execute(
  model: ResolvedModel,
  messages: ChatTurn[],
  stream: boolean,
  onDelta: (delta: string) => void,
  tools?: ToolDeclaration[],
  timeoutMs = 120_000,
  lane: 'chat' | 'work' = 'work',
  control: RequestControl = {}
): Promise<string> {
  if (!model.model.trim()) throw new Error('尚未填写模型名称')
  if (!model.endpoint.trim()) throw new Error('尚未填写服务地址')
  const adapter = adapterFor(model.provider)
  if (adapter.constraints.requiresApiKey && !model.apiKey) throw new Error('尚未配置 API Key')
  const request = adapter.buildChat(model, messages, stream, tools)
  const queue = lane === 'chat' ? chatQueue : workQueue
  const queuedAt = Date.now()
  return queue.enqueue(async () => {
    control.signal?.throwIfAborted()
    control.beforeSend?.()
    control.onDispatch?.(Date.now() - queuedAt)
    const controller = new AbortController()
    const cancel = (): void => controller.abort(control.signal?.reason)
    control.signal?.addEventListener('abort', cancel, { once: true })
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(request.url, {
        method: 'POST',
        headers: request.headers,
        body: request.body,
        signal: controller.signal
      })
      if (!response.ok) throw classifyProviderFailure(response.status, await response.text())
      const contentType = response.headers.get('content-type') ?? ''
      const text = contentType.includes('application/json')
        ? extractText(await response.json())
        : await readEventStream(response, onDelta)
      return text
    } catch (error) {
      if (control.signal?.aborted) throw new Error('请求已停止，没有继续发送内容', { cause: error })
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`模型请求超时（${Math.round(timeoutMs / 1000)} 秒），请检查网络或服务地址`, { cause: error })
      }
      throw error
    } finally {
      clearTimeout(timeout)
      control.signal?.removeEventListener('abort', cancel)
    }
  })
}

function prepare(model: ResolvedModel, messages: ChatTurn[], system?: string): ChatTurn[] {
  return withSystem(messages, system, adapterFor(model.provider).constraints.systemMessageStyle)
}

export class ModelGateway {
  async chat(
    model: ResolvedModel,
    messages: ChatTurn[],
    onDelta?: (delta: string) => void,
    system?: string,
    control: RequestControl = {}
  ): Promise<string> {
    const text = await execute(model, prepare(model, messages, system), true, onDelta ?? (() => undefined), undefined, 120_000, 'chat', control)
    if (!text.trim()) throw new Error('模型返回了空内容，请检查模型名称或服务兼容性')
    return text
  }

  async chatWithImages(
    model: ResolvedModel,
    text: string,
    images: ChatImage[],
    onDelta?: (delta: string) => void,
    system?: string,
    control: RequestControl = {}
  ): Promise<string> {
    const result = await execute(model, prepare(model, [{ role: 'user', content: text, images }], system), true, onDelta ?? (() => undefined), undefined, 120_000, 'work', control)
    if (!result.trim()) throw new Error('模型返回了空内容，请检查模型名称或服务兼容性')
    return result
  }

  async callTools(
    model: ResolvedModel,
    messages: ChatTurn[],
    tools: ToolDeclaration[],
    system?: string,
    control: RequestControl = {}
  ): Promise<unknown> {
    const adapter = adapterFor(model.provider)
    if (adapter.constraints.toolCallingStyle === 'none') {
      throw new Error('当前模型协议不支持工具调用。请更换支持工具调用的模型。')
    }
    const raw = await execute(model, prepare(model, messages, system), false, () => undefined, tools, 120_000, 'work', control)
    try {
      return JSON.parse(raw) as unknown
    } catch (error) {
      throw new Error('模型没有返回可解析的工具参数', { cause: error })
    }
  }

  async callStructured<T>(
    model: ResolvedModel,
    schema: ZodType<T>,
    toolName: string,
    description: string,
    messages: ChatTurn[],
    system?: string,
    control: RequestControl = {}
  ): Promise<T> {
    const tool = toolDeclarationFromSchema(toolName, description, schema)
    let lastError = '模型输出不符合约定结构'
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        control.signal?.throwIfAborted()
        const value = await this.callTools(model, messages, [tool], system, control)
        const parsed = schema.safeParse(value)
        if (parsed.success) return parsed.data
        lastError = '模型输出不符合约定结构'
      } catch (error) {
        if (control.signal?.aborted) throw error
        lastError = error instanceof Error ? error.message : lastError
      }
    }
    throw new Error(`${lastError}。已重试 2 次，未使用不完整结果。`)
  }

  async testConnection(model: ResolvedModel): Promise<{ latencyMs: number; preview: string }> {
    const startedAt = Date.now()
    const preview = await execute(model, [{ role: 'user', content: '请只回复 OK' }], false, () => undefined, undefined, 30_000)
    return { latencyMs: Date.now() - startedAt, preview: preview.slice(0, 80) }
  }
}
