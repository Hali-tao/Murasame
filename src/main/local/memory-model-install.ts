import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rename, writeFile, rm, access } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { EMBEDDING_MODEL_ID, resetEmbeddingRuntime } from './embedding'

export const MEMORY_MODEL_REVISION = '75c43b069aac4d136ba6bc1122f995fedcfd2781'
export const MEMORY_MODEL_FILES = [
  { file: 'config.json', size: 716, hash: 'd4193ead3a810fd694fa8a31d7fc72fbaebc0668b603e398734bf2f6538ff42f' },
  { file: 'tokenizer.json', size: 439125, hash: '48cea5d44424912a6fd1ea647bf4fe50b55ab8b1e5879c3275f80e339e8fae26' },
  { file: 'tokenizer_config.json', size: 367, hash: 'e6f3b96db926a37d4039995fbf5ad17de158dfb8f6343d607e4dbaad18d75f5a' },
  { file: 'onnx/model_quantized.onnx', size: 24010842, hash: '15b717c382bcb518ba457b93ea6850ede7f4f1cd8937454aa06972366cd19bcc' }
] as const

export function verifyMemoryModelFile(bytes: Uint8Array, file: { size: number; hash: string }): void {
  if (bytes.byteLength !== file.size || createHash('sha256').update(bytes).digest('hex') !== file.hash) {
    throw new Error('下载文件校验失败，原有模型未替换。请重新下载。')
  }
}

/** Only downloads fixed public model assets; no conversation or memory content is sent. */
export async function installMemoryModel(userDataDir: string): Promise<void> {
  const parent = join(userDataDir, 'models')
  await mkdir(parent, { recursive: true })
  const staging = await mkdtemp(join(parent, '.memory-download-'))
  const target = join(parent, EMBEDDING_MODEL_ID)
  let backup: string | undefined
  try {
    for (const file of MEMORY_MODEL_FILES) {
      const response = await fetch(`https://huggingface.co/Xenova/${EMBEDDING_MODEL_ID}/resolve/${MEMORY_MODEL_REVISION}/${file.file}`, { signal: AbortSignal.timeout(180_000) })
      if (!response.ok || !response.body) throw new Error('模型下载失败，请检查网络后重试。')
      const chunks: Uint8Array[] = []
      let size = 0
      for await (const chunk of response.body) {
        size += chunk.byteLength
        if (size > file.size) throw new Error('下载文件大小异常，请重新下载。')
        chunks.push(chunk)
      }
      const bytes = Buffer.concat(chunks)
      verifyMemoryModelFile(bytes, file)
      const path = join(staging, file.file)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, bytes)
    }
    const exists = await access(target).then(() => true, () => false)
    if (exists) { backup = `${target}.backup-${Date.now()}`; await rename(target, backup) }
    try { await rename(staging, target) }
    catch (error) { if (backup) await rename(backup, target); throw error }
    resetEmbeddingRuntime()
  } finally {
    // staging is an exclusively created child of this user's model directory.
    await rm(staging, { recursive: true, force: true })
  }
}
