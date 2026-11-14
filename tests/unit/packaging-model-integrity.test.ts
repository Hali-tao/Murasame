import { describe, expect, it, vi } from 'vitest'

// 打包/原生模型校验会真实复制 GB 级模型并调用 electron-builder；给足超时避免负载下误报。
vi.setConfig({ testTimeout: 120_000 })
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'

const packageScript = resolve('scripts/package-win.mjs')
const builderConfig = resolve('electron-builder.yml')
const localRequire = createRequire(import.meta.url)
const fixtureRoot = resolve('previews/tmp/packaging-model-integrity')
const modelFiles = [
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

function put(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function fixture(omit?: string) {
  mkdirSync(fixtureRoot, { recursive: true })
  const cwd = mkdtempSync(join(fixtureRoot, 'case-'))
  const source = join(cwd, 'source models')
  for (const file of modelFiles) {
    if (file !== omit) put(join(source, file), `source:${file}`)
  }
  // Only replace the expensive installer boundary. Staging, copying and CLI execution are real.
  put(join(cwd, 'node_modules/electron-builder/cli.js'), `
    const { readFileSync, writeFileSync } = require('node:fs')
    const { join, resolve } = require('node:path')
    const { load } = require(${JSON.stringify(localRequire.resolve('js-yaml'))})
    const { getFileMatchers } = require(${JSON.stringify(localRequire.resolve('app-builder-lib/out/fileMatcher'))})
    const { expandMacro } = require(${JSON.stringify(localRequire.resolve('app-builder-lib/out/util/macroExpander'))})
    const config = load(readFileSync(${JSON.stringify(builderConfig)}, 'utf8'))
    const matchers = getFileMatchers(config, 'extraResources', resolve('fixture-resources'), {
      defaultSrc: process.cwd(),
      globalOutDir: resolve('release'),
      customBuildOptions: {},
      macroExpander: pattern => expandMacro(pattern, 'x64', {})
    })
    writeFileSync('builder-call.json', JSON.stringify({
      args: process.argv.slice(2),
      staging: resolve(process.env.MURASAME_STAGED_MODELS || 'build/bundled-models'),
      resolvedModels: matchers.find(matcher => matcher.to === join(resolve('fixture-resources'), 'models')).from
    }))
    process.exitCode = Number(process.env.FIXTURE_BUILDER_EXIT || 0)
  `)
  return { cwd, source, legacy: join(cwd, 'build/bundled-models') }
}

function run(input: ReturnType<typeof fixture>, extraEnv: Record<string, string> = {}) {
  return spawnSync(process.execPath, [packageScript], {
    cwd: input.cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      TEMP: fixtureRoot,
      TMP: fixtureRoot,
      MURASAME_MODELS: input.source,
      MURASAME_PACKAGE_OUTPUT: '',
      ...extraEnv
    }
  })
}

function call(input: ReturnType<typeof fixture>): { args: string[]; staging: string; resolvedModels: string } {
  return JSON.parse(readFileSync(join(input.cwd, 'builder-call.json'), 'utf8'))
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? filesUnder(join(dir, entry.name)).map((file) => `${entry.name}/${file}`)
      : [entry.name]
  ).sort()
}

