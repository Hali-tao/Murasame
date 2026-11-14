import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { buildSync } from 'esbuild'
import { beforeAll, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '../..')
const entry = join(root, 'out/electron-tests/database-recovery.cjs')

// Node 22.19.0 on Windows crashes inside native cpSync for a Unicode profile path.
// Copy every generated regular file/directory without that native recursive entry point.
function copyProfile(source: string, destination: string): void {
  mkdirSync(destination, { recursive: true })
  for (const item of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, item.name)
    const to = join(destination, item.name)
    if (item.isDirectory()) copyProfile(from, to)
    else if (item.isFile()) copyFileSync(from, to)
    else throw new Error(`Unexpected entry in isolated test profile: ${from}`)
  }
}

function profileContents(directory: string, relative = ''): Record<string, string> {
  const contents: Record<string, string> = {}
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    const name = join(relative, item.name)
    const file = join(directory, item.name)
    if (item.isDirectory()) {
      contents[`${name}/`] = 'directory'
      Object.assign(contents, profileContents(file, name))
    } else if (item.isFile()) contents[name] = createHash('sha256').update(readFileSync(file)).digest('hex')
    else throw new Error(`Unexpected entry in isolated test profile: ${file}`)
  }
  return contents
}

beforeAll(() => {
  buildSync({
    entryPoints: [join(root, 'tests/electron/database-recovery-entry.ts')],
    outfile: entry, bundle: true, platform: 'node', format: 'cjs',
    packages: 'external',
    loader: { '.sql': 'text' }
  })
})

it.each([
  'fresh-restart', 'missing-key-file', 'missing-key-entry', 'null-key-entry',
  'mismatched-key', 'undecryptable-key', 'invalid-key', 'malformed-key-file',
  'orphan-journal', 'orphan-journal-with-key', 'migration-failure',
  'scoped-clear-restart', 'scoped-partial-clear-restart', 'interrupted-first-run'
])('[NFR-R02] database recovery: %s', (scenario) => {
  const fixture = mkdtempSync(join(tmpdir(), 'murasame-database-recovery-'))
  const env: NodeJS.ProcessEnv = { ...process.env, MURASAME_DATABASE_FIXTURE: fixture }
  delete env.ELECTRON_RUN_AS_NODE
  try {
    const output = execFileSync(require('electron') as string, [entry, scenario], {
      cwd: root, encoding: 'utf8', timeout: 90_000, env
    })
    expect(output).toContain(`PASS database-recovery ${scenario}`)
    if (scenario === 'fresh-restart' || scenario === 'scoped-clear-restart' || scenario === 'scoped-partial-clear-restart') {
      const savedKey = readFileSync(join(fixture, 'murasame-db-key.json'))
      const restarted = execFileSync(require('electron') as string, [entry, `${scenario}-verify`], {
        cwd: root, encoding: 'utf8', timeout: 90_000, env
      })
      expect(restarted).toContain(`PASS database-recovery ${scenario}-verify`)
      expect(readFileSync(join(fixture, 'murasame-db-key.json'))).toEqual(savedKey)
      if (scenario === 'fresh-restart') {
        expect(existsSync(join(fixture, 'Local State'))).toBe(true)
        const restored = mkdtempSync(join(tmpdir(), 'murasame-database-recovery-'))
        try {
          const originalContents = profileContents(fixture)
          copyProfile(fixture, restored)
          expect(profileContents(restored)).toEqual(originalContents)
          const restoredOutput = execFileSync(require('electron') as string, [entry, 'fresh-restart-verify'], {
            cwd: root, encoding: 'utf8', timeout: 90_000,
            env: { ...env, MURASAME_DATABASE_FIXTURE: restored }
          })
          expect(restoredOutput).toContain('PASS database-recovery fresh-restart-verify')
          expect(readFileSync(join(restored, 'murasame-db-key.json'))).toEqual(savedKey)
        } finally {
          expect(resolve(restored).startsWith(`${resolve(tmpdir())}${sep}`)).toBe(true)
          expect(restored).toContain('murasame-database-recovery-')
          rmSync(restored, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
        }
      }
    }
  } finally {
    // Electron owns profile files until process exit, so remove this fixture in the parent.
    expect(resolve(fixture).startsWith(`${resolve(tmpdir())}${sep}`)).toBe(true)
    expect(fixture).toContain('murasame-database-recovery-')
    rmSync(fixture, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
}, 150_000)
