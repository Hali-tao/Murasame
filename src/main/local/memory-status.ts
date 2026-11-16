import { embedLocally, missingEmbeddingFiles, resetEmbeddingRuntime } from './embedding'
import { installMemoryModel } from './memory-model-install'
import type { MemoryModelStatus } from '../../shared/types'

let status = '正在检查记忆服务'
let ready = false
let model: MemoryModelStatus = { state: 'preparing', message: '正在检查记忆检索模型。' }
let pending: Promise<MemoryModelStatus> | undefined

export function memoryModelStatus(): MemoryModelStatus { return { ...model } }

function publish(state: MemoryModelStatus['state'], message: string): MemoryModelStatus {
  ready = state === 'ready'
  status = message
  model = { state, message }
  return memoryModelStatus()
}

export function checkMemoryModel(userDataDir: string, install = false): Promise<MemoryModelStatus> {
  if (pending) return pending
  const retry = model.state === 'error'
  publish('preparing', install ? '正在下载并校验模型，请保持网络连接。' : '正在检查文件并测试本地检索能力。')
  pending = (async () => {
    try {
      if (install) await installMemoryModel(userDataDir)
      if (missingEmbeddingFiles(userDataDir).length) return publish('missing', '记忆检索模型未安装完整。请下载并准备模型。')
      if (retry) resetEmbeddingRuntime()
      const vector = await embedLocally('检查本地记忆检索能力', userDataDir)
      return vector
        ? publish('ready', '已通过本地运行检查。聊天时会按相关性检索记忆，不代表每条记忆都会被使用。')
        : publish('error', '模型文件存在，但无法正常运行。请重新下载修复后再检查。')
    } catch {
      return publish('error', '模型准备失败，请检查网络和磁盘空间后重试。已有记忆不会被删除。')
    }
  })().finally(() => { pending = undefined })
  return pending
}

export function memoryStatusText(): string {
  return status
}

export function memoryReady(): boolean {
  return ready
}

/**
 * 先检查本地文件；是否可用由 checkMemoryModel 的真实推理决定。
 * 缺失时只报告状态，下载必须由用户明确触发。
 */
export function refreshMemoryStatus(userDataDir: string): string {
  const missing = missingEmbeddingFiles(userDataDir)
  publish(missing.length ? 'missing' : 'preparing', missing.length
    ? '记忆检索模型未安装完整，语义召回暂不可用；仍可添加、查看、编辑和删除记忆。'
    : '模型文件已找到，正在检查能否正常运行。')
  return status
}
