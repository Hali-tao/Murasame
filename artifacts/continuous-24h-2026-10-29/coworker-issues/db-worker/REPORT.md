# Native database test worker crash — 2026-10-29

## Cause established by isolation

The installed **Node v22.19.0 Windows `fs.cpSync(source, target, { recursive: true })` crashes when these test paths contain Chinese characters**. The process exits with `0xC0000409` (unsigned `3221226505`, signed `-1073740791`). This diagnosis is supported by a minimal local reproduction; it does not assume resource exhaustion or attribute the failure to Electron/SQLCipher.

The crash occurs in the full-profile backup branch of `fresh-restart`, after two successful Electron invocations but before the third. A Vitest test only reports completion after that whole scenario, so the worker crash prevented all 13 scenario completion lines.

Evidence:

- `reproduce.cjs`, `default-temp.log`, `default-temp.markers.txt`: default TEMP, first Electron process PASS, second Electron process PASS, `cpSync` completes, restored Electron process PASS, exit 0.
- `unicode-temp.log`, `unicode-temp.markers.txt`: Chinese TEMP, first and second Electron processes PASS; marker stops at `before cpSync`; Node exits `-1073740791`. Therefore `execFileSync` itself is not the failing operation.
- `minimal-copy.cjs`: creates only a nested folder with one synthetic text file, without Electron, Vitest, native encryption, or a build step.
- `minimal-default.log`: that minimal copy succeeds and verifies the copied content, exit 0.
- `minimal-unicode.log`: the same minimal copy under Chinese TEMP stops at `before cpSync`, exit `-1073740791`.

Reproduction commands, working directory `E:/Desktop/软件工程/murasame`:

```powershell
node previews/coworker-issues-2026-10-29/db-worker/minimal-copy.cjs
$env:TEMP = (Resolve-Path previews/tmp).Path
$env:TMP = $env:TEMP
node previews/coworker-issues-2026-10-29/db-worker/minimal-copy.cjs
```

The marker script emits only its Node version, generated fixture paths, stage names, and boolean results. It never prints secrets, unrelated service command lines, or the full process environment.

## Narrow test-only repair

Only `tests/unit/database-recovery.test.ts` changed in this follow-up. Production data-layer files and `tests/electron/database-recovery-entry.ts` were not changed.

- Replaced native recursive `cpSync` with explicit directory traversal using `readdirSync`, `mkdirSync`, and `copyFileSync`.
- Copies every regular file and directory in the stopped temporary profile. Unexpected file types cause an error rather than silently skipping content.
- Added an independent directory/file inventory and SHA-256 comparison of source versus restored profile before the restored Electron process opens it.
- All original 13 scenarios, original key/data-preservation assertions, restart checks, and restored-profile readback assertions remain. No tests were skipped, no count changed, no assertion was relaxed.

## Verification

```text
npx vitest run tests/unit/database-recovery.test.ts tests/unit/native-encryption.test.ts --reporter=verbose
npx tsc --noEmit -p tsconfig.node.json
npx eslint tests/unit/database-recovery.test.ts tests/electron/database-recovery-entry.ts
```

- Chinese TEMP/TMP (`previews/tmp`): **15/15 tests, 2 files passed**, exit 0. `unicode-green.log`, started 20:13:35 local, 35.17s.
- Default TEMP/TMP: **15/15 tests, 2 files passed**, exit 0. `default-green.log`, started 20:14:33 local, 20.34s.
- Node typecheck: exit 0; `typecheck.log` is empty.
- Scoped ESLint: exit 0; `lint.log` is empty.
- Existing Vite future-config warning remains; no worker error or unhandled test error in either green run.

The parent can now run full `npm run verify` with Chinese TEMP/TMP. This agent did not run the full suite, build/package, commit, installer, or real user-profile operations.

## Diagnostic directories and cleanup boundary

No retry was made to remove the original 11 directories whose cleanup had been denied by automatic approval. No cleanup command was attempted for this follow-up's diagnostic fixtures. Successful ordinary test runs continue to remove only their own freshly allocated fixtures after the Electron child exits.

The parent's four earlier failure directories were inspected read-only: `IxmT1M` and `in84RU` were empty copy destinations; `MhknUL` and `kecaPK` contained 5/6 immediate entries respectively. They were not all empty, which is consistent with failure during the source-to-target copy.

This follow-up generated these eight diagnostic paths. At final read-only inspection, the four workspace paths remained and the four default-TEMP paths no longer existed; this agent did not delete them and does not infer why they disappeared.

Remaining:

```text
E:\Desktop\软件工程\murasame\previews\tmp\murasame-database-recovery-rV2HhX
E:\Desktop\软件工程\murasame\previews\tmp\murasame-database-recovery-CNWhaz
E:\Desktop\软件工程\murasame\previews\tmp\murasame-db-copy-source-uFFqdn
E:\Desktop\软件工程\murasame\previews\tmp\murasame-db-copy-target-ADRqeM
```

Generated but absent at final inspection:

```text
C:\Users\LENOVO\AppData\Local\Temp\murasame-database-recovery-MA7VhD
C:\Users\LENOVO\AppData\Local\Temp\murasame-database-recovery-QQvkU7
C:\Users\LENOVO\AppData\Local\Temp\murasame-db-copy-source-HKK9q2
C:\Users\LENOVO\AppData\Local\Temp\murasame-db-copy-target-02fLdh
```
