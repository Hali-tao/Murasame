import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { extractFile } from '@electron/asar'
import assert from 'node:assert/strict'

const root = process.cwd()
const output = resolve('release/overnight-2026-10-29-fifth-final')
const resource = join(output, 'win-unpacked/resources')
const archive = join(resource, 'app.asar')
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const walk = path => readdirSync(path, { withFileTypes: true }).flatMap(item => item.isDirectory() ? walk(join(path, item.name)) : [join(path, item.name)])
const code = ['main', 'preload', 'renderer'].flatMap(folder => walk(join(root, 'out', folder))).map(file => {
  const path = relative(root, file).replaceAll('\\', '/')
  const expected = hash(readFileSync(file)); const actual = hash(extractFile(archive, relative(root, file)))
  assert.equal(actual, expected, path)
  return { path, sha256: actual, matchesVerifiedBuild: true }
})
const models = walk(join(root, 'build/bundled-models')).filter(file => !relative(join(root, 'build/bundled-models'), file).startsWith('.')).map(file => {
  const path = relative(join(root, 'build/bundled-models'), file).replaceAll('\\', '/')
  const packed = join(resource, 'models', path)
  const expected = hash(readFileSync(file)); const actual = hash(readFileSync(packed))
  assert.equal(actual, expected, path)
  return { path, sha256: actual, bytes: statSync(packed).size, matched: true }
})
assert.equal(models.length, 18)
const isolation = walk(join(root, 'isolation')).map(file => {
  const path = relative(join(root, 'isolation'), file).replaceAll('\\', '/')
  const actual = hash(readFileSync(join(resource, 'isolation', path)))
  assert.equal(actual, hash(readFileSync(file)), path)
  return { path, sha256: actual, matched: true }
})
const installers = ['release/Murasame-Setup-0.9.0.exe', 'release/overnight-2026-10-29-verified/Murasame-Setup-0.9.0.exe', 'release/overnight-2026-10-29-fifth-final/Murasame-Setup-0.9.0.exe'].map(path => ({ path, bytes: statSync(path).size, sha256: hash(readFileSync(path)) }))
assert.equal(installers[0].sha256, '324a7b8735ad1e11aa0c4f3e72fcc3d8458ec353e7679a416867f6df51016c2e')
assert.equal(installers[1].sha256, '597bc6e41dbe73d4e5e2b6ff61c809c90761eea7af111eab31a21e6e3cc4f6aa')
const receipt = { at: new Date().toISOString(), output, asarSha256: hash(readFileSync(archive)), code, models, isolation, installers }
writeFileSync('artifacts/overnight-2026-10-29/fifth-creation-native/package-receipt.json', JSON.stringify(receipt, null, 2))
console.log(JSON.stringify({ codeFiles: code.length, models: models.length, isolationFiles: isolation.length, installers }, null, 2))
