import type { ResolvedModel } from './model-repository'

export interface ChatTurn {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface VerifyOutcome {
  latencyMs: number
  preview: string
}

type ProviderKind = 'openai' | 'anthropic' | 'ollama'

const SYSTEM_PROMPT = [
  '你是 Murasame（村雨），一个运行在用户 Windows 桌面上的 AI 伙伴。',
  '使用简体中文回答，语气简洁、可靠、温和。',
  '先给结论，再给必要步骤；不要编造已经执行过的文件操作、工具调用或屏幕内容。',
  '你没有实际执行文件写入、终端命令或外部应用操作的能力，涉及这些操作时应明确说明需要用户另行批准。'
].join('\n')

function providerKind(provider: string): ProviderKind {
  const value = provider.toLowerCase()
  if (value.includes('anthropic') || value.includes('claude')) return 'anthropic'
  if (value.includes('ollama')) return 'ollama'
  return 'openai'
}

function openAiUrl(endpoint: string, kind: ProviderKind): string {
  let base = endpoint.trim().replace(/\/+$/, '')
  if (base.endsWith('/chat/completions')) return base
  // Accept both a host-only base URL and an explicit /v1 base URL. Many users
  // naturally paste https://api.openai.com, while compatible gateways often
  // already include a path such as /v1.
  if (kind === 'ollama' && base.endsWith('/api')) base = base.slice(0, -4)
  try {
    const parsed = new URL(base)
    if (!parsed.pathname || parsed.pathname === '/') base = `${parsed.origin}/v1`
  } catch {
    // URL validation already happens at the IPC boundary. Keep this fallback
    // permissive so custom/local gateways can still produce a useful error.
  }
  return `${base}/chat/completions`
}

function anthropicUrl(endpoint: string): string {
  const base = endpoint.trim().replace(/\/+$/, '')
  if (base.endsWith('/messages')) return base
  if (base.endsWith('/v1')) return `${base}/messages`
  return `${base}/v1/messages`
}

function redactProviderText(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-••••')
    .replace(/sk-ant-[A-Za-z0-9_-]{8,}/g, 'sk-ant-••••')
    .replace(/(api[-_ ]?key\s*[:=]\s*)\S+/gi, '$1••••')
    .slice(0, 500)
}

async function providerError(response: Response): Promise<Error> {
  let body: string
  try {
    body = await response.text()
  } catch {
    body = ''
  }
  if (response.status === 401 || response.status === 403) {
    return new Error('API Key 无效、已过期或没有访问该模型的权限（HTTP 401/403）')
  }
  if (response.status === 404) {
    return new Error('接口地址或模型名称不存在（HTTP 404），请检查服务地址和模型 ID')
  }
  if (response.status === 429) {
    return new Error('请求过于频繁或额度不足（HTTP 429），请稍后重试')
  }
  const detail = redactProviderText(body.trim())
  return new Error(detail ? `模型服务返回 HTTP ${response.status}：${detail}` : `模型服务返回 HTTP ${response.status}`)
}

function normalizeAnthropicMessages(messages: ChatTurn[]): ChatTurn[] {
  const result: ChatTurn[] = []
  for (const message of messages) {
    if (message.role === 'system') continue
    const current = result.at(-1)
    if (!current && message.role === 'assistant') continue
    if (current?.role === message.role) current.content += `\n\n${message.content}`
    else result.push({ ...message })
  }
  return result
}

function extractText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return ''
  const value = payload as Record<string, unknown>
  const choices = Array.isArray(value.choices) ? value.choices : []
  const first = choices[0] as Record<string, unknown> | undefined
  if (first) {
    const delta = first.delta as Record<string, unknown> | undefined
    if (typeof delta?.content === 'string') return delta.content
    const message = first.message as Record<string, unknown> | undefined
    if (typeof message?.content === 'string') return message.content
  }
  if (value.type === 'content_block_delta') {
    const delta = value.delta as Record<string, unknown> | undefined
    if (typeof delta?.text === 'string') return delta.text
  }
  if (Array.isArray(value.content)) {
    return value.content
      .map((item) => {
        if (!item || typeof item !== 'object') return ''
        const block = item as Record<string, unknown>
        return block.type === 'text' && typeof block.text === 'string' ? block.text : ''
      })
      .join('')
  }
  return ''
}

