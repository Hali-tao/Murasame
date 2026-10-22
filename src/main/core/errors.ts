export class NotImplementedError extends Error {
  readonly feature: string

  constructor(feature: string) {
    super(`该功能尚未实现：${feature}`)
    this.name = 'NotImplementedError'
    this.feature = feature
  }
}

export function notImplemented(feature: string): never {
  throw new NotImplementedError(feature)
}
