import { dirname, join } from 'node:path'

export const DATABASE_KEY_FILE = 'murasame-db-key.json'

export function databaseRecoveryError(reason: string, file: string, cause?: unknown): Error {
  const directory = dirname(file)
  return new Error(
    `${reason}。已停止打开，现有数据库和密钥文件保留原样。\n\n`
    + `请先退出应用并备份整个资料目录：${directory}\n`
    + `使用创建这些数据时的 Windows 帐户，恢复同一份完整资料备份后再启动，必须包括 Local State、数据库 ${file} 及其日志文件和密钥 ${join(directory, DATABASE_KEY_FILE)}。\n`
    + '请勿单独删除或重新生成密钥；没有原始密钥无法恢复原有加密数据。',
    { cause }
  )
}
