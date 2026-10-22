import { join } from 'node:path'

export const DATABASE_FILE_NAME = 'murasame.db'
export const SOFT_LIMIT_BYTES = 2 * 1024 * 1024 * 1024
export const CAPACITY_WARN_RATIO = 0.8

export function databasePath(userDataDir: string): string {
  return join(userDataDir, DATABASE_FILE_NAME)
}

export function capacityStatus(sizeBytes: number): { warning: boolean; message: string | null } {
  const threshold = Math.floor(SOFT_LIMIT_BYTES * CAPACITY_WARN_RATIO)
  if (sizeBytes >= threshold) {
    return {
      warning: true,
      message: `本地数据库已达到容量软上限的 80%（${sizeBytes} / ${SOFT_LIMIT_BYTES} 字节）。请清理历史、记忆或日志。`
    }
  }
  return { warning: false, message: null }
}
