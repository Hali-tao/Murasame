import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'

export interface PortableBundle {
  version: number
  conversations: unknown[]
  memories: unknown[]
  character: unknown
  models: Array<{ id: string; name: string; endpoint: string }>
}

export function exportBundle(input: PortableBundle, passphrase: string): Buffer {
  const salt = randomBytes(16)
  const key = scryptSync(passphrase, salt, 32)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const body = Buffer.from(JSON.stringify(input), 'utf8')
  const encrypted = Buffer.concat([cipher.update(body), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([Buffer.from('MUR1'), salt, iv, tag, encrypted])
}

export function importBundle(payload: Buffer, passphrase: string, supportedVersion: number): PortableBundle {
  const headerBytes = 4 + 16 + 12 + 16
  if (!Buffer.isBuffer(payload) || payload.length <= headerBytes) {
    throw new Error('数据包不完整或已损坏，现有数据保持不变')
  }
  if (payload.subarray(0, 4).toString() !== 'MUR1') throw new Error('数据包格式无法识别，现有数据保持不变')
  if (passphrase.length > 200) throw new Error('口令过长，已拒绝导入')
  const salt = payload.subarray(4, 20)
  const iv = payload.subarray(20, 32)
  const tag = payload.subarray(32, 48)
  const encrypted = payload.subarray(48)
  const key = scryptSync(passphrase, salt, 32)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  let json: string
  try {
    json = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
  } catch {
    throw new Error('口令错误或数据包已损坏，现有数据保持不变')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('数据包内容无法解析，现有数据保持不变')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('数据包结构无效或已损坏，现有数据保持不变')
  }
  const candidate = parsed as Record<string, unknown>
  if (typeof candidate.version !== 'number' || !Number.isFinite(candidate.version)) {
    throw new Error('数据包结构无效：缺少有效版本号，现有数据保持不变')
  }
  if (candidate.version > supportedVersion) throw new Error('数据包版本更高，已拒绝导入，现有数据保持不变')
  const isObjectOrNull = (value: unknown): boolean => value === null || (typeof value === 'object' && !Array.isArray(value))
  if (!Array.isArray(candidate.conversations) || !Array.isArray(candidate.memories) || !Array.isArray(candidate.models) || !isObjectOrNull(candidate.character)) {
    throw new Error('数据包结构无效或已损坏，现有数据保持不变')
  }
  const serialized = JSON.stringify(candidate)
  if (/sk-[A-Za-z0-9_-]{8,}/.test(serialized) || /"key"\s*:/.test(serialized)) {
    throw new Error('数据包含有凭据，已拒绝导入')
  }
  return candidate as unknown as PortableBundle
}

export function stripSecrets<T extends { models: Array<Record<string, unknown>> }>(input: T): T {
  return {
    ...input,
    models: input.models.map((model) => {
      const rest = { ...model }
      delete rest.key
      delete rest.apiKey
      return rest
    })
  }
}
