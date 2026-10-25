import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

// 语音模型有 250MB 左右，不进仓库。打包前从本机下载好的那份复制进来，
// 这样装到别人电脑上即使不联网也能朗读和识别。缺了也能打包，只是装完要自己下载。
const WHISPER_FILES = [
  'config.json',
  'generation_config.json',
  'preprocessor_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'onnx/encoder_model_quantized.onnx',
  'onnx/decoder_model_merged_quantized.onnx'
]
// 记忆向量模型，装完不联网也能按意思召回记忆（替掉了国内装不上的 Ollama）。
const EMBEDDING_DIR = 'bge-small-zh-v1.5'
const EMBEDDING_FILES = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx']
const KOKORO_FILES = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'onnx/model_quantized.onnx',
  'voices/zf_xiaoxiao.bin',
  'voices/zm_yunxi.bin',
  'voices/af_heart.bin'
]

/** 大小一样就当作已经复制过，重复打包时不再搬一遍几百兆。 */
function copyOne(from, to) {
  if (existsSync(to) && statSync(to).size === statSync(from).size) return
  mkdirSync(dirname(to), { recursive: true })
  copyFileSync(from, to)
}

function directorySize(dir) {
  let total = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    total += entry.isDirectory() ? directorySize(full) : statSync(full).size
  }
  return total
}

function stageModels() {
  const staging = resolve('build', 'bundled-models')
  mkdirSync(staging, { recursive: true })
  const source =
    process.env.MURASAME_MODELS ??
    join(process.env.APPDATA ?? '', 'murasame-desktop', 'models')

  // 只带代码真正会读的文件，仓库里其他规格的模型不打进去。
  const wanted = [
    ...WHISPER_FILES.map((file) => join('whisper', file)),
    ...KOKORO_FILES.map((file) => join('kokoro', file)),
    ...EMBEDDING_FILES.map((file) => join(EMBEDDING_DIR, file))
  ]
  const missing = wanted.filter((file) => !existsSync(join(source, file)))

  if (missing.length > 0) {
    writeFileSync(
      join(staging, 'README.txt'),
      '这台机器打包时没有找到完整的语音模型，安装包里不含语音模型。\n' +
        '装好以后需要自己把模型放到 %APPDATA%\\murasame-desktop\\models。\n'
    )
    console.log(`[models] ${source} 缺少 ${missing.length} 个文件，这次不打进安装包：`)
    for (const file of missing.slice(0, 5)) console.log(`[models]   ${file}`)
    return
  }

  for (const file of wanted) {
    copyOne(join(source, file), join(staging, file))
  }
  const mb = (directorySize(staging) / 1024 / 1024).toFixed(0)
  console.log(`[models] 已放入安装包：${staging}（${mb} MB）`)
}

stageModels()

const command = resolve('node_modules', 'electron-builder', 'cli.js')
const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
// electron-builder 会调用 powershell.exe 收集依赖树，这里确保它在 PATH 上。
const powershellDir = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0')

const child = spawn(process.execPath, [command, '--win', 'nsis'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    PATH: `${process.env.PATH ?? ''};${join(systemRoot, 'System32')};${powershellDir}`,
    CSC_IDENTITY_AUTO_DISCOVERY: 'false',
    ELECTRON_BUILDER_BINARIES_MIRROR: 'https://npmmirror.com/mirrors/electron-builder-binaries/'
  }
})

child.on('exit', (code) => {
  process.exitCode = code ?? 1
})
