import type { ModelProfile } from '../../shared/types'

export interface ChatTurn {
  role: 'system' | 'user' | 'assistant'
  content: string
  images?: ChatImage[]
}

export interface ChatImage {
  mime: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
  base64: string
}

export interface ToolDeclaration {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface ProviderConstraints {
  imagesInUserMessageOnly: boolean
  systemMessageStyle: 'in-messages' | 'separate-field'
  maxImagesPerRequest?: number
  maxImageBytes?: number
  toolCallingStyle: 'openai-tools' | 'anthropic-tools' | 'none'
  requiresApiKey: boolean
}

export interface ProviderRequest {
  url: string
  headers: Record<string, string>
  body: string
}

export interface ResolvedModel extends ModelProfile {
  apiKey: string
}

export interface ProviderAdapter {
  id: string
  matches(provider: string): boolean
  constraints: ProviderConstraints
  buildChat(
    model: ResolvedModel,
    messages: ChatTurn[],
    stream: boolean,
    tools?: ToolDeclaration[]
  ): ProviderRequest
}
