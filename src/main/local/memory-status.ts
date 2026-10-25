import { EMBEDDING_MODEL_ID, missingEmbeddingFiles } from './embedding'

let status = '正在检查记忆服务'
let ready = false

export function memoryStatusText(): string {
  return status
}

export function memoryReady(): boolean {
  return ready
}

/**
 * 向量模型随安装包一起装，不需要联网也不需要额外的后台服务。
 * 文件不全时如实说明，记忆不会被带进对话。
 */
export function refreshMemoryStatus(userDataDir: string): string {
  const missing = missingEmbeddingFiles(userDataDir)
  ready = missing.length === 0
  status = ready
    ? '记忆服务已就绪，保存的偏好会按意思被想起来。'
    : `本机向量模型 ${EMBEDDING_MODEL_ID} 缺少 ${missing.join('、')}。没补齐之前，记忆不会被带进对话。`
  return status
}