async function readEventStream(response: Response, onDelta: (delta: string) => void): Promise<string> {
  if (!response.body) throw new Error('模型服务没有返回可读取的响应流')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let result = ''

  const consumeLine = (line: string): void => {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) return
    const data = trimmed.slice(5).trim()
    if (!data || data === '[DONE]') return
    try {
      const payload: unknown = JSON.parse(data)
      const text = extractText(payload)
      if (text) {
        result += text
        onDelta(text)
      }
    } catch {
      // Ignore provider keep-alive events that are not JSON.
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    lines.forEach(consumeLine)
  }
  buffer += decoder.decode()
  if (buffer) consumeLine(buffer)
  return result
}

async function readJsonResponse(response: Response): Promise<string> {
  const payload: unknown = await response.json()
  return extractText(payload)
}

function buildRequest(
  model: ResolvedModel,
  messages: ChatTurn[],
  stream: boolean
): { url: string; headers: Record<string, string>; body: string } {
  const kind = providerKind(model.provider)
  if (kind === 'anthropic') {
    return {
      url: anthropicUrl(model.endpoint),
      headers: {
        'Content-Type': 'application/json',
        Accept: stream ? 'text/event-stream' : 'application/json',
        'x-api-key': model.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: model.model,
        max_tokens: stream ? 4096 : 16,
        temperature: 0.7,
        system: SYSTEM_PROMPT,
        messages: normalizeAnthropicMessages(messages),
        stream
      })
    }
  }
  return {
    url: openAiUrl(model.endpoint, kind),
    headers: {
      'Content-Type': 'application/json',
      Accept: stream ? 'text/event-stream' : 'application/json',
      ...(model.apiKey ? { Authorization: `Bearer ${model.apiKey}` } : {})
    },
    body: JSON.stringify({
      model: model.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...messages.filter((message) => message.role !== 'system')
      ],
      temperature: 0.7,
      ...(stream ? { stream: true } : {})
    })
  }
}

export class ModelApiClient {
  async stream(
    model: ResolvedModel,
    messages: ChatTurn[],
    onDelta: (delta: string) => void
  ): Promise<string> {
    if (!model.model.trim()) throw new Error('尚未填写模型名称')
    if (!model.endpoint.trim()) throw new Error('尚未填写服务地址')
    const kind = providerKind(model.provider)
    if (kind !== 'ollama' && !model.apiKey) throw new Error('尚未配置 API Key')

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 120_000)
    try {
      const request = buildRequest(model, messages, true)
      const response = await fetch(request.url, {
        method: 'POST',
        headers: request.headers,
        body: request.body,
        signal: controller.signal
      })
      if (!response.ok) throw await providerError(response)
      const contentType = response.headers.get('content-type') ?? ''
      const text = contentType.includes('application/json')
        ? await readJsonResponse(response)
        : await readEventStream(response, onDelta)
      if (!text.trim()) throw new Error('模型返回了空内容，请检查模型名称或服务兼容性')
      return text
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('模型请求超时（120 秒），请检查网络或服务地址', { cause: error })
      }
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }

  async test(model: ResolvedModel): Promise<VerifyOutcome> {
    if (!model.model.trim()) throw new Error('尚未填写模型名称')
    if (!model.endpoint.trim()) throw new Error('尚未填写服务地址')
    const kind = providerKind(model.provider)
    if (kind !== 'ollama' && !model.apiKey) throw new Error('尚未配置 API Key')

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30_000)
    const startedAt = Date.now()
    try {
      const request = buildRequest(model, [{ role: 'user', content: '请只回复 OK' }], false)
      const response = await fetch(request.url, {
        method: 'POST',
        headers: request.headers,
        body: request.body,
        signal: controller.signal
      })
      if (!response.ok) throw await providerError(response)
      const preview = contentTypeIsJson(response)
        ? await readJsonResponse(response)
        : await readEventStream(response, () => undefined)
      return { latencyMs: Date.now() - startedAt, preview: preview.slice(0, 80) }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('连接测试超时（30 秒），请检查服务地址与网络', { cause: error })
      }
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }
}

function contentTypeIsJson(response: Response): boolean {
  return (response.headers.get('content-type') ?? '').includes('application/json')
}
