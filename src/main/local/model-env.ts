import { join } from 'node:path'

let configured = false

export function modelsRoot(userDataDir: string): string {
  return join(userDataDir, 'models')
}

/**
 * transformers.js 只认一个全局本地目录，且必须禁止远程拉取，
 * 否则模型缺失时会悄悄连外网下载。
 */
export async function configureLocalModels(userDataDir: string): Promise<void> {
  if (configured) return
  const { env } = await import('@huggingface/transformers')
  env.allowRemoteModels = false
  env.localModelPath = modelsRoot(userDataDir)
  configured = true
}
