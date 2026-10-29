# Issue #2 database startup audit — 2026-10-29

Baseline: `4c52d2e`. Source/task audit only; no GitHub comment or issue closure. No application build, package, commit, push, user-profile access, or installer execution.

## Verdict and reproduction

The issue was **not fully fixed** at the baseline. The native tests use actual Electron, Windows safeStorage, electron-store, and better-sqlite3-multiple-ciphers against independently generated temporary profiles.

- Existing encrypted DB + missing `murasame-db-key.json`, `{}`, or `encryptedKey: null`: startup generated/persisted a replacement key and then failed with `file is not a database`.
- Existing DB + another valid encrypted key: startup failed with the same opaque SQLite message.
- Undecryptable key: startup told the user to delete the key file alone, which cannot recover the encrypted DB.
- Malformed JSON or decrypted key with invalid format: startup lacked preservation/recovery guidance.
- Main DB missing but WAL remaining: startup silently created a new DB; also reproduced with a valid key record present.
- Migration failure: a subsequent Windows rename of the DB failed with `EBUSY`, proving the failed open retained its SQLite handle.

The current Settings scope-clearing implementation does not delete DB/key files. Its native history/memory/cache clear and reopen passed at baseline. The user's exact uninstall → reinstall → clear → restart chain was not reproduced with a real installer, so it is not claimed fixed end-to-end.

## Changes (production freeze)

1. `src/main/data/keys.ts`: inspect persisted key record before electron-store can write defaults. Refuse missing-key startup when the DB exists; refuse recreation when only SQLite sidecars remain. Preserve malformed/undecryptable/invalid records without writing replacements.
2. `src/main/data/recovery.ts` (new): actionable recovery error with full profile path, original Windows-account guidance, and explicit need for the same complete backup including `Local State`, database/sidecars, and key JSON. Never instruct the user to delete just the key.
3. `src/main/data/cipher.ts`: read schema before migration writes to validate the key. Close failed connections; report key mismatch/corruption with preservation guidance.
4. `src/main/data/db.ts`: close the connection when migrations fail.
5. `tests/unit/database-recovery.test.ts` (new): native child-process harness with 13 scenarios and isolated parent-owned cleanup.
6. `tests/electron/database-recovery-entry.ts` (new): real SQLCipher/safeStorage assertions for preserved file bytes, no replacement key, restoration, clear/restart, and file-lock release.

No core, IPC, renderer, shared-type, installer, or docs/21 changes were made by this agent. Other agents have concurrent changes in those areas.

## Verification and evidence

Commands run from `E:/Desktop/软件工程/murasame`:

```text
npx vitest run tests/unit/database-recovery.test.ts --reporter=verbose
npx vitest run tests/unit/database-recovery.test.ts -t "orphan-journal-with-key|scoped-partial-clear-restart" --reporter=verbose
npx vitest run tests/unit/database-recovery.test.ts tests/unit/native-encryption.test.ts --reporter=verbose
npx tsc --noEmit -p tsconfig.node.json
npx eslint src/main/data/recovery.ts src/main/data/keys.ts src/main/data/cipher.ts src/main/data/db.ts tests/unit/database-recovery.test.ts tests/electron/database-recovery-entry.ts
```

- `red-verified.log`: baseline **9 failed, 2 passed**. The earlier `red.log` also had test cleanup errors because it tried removing an active Electron profile; that harness defect was corrected before the verified RED run.
- `partial-red.log`: added valid-key/orphan-WAL case failed before the added preservation guard; the partial-clear characterization passed.
- `green-final.log`: final **15 passed / 2 files**, 22.70s, exit 0, at 19:16:44 local time. This is 13 new recovery tests plus 2 existing native encryption tests.
- `typecheck.log` and `lint.log`: empty, corresponding command exit codes both 0.
- Existing Vite future-config warning appears in the native test run; no test failure.
- The parent owns full-suite, packaged-app, and review verification; those were deliberately not run here.

The final native run covers:

- Fresh profile, normal process exit, and a second Electron process reading the persisted secret.
- A copy of the complete stopped temporary profile (including verified `Local State`) restored to another independent temporary directory and opened by a new Electron process under the same Windows account.
- Missing key file, missing/null entry, mismatched key, undecryptable bytes, invalid decrypted key, and malformed JSON, all preserving original DB/key bytes, followed by restoration of the original key and successful secret readback.
- Main-file deletion leaving a WAL, both without and with a valid key record; no DB recreation and no sidecar/key mutation.
- Failed migration followed by successful Windows DB rename/restore and readback.
- Normal scoped memory/history/cache clear and complete Electron restart.
- A real SQLite trigger forcing memory-clear failure while history/cache clearing succeeds, followed by complete Electron restart: the uncleared memory remains and the key file is unchanged. This models a statement failure, not a full disk or installer failure.

## Shutdown discovery and limits

An intermediate harness used `app.exit()` and could not decrypt a newly created safeStorage value in the next process. Normal `app.quit()` persisted `Local State` and made the cross-process test pass. This was a harness correction, not a production shutdown change. It also motivated explicit complete-profile recovery guidance.

Preserving data cannot recover lost original secrets. No automatic reset, key regeneration over an existing DB, or destructive recovery action was added. Actual deleted/corrupted user data was never examined or claimed recoverable.

`build/installer.nsh` was inspected read-only. Its uninstall macro (lines 14–19) asks whether to delete data and then uses `RMDir /r "$APPDATA\\murasame-desktop"`. The custom macro does not itself check/report partial deletion failures. Actual installer uninstall/reinstall, deletion under another process's file locks, and a packaged UI backup/restore flow were **not** run. Native failed-open lock release and same-account temporary-profile backup restoration **were** run, which is a narrower claim.

## Retained initial test profiles

A shell cleanup of the first harness's temporary directories was rejected by automatic command approval with `blocked by policy`; no more specific reason was supplied. No alternative deletion mechanism was attempted. Read-only verification confirmed all 11 directories still exist. They contain test-generated data only. Subsequent runs remove their own profiles after the Electron child exits.

```text
C:\Users\LENOVO\AppData\Local\Temp\murasame-database-recovery-4eyFSf
C:\Users\LENOVO\AppData\Local\Temp\murasame-database-recovery-7pLii7
C:\Users\LENOVO\AppData\Local\Temp\murasame-database-recovery-A6PJmk
C:\Users\LENOVO\AppData\Local\Temp\murasame-database-recovery-DgUic3
C:\Users\LENOVO\AppData\Local\Temp\murasame-database-recovery-HIqurs
C:\Users\LENOVO\AppData\Local\Temp\murasame-database-recovery-l19gFq
C:\Users\LENOVO\AppData\Local\Temp\murasame-database-recovery-MtJvTh
C:\Users\LENOVO\AppData\Local\Temp\murasame-database-recovery-pUZPzx
C:\Users\LENOVO\AppData\Local\Temp\murasame-database-recovery-TtTyXN
C:\Users\LENOVO\AppData\Local\Temp\murasame-database-recovery-VuJHav
C:\Users\LENOVO\AppData\Local\Temp\murasame-database-recovery-yBBEHK
```
