import { createHash } from 'node:crypto'
import { constants, copyFileSync, createReadStream, mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

// 仅包含应用实际使用的模型文件，不递归打入下载缓存或其他规格。
const MODEL_FILES = [
  'whisper/config.json',
  'whisper/generation_config.json',
  'whisper/preprocessor_config.json',
  'whisper/tokenizer.json',
  'whisper/tokenizer_config.json',
  'whisper/onnx/encoder_model_quantized.onnx',
  'whisper/onnx/decoder_model_merged_quantized.onnx',
  'kokoro/config.json',
  'kokoro/tokenizer.json',
  'kokoro/tokenizer_config.json',
  'kokoro/onnx/model_quantized.onnx',
  'kokoro/voices/zf_xiaoxiao.bin',
  'kokoro/voices/zm_yunxi.bin',
  'kokoro/voices/af_heart.bin',
  'bge-small-zh-v1.5/config.json',
  'bge-small-zh-v1.5/tokenizer.json',
  'bge-small-zh-v1.5/tokenizer_config.json',
  'bge-small-zh-v1.5/onnx/model_quantized.onnx'
]

function isUsableFile(file) {
  try {
    const stat = statSync(file)
    return stat.isFile() && stat.size > 0
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false
    throw error
  }
}

async function sha256(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

export async function stageModels(source) {
  source = resolve(source)
  // 每轮独占新目录：旧暂存、缺失模型、上次中断均不能污染本轮，也不删除旧资产。
  const parent = resolve('previews', 'package-staging')
  mkdirSync(parent, { recursive: true })
  const run = mkdtempSync(join(parent, 'run-'))
  const staging = join(run, 'models')
  mkdirSync(staging)
  const missing = MODEL_FILES.filter((file) => !isUsableFile(join(source, file)))
  const receipt = { source, status: missing.length ? 'omitted' : 'bundled', missing, files: [] }

  // 保留既有“来源不完整仍可打包，但完全不带模型”的策略，并准确列出缺失内容。
  if (missing.length) {
    writeFileSync(join(staging, 'README.txt'),
      '打包来源缺少有效模型文件，本安装包不含语音和记忆向量模型。\n' +
      '装好以后需要把完整模型放到 %APPDATA%\\murasame-desktop\\models。\n' +
      `缺失、空文件或非普通文件：\n${missing.join('\n')}\n`)
    console.log(`[models] ${source} 有 ${missing.length} 个文件缺失或无效，本次不打入任何模型：`)
    for (const file of missing) console.log(`[models]   ${file}`)
  } else {
    for (const file of MODEL_FILES) {
      const from = join(source, file)
      const to = join(staging, file)
      const expectedHash = await sha256(from)
      mkdirSync(dirname(to), { recursive: true })
      copyFileSync(from, to, constants.COPYFILE_EXCL)
      const actualHash = await sha256(to)
      if (actualHash !== expectedHash) throw new Error(`[models] 复制后 SHA-256 不一致，停止打包：${file}`)
      receipt.files.push({ path: file, bytes: statSync(to).size, sha256: actualHash })
    }
    const mb = (receipt.files.reduce((sum, file) => sum + file.bytes, 0) / 1024 / 1024).toFixed(0)
    console.log(`[models] 已核对 ${receipt.files.length} 个文件的 SHA-256：${staging}（${mb} MB）`)
  }
  // 回执不放进模型资源目录，资源目录只包含清单文件或明确的缺失说明。
  writeFileSync(join(run, 'model-manifest.json'), JSON.stringify(receipt, null, 2) + '\n')
  return staging
}
