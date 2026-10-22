export type ErrorCategory =
  | '权限拒绝'
  | '服务不可用'
  | '认证失败'
  | '额度不足'
  | '能力不支持'
  | '资源缺失'
  | '校验失败'
  | '用户取消'
  | '尚未实现'

export class AppError extends Error {
  readonly code: string
  readonly category: ErrorCategory
  readonly userMessage: string
  readonly suggestedAction: string
  readonly retryable: boolean

  constructor(
    code: string,
    category: ErrorCategory,
    userMessage: string,
    suggestedAction: string,
    retryable: boolean,
    options?: { cause?: unknown }
  ) {
    super(userMessage, options)
    this.name = 'AppError'
    this.code = code
    this.category = category
    this.userMessage = userMessage
    this.suggestedAction = suggestedAction
    this.retryable = retryable
  }

  toUserText(): string {
    return `${this.userMessage} ${this.suggestedAction}`.trim()
  }
}
