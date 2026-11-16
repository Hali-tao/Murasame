import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import assert from 'node:assert/strict'
import { getMakeNsisPath, getNsisPluginsPath } from 'app-builder-lib/out/toolsets/windows.js'

// Compile the real uninstall hook with ONLY its fixed data-directory literal redirected.
// The fixture has no install registry entries, shortcuts, or real application payload.
const mode = process.argv[2] ?? 'build'
const runName = process.argv[3]
assert.match(runName ?? '', /^[a-z0-9-]+$/)
const base = resolve('previews/uninstall-policy-2026-10-29'), run = resolve(base, runName)
assert.ok(run.startsWith(base + sep))
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const macroSource = 'build/installer.nsh'
const files = ['murasame.db', 'murasame-db-key.json', 'Local State', 'logs/synthetic.txt']
if (['build', 'build-remove', 'build-keep'].includes(mode)) {
  assert.ok(!existsSync(run), 'Use a new fixture directory; never overwrite prior evidence')
  mkdirSync(run, { recursive: true })
  const original = readFileSync(macroSource, 'utf8')
  const originalCleanup = readFileSync('build/remove-profile.ps1', 'utf8')
  const originalPath = "(Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'murasame-desktop')"
  assert.ok(originalCleanup.includes(originalPath), 'Production data path must be explicit')
  const isolatedCleanup = originalCleanup.replace(originalPath, `'${join(run, 'murasame-desktop').replaceAll("'", "''")}'`)
  assert.ok(!isolatedCleanup.includes("GetFolderPath('ApplicationData')"))
  writeFileSync(join(run, 'remove-profile.ps1'), isolatedCleanup)
  // Only the interactive choice is automated; all cleanup code is unchanged.
  const choice = mode === 'build' ? original : original.replace(/^ {2}MessageBox MB_YESNO.*$/m, mode === 'build-remove' ? '  Goto removeData' : '  Goto keepData')
  const isolated = choice.replace(/^ {6}MessageBox MB_OK.*$/m, '      FileOpen $R0 "$EXEDIR\\cleanup-error.txt" w\n      FileWrite $R0 "$0: $1"\n      FileClose $R0')
  assert.ok(!isolated.includes('$APPDATA'), 'Fixture must never refer to the real profile')
  writeFileSync(join(run, 'hook.nsh'), '\uFEFF' + isolated)
  for (const name of files) {
    const file = join(run, 'murasame-desktop', name)
    mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, `synthetic-only ${runName} ${name}\n`)
  }
  const stdUtils = resolve('node_modules/app-builder-lib/templates/nsis/include/StdUtils.nsh')
  writeFileSync(join(run, 'StdUtils.nsh'), readFileSync(stdUtils))
  const nsis = await getMakeNsisPath()
  const plugins = join(await getNsisPluginsPath(), 'x86-unicode').replaceAll('\\', '/')
  const script = [
    'Unicode true', 'RequestExecutionLevel user', 'Name "Murasame isolated uninstall test"',
    'OutFile "generator.exe"', 'AutoCloseWindow true', 'ShowInstDetails nevershow',
    '!include "LogicLib.nsh"', '!include "StdUtils.nsh"', `!addplugindir "${plugins}"`,
    // Same flag predicate emitted by the installed electron-builder.
    '!macro _isUpdated _a _b _t _f', '  ${StdUtils.TestParameter} $R9 "updated"',
    '  StrCmp "$R9" "true" `${_t}` `${_f}`', '!macroend', '!define isUpdated `"" isUpdated ""`',
    `!define BUILD_RESOURCES_DIR "${run}"`,
    '!include "hook.nsh"', 'UninstPage instfiles',
    'Section', `  WriteUninstaller "${join(run, 'fixture.exe')}"`, 'SectionEnd',
    'Section "Uninstall"', '  SetAutoClose true', '  !insertmacro customUnInstall',
    '  FileOpen $0 "$EXEDIR\\completed.txt" w', '  FileWrite $0 "hook returned"', '  FileClose $0', 'SectionEnd'
  ].join('\n')
  writeFileSync(join(run, 'fixture.nsi'), '\uFEFF' + script)
  const compiler = nsis.path
  let output
  try { output = execFileSync(compiler, ['-V3', '-INPUTCHARSET', 'UTF8', '-'], { cwd: run, input: script, encoding: 'utf8', timeout: 30_000, env: { ...process.env, ...nsis.env } }) }
  catch (error) { writeFileSync(join(run, 'compile-failed.txt'), `${error.stdout ?? ''}\n${error.stderr ?? ''}`); throw error }
  writeFileSync(join(run, 'compile.txt'), output)
  execFileSync(join(run, 'generator.exe'), ['/S'], { cwd: run, timeout: 30000, windowsHide: true })
  const receipt = { source: macroSource, sourceSha256: hash(Buffer.from(original)), cleanupSha256: hash(Buffer.from(originalCleanup)), isolatedSourceSha256: hash(Buffer.from(isolated)), compiler, files: files.map(path => ({ path, sha256: hash(readFileSync(join(run, 'murasame-desktop', path))) })) }
  writeFileSync(join(run, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n')
  console.log(JSON.stringify({ run, compiled: true, scope: 'Isolated production hook, no real installer/registry/profile operations' }))
} else if (mode === 'run') {
  const args = process.argv.slice(4)
  assert.ok(args.every(arg => ['/S', '--updated'].includes(arg)))
  // Prevent NSIS from relaunching a detached temp copy, so exit really means finished.
  const child = spawn(join(run, 'fixture.exe'), [...args, `_?=${run}`], { cwd: run, windowsHide: true, windowsVerbatimArguments: true, stdio: 'ignore' })
  writeFileSync(join(run, 'process.json'), JSON.stringify({ pid: child.pid, args, at: new Date().toISOString() }, null, 2))
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; child.kill() }, 30000)
  child.on('error', error => { clearTimeout(timer); throw error })
  child.on('exit', code => {
    clearTimeout(timer)
    writeFileSync(join(run, 'exit.json'), JSON.stringify({ code, timedOut, at: new Date().toISOString() }))
    console.log(JSON.stringify({ runName, code, timedOut }))
    if (code !== 0 || timedOut) process.exitCode = 1
  })
} else if (mode === 'check-removed') {
  assert.ok(existsSync(join(run, 'completed.txt')))
  assert.ok(!existsSync(join(run, 'cleanup-error.txt')), 'NSIS cleanup failed: see cleanup-error.txt')
  assert.ok(!readdirSync(run).some(name => name === 'murasame-desktop' || name.startsWith('murasame-desktop.uninstall-backup-')))
  console.log(JSON.stringify({ runName, removed: true }))
} else if (mode === 'check') {
  const receipt = JSON.parse(readFileSync(join(run, 'receipt.json'), 'utf8'))
  const changed = receipt.files.filter(({ path, sha256 }) => {
    const file = join(run, 'murasame-desktop', path)
    return !existsSync(file) || hash(readFileSync(file)) !== sha256
  }).map(item => item.path)
  const result = { runName, completed: existsSync(join(run, 'completed.txt')), changed, preserved: changed.length === 0, retainedEntries: existsSync(join(run, 'murasame-desktop')) ? readdirSync(join(run, 'murasame-desktop')) : [] }
  writeFileSync(join(run, 'check.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result))
  assert.equal(result.completed, true, 'The hook did not finish; it may be blocked on a dialog')
  assert.deepEqual(changed, [], 'Default/silent/update must preserve all profile data')
} else throw new Error('Unknown mode')
