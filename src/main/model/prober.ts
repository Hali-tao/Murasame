import type { ModelCapability, ModelCapabilityId } from '../../shared/types'
import { memoryCandidateSchema } from './contracts'
import type { ModelGateway } from './gateway'
import { probeImageBase64 } from './probe-image'
import { classifyProbeFailure } from './probe-failure'
import type { ResolvedModel } from './types'

const ALL: ModelCapabilityId[] = [
  'text.chat',
  'text.stream',
  'vision.image-input',
  'tools.function-calling',
  'output.json-schema'
]

function record(id: ModelCapabilityId, status: ModelCapability['status'], detail: string): ModelCapability {
  return { id, status, detail, probedAt: new Date().toISOString() }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : '探测失败'
}

export async function probeAll(
  gateway: ModelGateway,
  model: ResolvedModel
): Promise<{ capabilities: ModelCapability[]; failure: string | null; latencyMs: number }> {
  let latencyMs: number
  try {
    const outcome = await gateway.testConnection(model)
    latencyMs = outcome.latencyMs
  } catch (error) {
    const message = messageOf(error)
    const classified = classifyProbeFailure(message)
    const status = classified.kind === '能力' ? 'unsupported' : 'unknown'
    const detail = classified.retry ? `${classified.kind} · 待重测` : `${classified.kind}：${message}`
    return { capabilities: ALL.map((id) => record(id, status, detail)), failure: message, latencyMs: 0 }
  }

  const capabilities: ModelCapability[] = [record('text.chat', 'verified', '连接测试返回了内容')]
  try {
    const streamed = await gateway.chat(model, [{ role: 'user', content: '请只回复 OK' }])
    capabilities.push(record('text.stream', streamed.trim() ? 'verified' : 'unsupported', streamed.slice(0, 80) || '空响应'))
  } catch (error) {
    capabilities.push(record('text.stream', 'unknown', messageOf(error)))
  }

  try {
    const reply = await gateway.chatWithImages(
      model,
      '这张图主要是什么颜色？只回答颜色。',
      [{ mime: 'image/png', base64: probeImageBase64() }]
    )
    capabilities.push(record('vision.image-input', /蓝/.test(reply) ? 'verified' : 'unsupported', reply.slice(0, 80)))
  } catch (error) {
    const message = messageOf(error)
    const classified = classifyProbeFailure(message)
    capabilities.push(
      record(
        'vision.image-input',
        classified.kind === '能力' ? 'unsupported' : 'unknown',
        classified.retry ? '网络 · 待重测' : message
      )
    )
  }

  try {
    await gateway.callTools(
      model,
      [{ role: 'user', content: '请调用 get_color，颜色填蓝色。' }],
      [{
        name: 'get_color',
        description: '返回颜色',
        parameters: { type: 'object', properties: { color: { type: 'string' } }, required: ['color'] }
      }]
    )
    capabilities.push(record('tools.function-calling', 'verified', '返回了工具参数'))
  } catch (error) {
    const message = messageOf(error)
    const classified = classifyProbeFailure(message)
    capabilities.push(record('tools.function-calling', classified.kind === '能力' ? 'unsupported' : 'unknown', message))
  }

  try {
    await gateway.callStructured(
      model,
      memoryCandidateSchema,
      'emit_memory',
      '返回一条记忆',
      [{ role: 'user', content: '请记录：用户不吃辣。' }]
    )
    capabilities.push(record('output.json-schema', 'verified', '结构化输出通过校验'))
  } catch (error) {
    capabilities.push(record('output.json-schema', 'unsupported', messageOf(error)))
  }

  return { capabilities, failure: null, latencyMs }
}
