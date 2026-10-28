import { existsSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

let configured = false
let bundledRoot = ''

/**
 * 安装包自带的语音模型目录。主进程启动时写一次；开发态为空。
 */
export function setBundledModelsRoot(dir: string): void {
  bundledRoot = dir
  configured = false
}

/**
 * 用户自己下载的模型放在 userData 下，优先用这一份；
 * 没有时才退回安装包自带的那份（装在 Program Files 里，只读就够了）。
 */
export function modelsRoot(userDataDir: string): string {
  const local = join(userDataDir, 'models')
  if (existsSync(local)) return local
  if (bundledRoot && existsSync(bundledRoot)) return bundledRoot
  return local
}

export function missingModelFiles(directory: string, files: readonly string[]): string[] {
  return files.filter(file => {
    try { const stat = statSync(join(directory, file)); return !stat.isFile() || stat.size === 0 }
    catch { return true }
  })
}

/** Select one complete model, never mix a partial override with bundled weights. */
export function localModelDirectory(userDataDir: string, modelId: string, files: readonly string[]): string {
  const local = resolve(userDataDir, 'models', modelId)
  if (!missingModelFiles(local, files).length) return local
  const bundled = bundledRoot ? resolve(bundledRoot, modelId) : null
  if (bundled && !missingModelFiles(bundled, files).length) return bundled
  return existsSync(local) || !bundled ? local : bundled
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
