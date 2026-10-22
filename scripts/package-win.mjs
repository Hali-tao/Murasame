import { spawn } from 'node:child_process'
import { join, resolve } from 'node:path'

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
