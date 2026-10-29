# Recall status evidence

- unit-red.txt: 18 new failures against pre-implementation code, 63 prior passes.
- old-package-red.txt / old-package-e2e/: prior delivered package lacks visible status; expected failure.
- unit-green.txt: 119 targeted passes before reviewer correction.
- package-e2e.txt / package-e2e/: first UI candidate, 32 passes, visual spacing issue found manually.
- package-e2e-final.txt / package-e2e-final/: layout-adjusted candidate, 32 passes. The word final in this historical directory predates the independent review; it is NOT the delivered package.
- review.md: one independent review, Important cancellation bug, one correction pass and explicit scope rulings.
- cancelled-recall-red.txt: four new real-service/SQLite race cases failed; filtered tests intentionally skipped.
- cancelled-recall-green.txt: 123 targeted passes after cancellation correction.
- verify-final.txt: post-correction full 68 files / 868 tests, typecheck/lint/74 trace mappings.
- rejected-package-*: artifact integrity failure and aborted E2E. The rejected package included a concurrently rebuilt native test harness, shifting ASAR entry data by 205 bytes. 15 failures recorded before stopping; this was not a completed test suite. Preserved only as failure evidence.
- package-e2e-verified.txt / package-e2e-verified/: final sequential rebuild after excluding native test programs, 32 passes, zero skipped, 4.3 minutes. This is the delivered application evidence.
- package-receipt.json / package-resource-check.txt: final runtime resource hashes, no native test programs, 18 model files, 6 isolation files, 14 older installers including rejected artifact preserved.

Only release/continuous-2026-10-29-memory-recall-status-verified/Murasame-Setup-0.9.0.exe is the final delivery candidate. It has not overwritten the real installation. E2E uses fresh synthetic profiles and controlled local model HTTP responses; real BGE and Docker execution are exercised. This does not establish external model answer quality, semantic recall accuracy, full installer lifecycle, or complete SRS acceptance.

Native test verification writes under out/electron-tests. Run verification before packaging; do not parallelize these commands. The shipping file filter now excludes these native test harnesses.
