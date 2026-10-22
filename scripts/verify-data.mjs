import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outfile = join(root, 'out', 'electron-tests', 'migrate.cjs')

await build({
  entryPoints: [join(root, 'tests', 'electron', 'migrate-entry.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile,
  external: ['electron', 'better-sqlite3-multiple-ciphers']
})

const env = { ...process.env, MURASAME_MIGRATIONS: join(root, 'src', 'main', 'data', 'migrations') }
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(require('electron'), [outfile], { stdio: 'inherit', env })
child.on('exit', (code) => process.exit(code ?? 1))
