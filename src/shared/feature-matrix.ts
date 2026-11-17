import type { ModelCapability, ModelCapabilityId } from './types'

export interface FeatureNeed {
  id: 'chat' | 'screen' | 'tasks' | 'structured'
  label: string
  requires: ModelCapabilityId[]
}

export const featureNeeds: readonly FeatureNeed[] = [
  { id: 'chat', label: '文字交流', requires: ['text.chat'] },
  { id: 'screen', label: '屏幕文字分析', requires: ['text.chat'] },
  { id: 'tasks', label: '任务工具调用', requires: ['tools.function-calling'] },
  { id: 'structured', label: '结构化输出', requires: ['output.json-schema'] }
]

export function featureState(
  capabilities: readonly ModelCapability[] | undefined,
  featureId: FeatureNeed['id']
): { available: boolean; label: string } {
  const feature = featureNeeds.find((item) => item.id === featureId)
  if (!feature) return { available: false, label: '未验证' }
  const records = capabilities ?? []
  const ready = feature.requires.every((id) => records.find((item) => item.id === id)?.status === 'verified')
  if (ready) return { available: true, label: '可用' }
  const blocked = feature.requires.some((id) => records.find((item) => item.id === id)?.status === 'unsupported')
  return { available: false, label: blocked ? '当前模型不支持所需能力' : '未验证' }
}
