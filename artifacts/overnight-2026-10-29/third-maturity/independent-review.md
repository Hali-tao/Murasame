# Independent review — third overnight increment

Baseline: `e10f25fbe1ccf030d3bb303f62c9d8cff89e475f`. Reviewed current uncommitted production changes plus the new task-root/system-folders helpers, directory UI/IPC wiring, focused tests, and native ticker evidence script. Old untracked artifacts excluded. No production files changed; no provider calls or user data used.

## [P2] Keep full-library vector rebuilding off the chat response path

Location: `src/main/core/services/memory-service.ts:79–82` (serial loop at lines 93–96); downstream blocking consumer: `src/main/core/services/conversation-service.ts:185`.

When the local embedding model returns after being unavailable, or the embedding stamp invalidates the existing vectors, `recall()` starts `rebuildMissingVectors()` and waits for every missing active fact to finish embedding, serially. ConversationService awaits that recall before `onStart` and before invoking the chat gateway. The first ordinary message therefore waits for an unbounded number of unrelated CPU embeddings; later messages in its conversation queue wait behind it. A single unresolved fact embedding stalls the response indefinitely. This is a new regression from adding a full-library awaited rebuild; the previous response path needed only the query embedding.

Observed controlled reproduction: actual MemoryService with 100 synthetic facts saved while the embedding boundary returns null. Make query embedding immediately available, then release each fact embedding separately. There are 101 embedding calls in total. Recall stays unresolved through the first 99 fact completions, then resolves only after fact 100. The probe asserts that exact behavior. A separate expected-behavior assertion fails with `Recall must not await unrelated missing-vector rebuilds`, actual false / expected true.

Evidence:
- `previews/tmp/third-review-memory-probe-builder.mjs` builds actual MemoryService with only the local embedding boundary controlled.
- `previews/tmp/third-review-memory-probe.mjs` reproduces and verifies whole-library blocking.
- `previews/tmp/third-review-memory-red.mjs` is the failing expected-behavior probe.
- `previews/overnight-2026-10-29/third-independent-memory-red.log` records that assertion failure.

Suggested correction: run single-flight reindexing outside the current recall critical path with bounded scheduling and generation/deletion checks; return currently available recall with a truthful degraded/indexing state. Report progress separately. A pending rebuild must not prevent current conversation generation or clearing/disabling memory from taking effect.

This is a deterministic control-flow reproduction, not a measured production ONNX performance result. No claim about exact seconds/minutes on real hardware is made.

No additional concrete actionable regression was found in the reviewed task directory/approval/unknown-write guard changes or Live2D ticker ownership/lifecycle changes. That statement is limited to this review, not full product acceptance.

## Fix verification — 2026-10-29 03:59 Asia/Shanghai

**Original P2 closed. No new actionable defect found in the reviewed fix and progress wiring.**

Re-read the revised background index job, per-fact persistence, cancellation/deadline handling, bootstrap snapshot, IPC broadcast, preload event, renderer store update, and MemoryPage progress display. Recall now computes the current result and starts a separate single-flight index job without awaiting the library rebuild. Each fact write rechecks its current active ID after the asynchronous work; clear/delete/source/policy cancellation aborts the job and discards late results. A timed-out native embedding remains tracked until settlement, so another background retry cannot overlap it. Completed vectors persist incrementally and survive subsequent failure/restart. The 16-fact event-loop yields and 30-second job deadline bound a pass; remaining work is retried on a later recall, consistent with the displayed message.

Independent verification executed against the revised source:
- `previews/tmp/third-review-memory-green-builder.mjs` bundles actual MemoryService with only local embeddings controlled. With **100 missing facts**, recall returned degraded before the first pending fact embedding completed. Clearing then releasing the late embedding produced **no resurrection and no subsequent fact call**. Output: `third-independent-memory-green.log`.
- `conversation-memory-maturity.test.ts`, `store.test.ts`, and `core-memory-status-regression.test.ts`: **3 files, 45 tests passed**. Includes the 41 service cases covering timeout/retry, overall deadline, persistence failure/restart, cancellation, late results, extraction and conversation boundaries. Log: `third-independent-recheck-tests.log`.
- `chat-conversation-regression.test.ts`: **1 file, 8 tests passed**, including live index state/progress rendering through the event/store boundary. Log: `third-independent-recheck-ui.log`.

All review execution used the project's E-drive temporary directory and synthetic facts/databases; no user data, provider calls, production edits, commit, or push. The green probe is not a real ONNX throughput benchmark, and these focused checks do not replace the root agent's final full verification/build/Electron acceptance.
