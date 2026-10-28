import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { stageModels } from './package-models.mjs'

function packageOutput() {
  const requested = process.env.MURASAME_PACKAGE_OUTPUT?.trim()
  if (requested) {
    const output = resolve(requested)
    if (existsSync(output) && (!statSync(output).isDirectory() || readdirSync(output).length > 0)) {
      throw new Error(`[package] 输出路径已存在且非空，请选择新的目录：${output}`)
    }
    mkdirSync(output, { recursive: true })
    return output
  }
  const parent = resolve('release')
  mkdirSync(parent, { recursive: true })
  return mkdtempSync(join(parent, `build-${new Date().toISOString().replace(/[:.]/g, '-')}-`))
}

const output = packageOutput()
const staging = await stageModels(process.env.MURASAME_MODELS || join(process.env.APPDATA ?? '', 'murasame-desktop', 'models'))
console.log(`[package] 独立输出目录：${output}`)

const command = resolve('node_modules', 'electron-builder', 'cli.js')
const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
// electron-builder 会调用 powershell.exe 收集依赖树，这里确保它在 PATH 上。
const powershellDir = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0')

const child = spawn(process.execPath, [command, '--win', 'nsis', `--config.directories.output=${output}`], {
  stdio: 'inherit',
  env: {
    ...process.env,
    // builder 先 resolve(from) 再展开宏，因此这里必须使用项目相对路径。
    MURASAME_STAGED_MODELS: relative(process.cwd(), staging),
    PATH: `${process.env.PATH ?? ''};${join(systemRoot, 'System32')};${powershellDir}`,
    CSC_IDENTITY_AUTO_DISCOVERY: 'false',
    ELECTRON_BUILDER_BINARIES_MIRROR: 'https://npmmirror.com/mirrors/electron-builder-binaries/'
  }
})

child.on('exit', (code) => {
  process.exitCode = code ?? 1
})
