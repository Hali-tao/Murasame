import { build } from 'esbuild'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

// Default stages assets for real-model E2E. Pass a userData directory to install for an app profile.
const destination = resolve(process.argv[2] || 'build/memory-model-download')
await mkdir('out/model-installer', { recursive: true })
const run = await mkdtemp(resolve('out/model-installer/run-'))
const entry = join(run, 'install.mjs')
await build({ entryPoints: ['src/main/local/memory-model-install.ts'], outfile: entry, bundle: true, platform: 'node', format: 'esm', packages: 'external' })
const { installMemoryModel } = await import(pathToFileURL(entry).href)
await installMemoryModel(destination)
console.log(`Model installed and SHA-256 verified: ${join(destination, 'models', 'bge-small-zh-v1.5')}`)
