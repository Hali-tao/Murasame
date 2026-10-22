import { describe, expect, it } from 'vitest'
import { AppError } from '../../src/shared/errors'
import { autonomyControlSchema, characterImportSchema, screenCaptureSchema } from '../../src/shared/schemas'

describe('[IF-03] 可操作错误', () => {
  it('[IF-03] 错误提示包含可采取的操作', () => {
    const error = new AppError('NOT_IMPLEMENTED', '尚未实现', '屏幕辅助尚未实现。', '请改用文字描述当前问题。', false)
    expect(error.toUserText()).toContain('请改用文字描述当前问题')
  })

  it('[NFR-M01] 错误码进日志但不进用户提示', () => {
    const error = new AppError('AUTH_FAILED', '认证失败', 'API Key 无效。', '请到模型服务重新填写密钥。', true)
    expect(error.toUserText()).not.toContain('AUTH_FAILED')
    expect(error.code).toBe('AUTH_FAILED')
  })
})

describe('[FR-21] IPC schema', () => {
  it('[FR-21] 预留通道的参数边界', () => {
    expect(screenCaptureSchema.safeParse({ continuous: true }).success).toBe(true)
    expect(characterImportSchema.safeParse({ path: '' }).success).toBe(false)
    expect(autonomyControlSchema.safeParse({}).success).toBe(true)
  })
})
