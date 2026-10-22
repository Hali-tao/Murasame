export type ProbeFailureKind = '地址' | '网络' | '认证' | '额度' | '能力' | '模型不存在'

export function classifyProbeFailure(message: string): { kind: ProbeFailureKind; retry: boolean } {
  if (/不支持图像|不支持工具|does not support image|能力不支持/i.test(message)) return { kind: '能力', retry: false }
  if (/模型名称不存在|model.+not found/i.test(message)) return { kind: '模型不存在', retry: false }
  if (/API Key|401|403/.test(message)) return { kind: '认证', retry: false }
  if (/429|额度/.test(message)) return { kind: '额度', retry: true }
  if (/超时|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|TLS|certificate|网络/i.test(message)) return { kind: '网络', retry: true }
  return { kind: '地址', retry: false }
}
