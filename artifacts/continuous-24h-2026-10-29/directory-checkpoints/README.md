# Directory checkpoint recovery evidence

Baseline: 5cc5c282ea1b65e9bd63bf75d4b16d45a24a2c34. Character work remains paused. All runtime fixtures are synthetic and independent of the real user profile.

- `unit-red.txt` includes an incorrectly arranged source-read fixture; `unit-red-corrected.txt` is the corrected genuine reproduction (7 failed, 10 passed).
- `e2e-old.txt` and `e2e-old/`: previous delivered package, 1 failed / 1 passed; own additions failed, external additions were already blocked.
- `review.txt`, `reviewed-diff.txt`, `review-fix.diff.txt`, and review RED/GREEN logs distinguish the independent review from the author's one fix pass.
- `verify-initial.txt` / `verify-pre-review.txt`: intermediate 897-test checks; `verify-final.txt`: 901-test check after prerequisite compatibility fix.
- `verify-after-harness.txt`: later test-harness lint failure, not a product failure. `verify-after-harness-final.txt` was interrupted by a tool/runtime connection reset during the test run and has no completion result. `verify-reconnected.txt` plus `verify-exit.txt` record the subsequent complete check; only a zero exit is accepted.
- `package-e2e.txt` / `package-e2e/`: first current-package full run, 34 passed / 1 failed. Directory scenarios passed. Notification timing assertion failed; do not describe this run as fully green.
- `notification-repeat*`: original notification assertion, 2 failed / 1 passed. Diagnostic versions and their raw output are preserved separately.
- `notification-diagnostic*`: renderer timer / DOM observations and host timing. Timers removed toasts around five seconds; some received page samples were about five seconds old. A host polling alternative also failed and was not adopted.
- `notification-no-speech*`: first attempt used a nonexistent settings.patch method (diagnostic defect). Corrected settings.update trials both passed with maximum sampled transport differences 13ms and 3ms. This associates the delay with automatic speech, but does not identify the exact blocking model-load or inference segment.
- `notification-observed*`: corrected original notification check observes real DOM removal in the renderer before sending, retaining the eight-second UI deadline and default automatic speech; 3 passed. This is a measurement correction, not a speech performance fix.
- `package-e2e-final.txt` / `package-e2e-final/` / `package-e2e-final.json`: full rerun interrupted by Docker Desktop's startup failure at its inaccessible runtime socket. Its failures are retained, not accepted as a green suite.
- `docker-error-summary.txt`, runtime inventory, stop/recovery logs and recovery script document the environment issue. Two stopped-Desktop runtime directories containing only named zero-byte sockets were renamed to preserved siblings after exact path and contents checks. No persistent Docker workload data, WSL distribution or VM disk was deleted; no factory reset was used. Recovery approach reference: https://github.com/docker/desktop-feedback/issues/554 .
- `package-e2e-recovered.txt` / `package-e2e-recovered/` / `package-e2e-recovered.json`: complete rerun after environment recovery, including a recorded actual-toast-expiry attachment. Only this run with exit zero and 35 expected / zero skipped, unexpected or flaky tests is the final package flow gate.
- `package-receipt.json`: current packaged bytes / five source-and-test fingerprints; `package-receipt-before-harness.json` preserves the earlier source list. The installer bytes are unchanged by the test-only timing correction.
- `cleanup-check.json`: read-only process / container / fixture inventory, no broad deletion.

The package is exercised directly without installing over the user's profile. Controlled model HTTP replies verify transport and flow, not real external model answer quality. Actual local BGE and real Docker office/code execution remain in the full suite. Full SRS acceptance, speech cold-start responsiveness, directory move/delete/edit lineage, semantic memory gaps, full install/upgrade/uninstall, and all-day stability are not declared complete.

`raw-text-evidence.zip` preserves original text bytes; the archive manifest records both original and normalized text hashes. Diagnostic scripts are archived with a `.txt` suffix, not shipped as product code.