describe('Windows package model integrity', () => {
  it('packages the source bytes when a previous staged model has equal-length corruption', () => {
    const input = fixture()
    const model = 'bge-small-zh-v1.5/onnx/model_quantized.onnx'
    const good = readFileSync(join(input.source, model), 'utf8')
    put(join(input.legacy, model), 'x'.repeat(good.length))

    const result = run(input)

    expect(result.status, result.stderr).toBe(0)
    expect(readFileSync(join(call(input).staging, model), 'utf8')).toBe(good)
  })

  it('packages exactly the allowlisted model files without stale assets or caches', () => {
    const input = fixture()
    put(join(input.legacy, 'README.txt'), 'old missing-model notice')
    put(join(input.legacy, 'kokoro/onnx/old-model.onnx'), 'obsolete')
    put(join(input.source, 'kokoro/cache/private-cache.bin'), 'not in manifest')

    const result = run(input)

    expect(result.status, result.stderr).toBe(0)
    expect(filesUnder(call(input).staging)).toEqual([...modelFiles].sort())
  })

  it('omits all models on an incomplete source and never silently uses an old staged model', () => {
    const missing = 'bge-small-zh-v1.5/onnx/model_quantized.onnx'
    const input = fixture(missing)
    put(join(input.legacy, missing), 'old model')
    put(join(input.legacy, 'whisper/config.json'), 'old config')

    const result = run(input)

    expect(result.status, result.stderr).toBe(0)
    expect(filesUnder(call(input).staging)).toEqual(['README.txt'])
    expect(readFileSync(join(call(input).staging, 'README.txt'), 'utf8')).toContain(missing)
  })

  it('passes an explicitly chosen output directory to the builder', () => {
    const input = fixture()
    const output = join(input.cwd, 'separate package output')

    const result = run(input, { MURASAME_PACKAGE_OUTPUT: output })

    expect(result.status, result.stderr).toBe(0)
    expect(call(input).args).toContain(`--config.directories.output=${output}`)
  })

  it('uses a fresh output directory by default and preserves the old release installer', () => {
    const input = fixture()
    const oldInstaller = join(input.cwd, 'release/Murasame-Setup-0.9.0.exe')
    put(oldInstaller, 'old verified installer')

    expect(run(input).status).toBe(0)
    const first = call(input).args.find((arg) => arg.startsWith('--config.directories.output='))
    expect(first).toBeDefined()
    const output = first!.slice('--config.directories.output='.length)
    expect(output).not.toBe(join(input.cwd, 'release'))
    expect(existsSync(output)).toBe(true)
    expect(readFileSync(oldInstaller, 'utf8')).toBe('old verified installer')
    expect(run(input).status).toBe(0)
    expect(call(input).args).not.toContain(first)
  })

  it('records the verified SHA-256 of every staged file outside the model directory', () => {
    const input = fixture()

    const result = run(input)

    expect(result.status, result.stderr).toBe(0)
    const staging = call(input).staging
    const receiptPath = join(dirname(staging), 'model-manifest.json')
    expect(existsSync(receiptPath)).toBe(true)
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'))
    expect(receipt.status).toBe('bundled')
    expect(receipt.files).toHaveLength(18)
    for (const file of receipt.files) {
      const bytes = readFileSync(join(staging, file.path))
      expect(file.sha256).toBe(createHash('sha256').update(bytes).digest('hex'))
      expect(file.bytes).toBe(bytes.length)
    }
  })

  it('refuses an occupied explicit output before calling the builder', () => {
    const input = fixture()
    const output = join(input.cwd, 'existing release')
    put(join(output, 'Murasame-Setup-0.9.0.exe'), 'keep me')

    const result = run(input, { MURASAME_PACKAGE_OUTPUT: output })

    expect(result.status).not.toBe(0)
    expect(existsSync(join(input.cwd, 'builder-call.json'))).toBe(false)
    expect(readFileSync(join(output, 'Murasame-Setup-0.9.0.exe'), 'utf8')).toBe('keep me')
  })

  it('resolves the verified model directory through the real electron-builder configuration', () => {
    const input = fixture()

    const result = run(input)

    expect(result.status, result.stderr).toBe(0)
    expect(call(input).resolvedModels).toBe(call(input).staging)
    expect(filesUnder(call(input).resolvedModels)).toEqual([...modelFiles].sort())
  })

  it.each(['empty', 'directory'])('treats an %s manifest entry as unavailable and omits the entire model set', (kind) => {
    const invalid = 'kokoro/onnx/model_quantized.onnx'
    const input = fixture(invalid)
    if (kind === 'empty') put(join(input.source, invalid), '')
    else mkdirSync(join(input.source, invalid), { recursive: true })

    const result = run(input)

    expect(result.status, result.stderr).toBe(0)
    expect(filesUnder(call(input).staging)).toEqual(['README.txt'])
    const receipt = JSON.parse(readFileSync(join(dirname(call(input).staging), 'model-manifest.json'), 'utf8'))
    expect(receipt).toMatchObject({ status: 'omitted', missing: [invalid], files: [] })
  })

  it('stops before the builder if copied bytes fail the SHA-256 check', () => {
    const input = fixture()
    const fault = join(input.cwd, 'corrupt-copy.cjs')
    // Simulate a corrupted filesystem copy, keeping real source reads and real hashes.
    put(fault, `
      const fs = require('node:fs')
      const { syncBuiltinESMExports } = require('node:module')
      const original = fs.copyFileSync
      fs.copyFileSync = (...args) => {
        original(...args)
        const bytes = fs.readFileSync(args[1])
        bytes[0] ^= 255
        fs.writeFileSync(args[1], bytes)
      }
      syncBuiltinESMExports()
    `)

    const result = run(input, { NODE_OPTIONS: `--require=${JSON.stringify(fault)}` })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('SHA-256')
    expect(existsSync(join(input.cwd, 'builder-call.json'))).toBe(false)
    expect(readFileSync(join(input.source, 'whisper/config.json'), 'utf8')).toBe('source:whisper/config.json')
  })

  it('propagates installer-builder failure without reporting a successful package', () => {
    const input = fixture()

    const result = run(input, { FIXTURE_BUILDER_EXIT: '17' })

    expect(result.status).toBe(17)
  })

  it('refuses direct builder resource resolution without a verified staging directory', () => {
    const input = fixture()

    const result = spawnSync(process.execPath, [join(input.cwd, 'node_modules/electron-builder/cli.js')], {
      cwd: input.cwd,
      encoding: 'utf8',
      env: Object.fromEntries(Object.entries(process.env).filter(([name]) => name !== 'MURASAME_STAGED_MODELS'))
    })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('MURASAME_STAGED_MODELS is not defined')
    expect(existsSync(join(input.cwd, 'builder-call.json'))).toBe(false)
  })
})
