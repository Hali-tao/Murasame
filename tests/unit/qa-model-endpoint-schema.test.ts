import { describe, expect, it } from 'vitest'
import { modelInputSchema } from '../../src/shared/schemas'

const valid = {
  name: '本地测试服务',
  provider: 'openai',
  endpoint: 'http://127.0.0.1:8787/v1',
  key: 'sk-qa',
  model: 'gpt-4o-mini',
  caps: ['chat']
}

describe('[QA-MODEL-00] 模型地址只接受 http/https（防御纵深）', () => {
  it('[QA-MODEL-01] 接受 http/https 地址（本地/LAN/公网）', () => {
    expect(modelInputSchema.safeParse(valid).success).toBe(true)
    expect(modelInputSchema.safeParse({ ...valid, endpoint: 'https://api.example.com/v1' }).success).toBe(true)
    expect(modelInputSchema.safeParse({ ...valid, endpoint: 'http://192.168.1.10:11434/v1' }).success).toBe(true)
  })

  it('[QA-MODEL-02] 拒绝 file:// / javascript: / data: 等非 http(s) scheme', () => {
    for (const endpoint of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/plain,hello', 'ftp://example.com/v1']) {
      const result = modelInputSchema.safeParse({ ...valid, endpoint })
      expect(result.success, endpoint).toBe(false)
      if (!result.success) expect(result.error.issues[0].message).toContain('http')
    }
  })

  it('[QA-MODEL-03] 拒绝空地址与超长地址，同时保持已有字段约束', () => {
    expect(modelInputSchema.safeParse({ ...valid, endpoint: '' }).success).toBe(false)
    expect(modelInputSchema.safeParse({ ...valid, endpoint: `https://example.com/${'a'.repeat(600)}` }).success).toBe(false)
  })
})
