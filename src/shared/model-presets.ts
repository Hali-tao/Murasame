export interface PresetModel {
  id: string
  label: string
}

export interface ModelPreset {
  id: string
  label: string
  provider: 'OpenAI Compatible' | 'Anthropic' | 'Ollama'
  endpoint: string
  suggestedModel: string
  models: readonly PresetModel[]
  needsKey: boolean
  note: string
}

/**
 * 只是填表模板，不是架构前提：新增任何 OpenAI 兼容服务都不需要改代码，
 * 选「兼容接口」自己填地址即可。
 */
export const MODEL_PRESETS: readonly ModelPreset[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    provider: 'OpenAI Compatible',
    endpoint: 'https://api.deepseek.com',
    suggestedModel: 'deepseek-flash',
    models: [
      { id: 'deepseek-flash', label: 'deepseek-flash（推荐）' },
      { id: 'deepseek-v4-pro', label: 'deepseek-v4-pro' },
      { id: 'deepseek-chat', label: 'deepseek-chat' }
    ],
    needsKey: true,
    note: '地址已填好。模型名以服务商文档为准，不要只写 deepseek。'
  },
  {
    id: 'openai',
    label: 'OpenAI',
    provider: 'OpenAI Compatible',
    endpoint: 'https://api.openai.com/v1',
    suggestedModel: 'gpt-4.1',
    models: [
      { id: 'gpt-4.1', label: 'gpt-4.1' },
      { id: 'gpt-4o', label: 'gpt-4o' },
      { id: 'gpt-4o-mini', label: 'gpt-4o-mini' }
    ],
    needsKey: true,
    note: '官方端点。模型名以你账号里实际开通的为准。'
  },
  {
    id: 'siliconflow',
    label: '硅基流动',
    provider: 'OpenAI Compatible',
    endpoint: 'https://api.siliconflow.cn/v1',
    suggestedModel: 'deepseek-ai/DeepSeek-V3',
    models: [
      { id: 'deepseek-ai/DeepSeek-V3', label: 'DeepSeek-V3' },
      { id: 'Qwen/Qwen2.5-7B-Instruct', label: 'Qwen2.5-7B' }
    ],
    needsKey: true,
    note: '硅基流动的模型名要带厂商前缀，例如 deepseek-ai/DeepSeek-V3。'
  },
  {
    id: 'moonshot',
    label: '月之暗面',
    provider: 'OpenAI Compatible',
    endpoint: 'https://api.moonshot.cn/v1',
    suggestedModel: 'moonshot-v1-128k',
    models: [
      { id: 'moonshot-v1-8k', label: 'moonshot-v1-8k' },
      { id: 'moonshot-v1-32k', label: 'moonshot-v1-32k' },
      { id: 'moonshot-v1-128k', label: 'moonshot-v1-128k' }
    ],
    needsKey: true,
    note: 'Kimi 开放平台的 Key。模型名以控制台列出的为准。'
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    provider: 'Anthropic',
    endpoint: 'https://api.anthropic.com',
    suggestedModel: 'claude-sonnet-4-5',
    models: [
      { id: 'claude-sonnet-4-5', label: 'claude-sonnet-4-5' },
      { id: 'claude-opus-4-5', label: 'claude-opus-4-5' },
      { id: 'claude-haiku-4-5', label: 'claude-haiku-4-5' }
    ],
    needsKey: true,
    note: 'Messages 协议，与 OpenAI 兼容接口的消息结构不同。模型名以文档为准。'
  },
  {
    id: 'ollama',
    label: 'Ollama（本机）',
    provider: 'Ollama',
    endpoint: 'http://127.0.0.1:11434/v1',
    suggestedModel: '',
    models: [],
    needsKey: false,
    note: '本机服务，通常不需要 API Key。模型名填 ollama list 里看到的名字。'
  },
  {
    id: 'custom',
    label: '其他兼容接口',
    provider: 'OpenAI Compatible',
    endpoint: '',
    suggestedModel: '',
    models: [],
    needsKey: true,
    note: '自行填写服务地址与模型名称。'
  }
]

export function presetById(id: string): ModelPreset | null {
  return MODEL_PRESETS.find((preset) => preset.id === id) ?? null
}

/** 用已经填好的地址反推运营商。对不上就当作自定义。 */
export function matchPreset(endpoint: string, provider = ''): string {
  const value = endpoint.trim().replace(/\/+$/, '').toLowerCase()
  if (value) {
    const found = MODEL_PRESETS.find((preset) => {
      if (!preset.endpoint || preset.id === 'custom') return false
      const base = preset.endpoint.replace(/\/+$/, '').toLowerCase()
      return value === base || value.startsWith(`${base}/`)
    })
    if (found) return found.id
  }
  if (provider === 'Anthropic') return 'anthropic'
  if (provider === 'Ollama') return 'ollama'
  return 'custom'
}

export interface KeyGuess {
  presetId: string | null
  confident: boolean
  reason: string
}

/**
 * 按 API Key 前缀猜服务商。只在前缀唯一时才算确定；
 * 猜测一律不改变能力判定，仍须经探测验证（D-16）。
 */
export function detectProviderFromKey(key: string): KeyGuess {
  const value = key.trim()
  if (!value) return { presetId: null, confident: false, reason: '' }

  if (value.startsWith('sk-ant-')) {
    return { presetId: 'anthropic', confident: true, reason: '前缀 sk-ant- 对应 Anthropic' }
  }
  if (value.startsWith('sk-or-v1-')) {
    return { presetId: 'custom', confident: true, reason: '前缀 sk-or-v1- 对应 OpenRouter，按兼容接口填写' }
  }
  if (value.startsWith('gsk_')) {
    return { presetId: 'custom', confident: true, reason: '前缀 gsk_ 对应 Groq，按兼容接口填写' }
  }
  if (value.startsWith('AIza')) {
    return { presetId: 'custom', confident: true, reason: '前缀 AIza 对应 Google AI，按兼容接口填写' }
  }
  if (value.startsWith('sk-')) {
    return {
      presetId: null,
      confident: false,
      reason: 'sk- 前缀被 OpenAI、DeepSeek、Moonshot 等多家共用，无法据此判断，请自己选服务'
    }
  }
  return { presetId: null, confident: false, reason: '这个前缀无法对应到已知服务，请自己选服务' }
}
