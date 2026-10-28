import { describe, expect, it } from 'vitest'
import {
  memoryAddSchema,
  modelInputSchema,
  sendMessageSchema,
  settingsPatchSchema,
  taskCreateSchema
} from '../../src/shared/schemas'

describe('IPC schemas', () => {
  it('trims and validates chat and task input', () => {
    expect(sendMessageSchema.parse({ conversationId: 'chat-01', text: '  你好  ' }).text).toBe('你好')
    expect(sendMessageSchema.safeParse({ conversationId: '', text: '你好' }).success).toBe(false)
    expect(sendMessageSchema.safeParse({ conversationId: 'chat-01', text: '   ' }).success).toBe(false)
    expect(taskCreateSchema.safeParse({ title: '   ' }).success).toBe(false)
    expect(taskCreateSchema.safeParse({ title: '一个有效任务' }).success).toBe(true)
  })

  it('rejects overlong memory fields and accepts valid entries', () => {
    expect(memoryAddSchema.safeParse({ category: '偏好', text: '先给结论' }).success).toBe(true)
    expect(memoryAddSchema.safeParse({ category: '偏好', text: 'x'.repeat(1001) }).success).toBe(false)
    expect(memoryAddSchema.safeParse({ category: '', text: '先给结论' }).success).toBe(false)
  })

  it('validates model endpoints and settings ranges', () => {
    const model = {
      name: '主模型',
      provider: 'OpenAI Compatible',
      endpoint: 'https://api.openai.com/v1',
      key: 'sk-test',
      model: 'gpt-test',
      caps: ['文本']
    }
    expect(modelInputSchema.safeParse(model).success).toBe(true)
    expect(modelInputSchema.safeParse({ ...model, endpoint: '不是 URL' }).success).toBe(false)
    expect(settingsPatchSchema.safeParse({ petScale: 1.2 }).success).toBe(true)
    expect(settingsPatchSchema.safeParse({ petScale: 3 }).success).toBe(false)
    expect(settingsPatchSchema.safeParse({ petPreset: 'whale-girl' }).success).toBe(true)
    expect(settingsPatchSchema.safeParse({ petPreset: 'unknown-model' }).success).toBe(false)
    expect(settingsPatchSchema.safeParse({ logRetentionDays: 0 }).success).toBe(false)
  })
})

it('accepts a real long Windows task path without silently truncating it', () => {
  const title = '整理文件夹 E:\\Desktop\\软件工程\\murasame\\' + '任务记录与核验资料'.repeat(14)
  expect(title.length).toBeGreaterThan(120)
  expect(taskCreateSchema.safeParse({ title }).success).toBe(true)
  expect(taskCreateSchema.safeParse({ title: 'a'.repeat(4001) }).success).toBe(false)
})
