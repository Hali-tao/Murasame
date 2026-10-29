# Memory recall diagnostic evidence

Status: diagnosis complete; production retrieval unchanged; original city/Rust misses remain unresolved.

- `original-fixture.json`: unchanged snapshot of the original 22-question fixture.
- `holdout.json`: 18 independent synthetic facts, 38 positive queries, 16 negative queries, fixed before observing the experiment.
- `diagnose.mjs.txt`: runnable experiment source. Copy to a fresh directory under `previews/` as `diagnose.mjs`, alongside both fixture JSON files.
- `diagnostic-plain-vs-prefix.json`: actual local BGE paired results, source/fixture/model hashes, environment, every returned ID, score, and measured query latency. No network requests. Current encoding 17/19 and 35/38; prefix 15/19 and 30/38. Both variants fail quality targets.
- `identifier-check.mjs.txt` and `identifier-baseline.json`: 24 independent synthetic project identifiers × 4 query forms; current production recall 96/96. No unknown-identifier negative evaluation.
- `threshold-sensitivity.mjs.txt` and `threshold-sensitivity.json`: counterfactual thresholds over stored real-model scores; production threshold remains 0.45. Independent negative intrusion grows from 1/16 at 0.45 to 6/16 at 0.40 and 14/16 at 0.30.
- `scoped-tests.txt`: four memory test files, 87 passing tests; existing Vite and SQLite warnings retained.
- `archive-replay.txt`: a fresh replay from the archived `.mjs.txt` sources and fixture copies, with matching aggregate results and zero network attempts.

The `.txt` suffix keeps archived script sources out of executable/lint inputs. No generated runtime bundle is archived. Full interpretation, scope limits, exact reproduction commands, and next experiments are in [`docs/22-MEMORY-RECALL-DIAGNOSTIC.md`](../../../docs/22-MEMORY-RECALL-DIAGNOSTIC.md).

This archive contains only synthetic data. Positive hit counts do not measure full ranking precision or answer quality. General output style and large-text preferences are allowed for negative cases; all other returned personal facts count as negative intrusions. Original positive cases do not have complete forbidden labels. Script exit success verifies infrastructure, not semantic target completion.
