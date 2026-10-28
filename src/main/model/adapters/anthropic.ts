import type { ChatTurn, ProviderAdapter, ProviderRequest } from '../types'
import { assertImagePlacement, assertProtectedEndpoint } from '../transport'

function anthropicUrl(endpoint: string): string {
  const base = endpoint.trim().replace(/\/+$/, '')
  if (base.endsWith('/messages')) return base
  if (base.endsWith('/v1')) return `${base}/messages`
  return `${base}/v1/messages`
}

function blocks(message: ChatTurn): Array<Record<string, unknown>> {
  return [
    ...(message.content ? [{ type: 'text', text: message.content }] : []),
    ...(message.images ?? []).map((image) => ({
      type: 'image',
      source: { type: 'base64', media_type: image.mime, data: image.base64 }
    }))
  ]
}

function normalize(messages: ChatTurn[]): ChatTurn[] {
  const result: ChatTurn[] = []
  for (const message of messages) {
    if (message.role === 'system') continue
    const current = result.at(-1)
    if (!current && message.role === 'assistant') continue
    if (current?.role === message.role) {
      current.content += `\n\n${message.content}`
      current.images = [...(current.images ?? []), ...(message.images ?? [])]
    } else result.push({ ...message, images: message.images ? [...message.images] : undefined })
  }
  return result
}

export const anthropicAdapter: ProviderAdapter = {
  id: 'anthropic',
  matches: (provider) => {
    const value = provider.toLowerCase()
    return value.includes('anthropic') || value.includes('claude')
  },
  constraints: {
    imagesInUserMessageOnly: true,
    systemMessageStyle: 'separate-field',
    toolCallingStyle: 'anthropic-tools',
    requiresApiKey: true
  },
  buildChat(model, messages, stream, tools): ProviderRequest {
    assertProtectedEndpoint(model.endpoint)
    assertImagePlacement(messages, true)
    const system = messages.find((message) => message.role === 'system')?.content
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
        max_tokens: stream ? 4096 : 1024,
        temperature: 0.7,
        ...(system ? { system } : {}),
        messages: normalize(messages).map((message) => ({ role: message.role, content: blocks(message) })),
        ...(tools?.length
          ? { tools: tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.parameters })) }
          : {}),
        stream
      })
    }
  }
}
