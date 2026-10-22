import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const command = resolve('node_modules', 'electron-builder', 'cli.js')
const child = spawn(process.execPath, [command, '--win', 'nsis'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    CSC_IDENTITY_AUTO_DISCOVERY: 'false'
  }
})

child.on('exit', (code) => {
  process.exitCode = code ?? 1
})
