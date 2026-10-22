import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const electronPath = require('electron')
const script = join(dirname(fileURLToPath(import.meta.url)), 'verify-native-electron.cjs')

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(electronPath, [script], {
  stdio: 'inherit',
  env
})

child.on('exit', (code) => {
  process.exit(code ?? 1)
})
