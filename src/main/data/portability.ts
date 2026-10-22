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
  if (payload.subarray(0, 4).toString() !== 'MUR1') throw new Error('数据包格式无法识别，现有数据保持不变')
  const salt = payload.subarray(4, 20)
  const iv = payload.subarray(20, 32)
  const tag = payload.subarray(32, 48)
  const encrypted = payload.subarray(48)
  const key = scryptSync(passphrase, salt, 32)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  const json = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
  const bundle = JSON.parse(json) as PortableBundle
  if (bundle.version > supportedVersion) throw new Error('数据包版本更高，已拒绝导入，现有数据保持不变')
  const serialized = JSON.stringify(bundle)
  if (/sk-[A-Za-z0-9_-]{8,}/.test(serialized) || /"key"\s*:/.test(serialized)) {
    throw new Error('数据包含有凭据，已拒绝导入')
  }
  return bundle
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
