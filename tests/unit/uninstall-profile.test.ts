import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

it('[NFR-R02] uninstall preserves complete profiles on locks and restores partial deletions', () => {
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', resolve('tests/windows/uninstall-profile.ps1')], { encoding: 'utf8', timeout: 90000 })
  for (const scenario of ['success', 'locked-db', 'locked-key', 'locked-local-state', 'partial-delete', 'backup-verification', 'absent']) {
    expect(output).toContain(`PASS ${scenario}`)
  }
}, 90000)
