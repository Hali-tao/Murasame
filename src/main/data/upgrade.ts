import { copyFileSync, existsSync } from 'node:fs'

export function rejectDowngrade(storedVersion: number, supportedVersion: number): string | null {
  if (storedVersion > supportedVersion) {
    return `数据库版本 ${storedVersion} 高于本程序支持的 ${supportedVersion}。已拒绝打开，避免损坏数据。`
  }
  return null
}

export function withBackup(file: string, work: () => void): void {
  const backup = `${file}.bak`
  if (existsSync(file)) copyFileSync(file, backup)
  try {
    work()
  } catch (error) {
    if (existsSync(backup)) copyFileSync(backup, file)
    throw error
  }
}
