import type { ChatTurn, ProviderAdapter, ProviderRequest, ResolvedModel, ToolDeclaration } from '../types'
import { assertImagePlacement } from '../transport'

function openAiContent(message: ChatTurn): string | Array<Record<string, unknown>> {
  if (!message.images?.length) return message.content
  return [
    ...(message.content ? [{ type: 'text', text: message.content }] : []),
    ...message.images.map((image) => ({
      type: 'image_url',
      image_url: { url: `data:${image.mime};base64,${image.base64}` }
    }))
  ]
}

export function openAiCompatibleUrl(endpoint: string): string {
  let base = endpoint.trim().replace(/\/+$/, '')
  if (base.endsWith('/chat/completions')) return base
  try {
    const parsed = new URL(base)
    if (!parsed.pathname || parsed.pathname === '/') base = `${parsed.origin}/v1`
  } catch {
    // 地址格式已在 IPC 边界校验。这里保留原样，让后续请求返回可分类的失败。
  }
  return `${base}/chat/completions`
}

export const openAiCompatibleAdapter: ProviderAdapter = {
  id: 'openai-compatible',
  matches: () => true,
  constraints: {
    imagesInUserMessageOnly: true,
    systemMessageStyle: 'in-messages',
    toolCallingStyle: 'openai-tools',
    requiresApiKey: true
  },
  buildChat(model, messages, stream, tools): ProviderRequest {
    assertImagePlacement(messages, true)
    return {
      url: openAiCompatibleUrl(model.endpoint),
      headers: {
        'Content-Type': 'application/json',
        Accept: stream ? 'text/event-stream' : 'application/json',
        ...(model.apiKey ? { Authorization: `Bearer ${model.apiKey}` } : {})
      },
      body: JSON.stringify({
        model: model.model,
        messages: messages.map((message) => ({ role: message.role, content: openAiContent(message) })),
        temperature: 0.7,
        ...(tools?.length
          ? { tools: tools.map((tool) => ({ type: 'function', function: tool })), tool_choice: 'auto' }
          : {}),
        ...(stream ? { stream: true } : {})
      })
    }
  }
}

export function withSystem(messages: ChatTurn[], system: string | undefined, _style: 'in-messages' | 'separate-field'): ChatTurn[] {
  const rest = messages.filter((message) => message.role !== 'system')
  if (!system) return rest
  return [{ role: 'system', content: system }, ...rest]
}

export type { ResolvedModel, ToolDeclaration }
