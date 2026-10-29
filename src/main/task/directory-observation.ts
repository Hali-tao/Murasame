import { createHash } from 'node:crypto'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { basename, isAbsolute, relative, sep } from 'node:path'
import { resolveInside, type FileEffect } from '../tools/filesystem'

/** Reconcile an old listing only with verified additions selected by the executor.
 * Keep the original observation/receipt intact; other checkpoint checks still run.
 */
export function expectedDirectoryListing(root: string, directory: string, observed: string, effects: readonly FileEffect[]): string | undefined {
  let entries: unknown
  try { entries = JSON.parse(observed) } catch { return undefined }
  if (!Array.isArray(entries) || entries.some(name => typeof name !== 'string' || !name || name === '.' || name === '..' || basename(name) !== name)) return undefined
  if (new Set(entries).size !== entries.length) return undefined
  const expected = new Set(entries as string[])
  let actualDirectory: string
  try { actualDirectory = realpathSync(resolveInside(root, directory)); if (!statSync(actualDirectory).isDirectory()) return undefined } catch { return undefined }
  for (const effect of effects) {
    if (effect.status !== 'moved' || effect.source !== '' || effect.operation) continue
    try {
      const destination = resolveInside(root, effect.destination)
      if (!statSync(destination).isFile() || createHash('sha256').update(readFileSync(destination)).digest('hex') !== effect.hash) continue
      const member = relative(actualDirectory, realpathSync(destination))
      if (!member || isAbsolute(member) || member === '..' || member.startsWith(`..${sep}`)) continue
      expected.add(member.split(sep)[0])
    } catch { /* An inaccessible or changed output cannot justify a new directory member. */ }
  }
  return JSON.stringify([...expected].sort())
}
