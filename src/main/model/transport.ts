import type { ChatTurn } from './types'

export function redactProviderText(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-••••')
    .replace(/sk-ant-[A-Za-z0-9_-]{8,}/g, 'sk-ant-••••')
    .replace(/(api[-_ ]?key\s*[:=]\s*)\S+/gi, '$1••••')
    .slice(0, 500)
}

export function classifyProviderFailure(status: number, body: string): Error {
  const detail = redactProviderText(body.trim())
  if (status === 400 && /does not support image/i.test(detail)) {
    return new Error('该模型不支持图像输入。请更换支持图像的模型，或改用文字描述。')
  }
  if (status === 401 || status === 403) return new Error('API Key 无效、已过期或没有访问该模型的权限（HTTP 401/403）')
  if (status === 404 && /model/i.test(detail)) return new Error('模型名称不存在（HTTP 404），请检查模型 ID')
  if (status === 404) return new Error('接口地址或模型名称不存在（HTTP 404），请检查服务地址和模型 ID')
  if (status === 429) return new Error('请求过于频繁或额度不足（HTTP 429），请稍后重试')
  return new Error(detail ? `模型服务返回 HTTP ${status}：${detail}` : `模型服务返回 HTTP ${status}`)
}

export function extractText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return ''
  const value = payload as Record<string, unknown>
  const choices = Array.isArray(value.choices) ? value.choices : []
  const first = choices[0] as Record<string, unknown> | undefined
  if (first) {
    const message = first.message as Record<string, unknown> | undefined
    const toolCalls = message?.tool_calls
    if (Array.isArray(toolCalls) && toolCalls[0] && typeof toolCalls[0] === 'object') {
      const call = toolCalls[0] as Record<string, unknown>
      const fn = call.function as Record<string, unknown> | undefined
      if (typeof fn?.arguments === 'string') return fn.arguments
    }
    const delta = first.delta as Record<string, unknown> | undefined
    if (typeof delta?.content === 'string') return delta.content
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
        if (block.type === 'tool_use' && block.input && typeof block.input === 'object') return JSON.stringify(block.input)
        return block.type === 'text' && typeof block.text === 'string' ? block.text : ''
      })
      .join('')
  }
  return ''
}

export async function readEventStream(response: Response, onDelta: (delta: string) => void): Promise<string> {
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
      const text = extractText(JSON.parse(data) as unknown)
      if (text) {
        result += text
        onDelta(text)
      }
    } catch {
      // 忽略服务商的保活帧。
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

export function assertImagePlacement(messages: ChatTurn[], imagesInUserMessageOnly: boolean): void {
  if (!imagesInUserMessageOnly) return
  if (messages.some((message) => message.role !== 'user' && (message.images?.length ?? 0) > 0)) {
    throw new Error('当前协议只允许把图片放在用户消息中。请不要把截图放进系统提示。')
  }
}
