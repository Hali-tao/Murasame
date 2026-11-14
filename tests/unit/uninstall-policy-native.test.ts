import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')
const script = join(root, 'scripts/verify-uninstall-hook.mjs')

it.each([
  ['silent', ['/S']],
  ['silent-upgrade', ['/S', '--updated']],
  ['upgrade', ['--updated']]
] as const)('[OR-02][OR-03] native uninstall hook preserves all data during %s without prompting', (scenario, args) => {
  const fixture = `check-${scenario}-${randomUUID()}`
  const run = (...parameters: string[]): string => execFileSync(process.execPath, [script, ...parameters], { cwd: root, encoding: 'utf8', timeout: 90_000 })
  expect(run('build', fixture)).toContain('"compiled":true')
  expect(run('run', fixture, ...args)).toContain('"timedOut":false')
  expect(run('check', fixture)).toContain('"preserved":true')
  const receipt = JSON.parse(readFileSync(join(root, 'previews/uninstall-policy-2026-10-29', fixture, 'receipt.json'), 'utf8'))
  expect(receipt.files).toHaveLength(4)
}, 120_000)
