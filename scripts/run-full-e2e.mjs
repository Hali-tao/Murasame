#!/usr/bin/env node
/**
 * 全量 E2E：在依赖齐全的机器上把默认套件里"需要 Docker / 真实语音模型"的用例也一起跑掉。
 *
 * 自动检测并设置：
 * - MURASAME_E2E_ISOLATION=1（Docker 引擎可用且存在 murasame-isolation:local 镜像）
 * - MURASAME_E2E_SPEECH=1（build/bundled-models 里 whisper/kokoro 真实模型齐全，且 python misaki 可用）
 *
 * 用法：
 *   node scripts/run-full-e2e.mjs [playwright 参数...]
 *   npm run test:e2e:all
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve('.')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const run = (command, args, options = {}) => spawnSync(command, args, { encoding: 'utf8', windowsHide: true, ...options })

function have(command, args) {
  const result = run(command, args)
  return result.status === 0
}

const isolationImage = 'murasame-isolation:local'
const isolationReady = have('docker', ['image', 'inspect', isolationImage])
const speechFiles = [
  'whisper/config.json',
  'whisper/tokenizer.json',
  'whisper/onnx/encoder_model_quantized.onnx',
  'whisper/onnx/decoder_model_merged_quantized.onnx',
  'kokoro/config.json',
  'kokoro/tokenizer.json',
  'kokoro/onnx/model_quantized.onnx',
  'kokoro/voices/zf_xiaoxiao.bin'
]
const modelsRoot = join(root, 'build', 'bundled-models')
const modelsReady = speechFiles.every(file => existsSync(join(modelsRoot, file)))
const phonemizerReady = have(process.env.MURASAME_PYTHON?.trim() || 'python', ['-c', 'from misaki import zh'])

const env = { ...process.env }
if (isolationReady) env.MURASAME_E2E_ISOLATION = '1'
if (modelsReady && phonemizerReady) env.MURASAME_E2E_SPEECH = '1'

console.log(`[full-e2e] Docker 隔离镜像 ${isolationImage}: ${isolationReady ? '可用' : '不可用（相关 3 个用例会 skip）'}`)
console.log(`[full-e2e] 真实语音模型: ${modelsReady ? '齐全' : '缺失'}；python misaki: ${phonemizerReady ? '可用' : '不可用'}${modelsReady && phonemizerReady ? '' : '（相关 2 个用例会 skip）'}`)

const build = spawnSync(npm, ['run', 'build'], { stdio: 'inherit', windowsHide: true, env, shell: process.platform === 'win32' })
if (build.error) console.error('[full-e2e] build spawn error:', build.error.message)
if (build.status !== 0) process.exit(build.status ?? 1)
const result = spawnSync(npx, ['playwright', 'test', ...process.argv.slice(2)], { stdio: 'inherit', windowsHide: true, env, shell: process.platform === 'win32' })
if (result.error) console.error('[full-e2e] test spawn error:', result.error.message)
process.exit(result.status ?? 1)
