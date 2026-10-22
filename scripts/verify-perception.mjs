import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const electron = require('electron')
const script = join(dirname(fileURLToPath(import.meta.url)), 'verify-perception-electron.cjs')
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(electron, [script], { env, stdio: 'inherit' })
child.on('exit', (code) => process.exit(code ?? 1))
