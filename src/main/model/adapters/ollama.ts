import { openAiCompatibleAdapter } from './openai-compatible'
import type { ProviderAdapter } from '../types'

export const ollamaAdapter: ProviderAdapter = {
  id: 'ollama',
  matches: (provider) => provider.toLowerCase().includes('ollama'),
  constraints: {
    ...openAiCompatibleAdapter.constraints,
    requiresApiKey: false
  },
  buildChat(model, messages, stream, tools) {
    const endpoint = model.endpoint.trim().replace(/\/+$/, '').replace(/\/api$/, '')
    return openAiCompatibleAdapter.buildChat({ ...model, endpoint }, messages, stream, tools)
  }
}
