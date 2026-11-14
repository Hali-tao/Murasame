#!/usr/bin/env node
/**
 * 安装包形态 E2E：对已打包的 win-unpacked 应用跑一组关键验收（不是源码 dev 启动）。
 *
 * 前置：
 *   npm run package:win
 * 运行：
 *   npm run test:e2e:packaged
 *   MURASAME_E2E_EXECUTABLE=path/to/Murasame.exe npm run test:e2e:packaged
 *
 * 若同一用户数据目录下已有源码套件结果，请勿同时运行；本入口自行隔离 userData。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve('.')
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'

function latestPackagedExecutable() {
  const requested = process.env.MURASAME_E2E_EXECUTABLE?.trim()
  if (requested) return resolve(requested)
  const release = join(root, 'release')
  if (!existsSync(release)) return null
  const builds = readdirSync(release, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('build-'))
    .map((entry) => join(release, entry.name))
    .sort((left, right) => right.localeCompare(left))
  for (const build of builds) {
    const candidate = join(build, 'win-unpacked', 'Murasame.exe')
    if (existsSync(candidate)) return candidate
  }
  return null
}

const executable = latestPackagedExecutable()
if (!executable || !existsSync(executable)) {
  console.error('[packaged-e2e] 未找到已打包应用。请先运行 npm run package:win，或用 MURASAME_E2E_EXECUTABLE 指定 Murasame.exe。')
  process.exit(1)
}
const resources = join(executable, '..', 'resources')
const models = join(resources, 'models')
const hasSpeechModels =
  existsSync(join(models, 'whisper/onnx/encoder_model_quantized.onnx')) &&
  existsSync(join(models, 'kokoro/onnx/model_quantized.onnx')) &&
  existsSync(join(models, 'kokoro/voices/zf_xiaoxiao.bin'))
const hasEmbedding = existsSync(join(models, 'bge-small-zh-v1.5/onnx/model_quantized.onnx'))

const env = { ...process.env, MURASAME_E2E_EXECUTABLE: executable }
delete env.ELECTRON_RUN_AS_NODE
if (hasSpeechModels) env.MURASAME_E2E_SPEECH = '1'

const specs = [
  'tests/e2e/qa-packaged-smoke.spec.ts',
  'tests/e2e/app.spec.ts',
  ...(hasSpeechModels ? ['tests/e2e/speech-responsive.spec.ts'] : []),
  ...(hasEmbedding ? ['tests/e2e/local-memory.spec.ts'] : [])
]

console.log(`[packaged-e2e] executable: ${executable}`)
console.log(`[packaged-e2e] speech models: ${hasSpeechModels ? 'yes' : 'no'}；BGE: ${hasEmbedding ? 'yes' : 'no'}`)
const result = spawnSync(npx, ['playwright', 'test', ...specs, ...process.argv.slice(2)], {
  stdio: 'inherit',
  windowsHide: true,
  env,
  shell: process.platform === 'win32'
})
process.exit(result.status ?? 1)
