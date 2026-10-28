# Final independent review — grounded source summary

Reviewed 2026-10-29 against base `4e9244951315dfefcebe6a3f2c5cce04a7e7aed6`: current integration diff plus every new source/test file listed in review-package.md. Read the implementation plan, ledger, overnight constraints and relevant surrounding task/gateway/filesystem code. Implementation remained frozen. No code, tests, index, HEAD or branch were changed by this reviewer.

## Assessment

One actionable P2 recovery finding remains. Fix before integration. No additional correctness or privacy defect was established in the inspected scope.

## Finding

### [P2] Reconcile an unresolved summary write before replacing its workflow

**Location:** `src/main/core/services/task-service.ts:565–573`, with the bypass completed by `:592–596` (best inline anchor: 592).

**Trigger:** A summary is interrupted after persisting its `writing` checkpoint with `outcomeKnown: false`. The target contains partial or conflicting bytes. After restart, the user supplies a new instruction instead of exactly `继续`; the planner returns an ordinary filesystem plan without `workflow`.

**Actual behavior:** `continueTask` excludes summary-write receipts from the generic unknown-effect check based on the old plan, and does not inspect `task_grounded_checkpoints` in that check. It then saves the replacement plan before calling `groundedOptions`. Because the new plan has no workflow, `groundedOptions` returns `{}` and `executeGroundedSummary` never reconciles the previous write. The new plan can receive approval and complete while the old persisted checkpoint still says `writing` / `outcomeKnown: false`. The unresolved original target is no longer represented in the task's current steps/results and subsequent ordinary continuations cannot reach its dedicated recovery path.

**Impact:** The same task can report completion while a previous potentially partial write remains unresolved and unreported, violating the stated recovery rule that unknown write effects must be reconciled before changing/replaying a task. The normal source-to-source workflow-change guard does not cover this workflow-to-ordinary transition.

**Independent reproduction:** Used in-memory SQLite, controlled planner/generator callbacks, and a disposable directory beneath the required TEMP/TMP location. Generated B, persisted a simulated interrupted `writing` checkpoint, put conflicting bytes at `summary.md`, restarted TaskService, and supplied an instruction whose controlled planner returned a normal write to `different.md`. No external service was called. Observed:

```json
{"continued":true,"status":"等待批准","checkpoint":"writing"}
{"finalStatus":"已完成","newFile":true,"oldOutput":"Partial or conflicting old write","oldOutcomeKnown":false}
```

**Minimal correction:** Inspect the persisted grounded checkpoint before saving any replacement plan. If it has unresolved write effects, preserve the old plan and require/reconcile the old target under its original workflow first, regardless of whether the proposed replacement uses a workflow. A narrow acceptable correction is to reject non-resume replanning while `outcomeKnown` is false and direct the user to reconcile the original task; keep the existing `继续` recovery path available. Add a regression that attempts a workflow-to-ordinary replan with a `writing`/unknown checkpoint and verifies no new plan approval/execution or loss of original recovery context.

## Independent verification

- Ran the three grounded unit suites with TEMP and TMP set to `E:/Desktop/软件工程/murasame/previews/tmp`: **3 files, 42 tests passed**.
- Inspected the real-loopback Electron tests and the supplied validation evidence; did not treat those as an independently rerun full Electron suite.
- Independently reproduced the additional recovery edge above without persistent fixture files or real provider/user data.
- Reviewed source metadata-before-approval behavior, bounded snapshot reads, quoted citation checks, stage envelopes, fixed-model dispatch controls, cancellation/timeout wrapping, write/hash recovery, full draft text presentation, and pet review routing.

## Declined to judge

- Semantic truth/completeness of arbitrary model-generated summaries; deterministic quotation/hash checks do not establish semantic accuracy, and the implementation/UI correctly disclose that boundary.
- Real provider quality, latency, pricing, or account behavior; all independent checks used local controlled callbacks only.
- Full Electron rerun, installer/package behavior and live external-model behavior; those remain integration-owner checks.
- General multi-agent/office/programming capability and unrelated legacy untracked artifacts; outside this increment.
- Adversarial kernel/filesystem actors capable of racing native calls or corrupting the trusted local database; no security claim against those actors was made by this review. The recovery fixture only represents a legitimate interruption state, not database corruption as an attack model.

## Integration resolution (root, after the independent review)

Accepted the P2 finding. Added a real TaskService/SQLite/temp-files regression that changed an unknown writing checkpoint into an ordinary replacement plan; observed failure before the fix. `continueTask` now checks the persisted grounded receipt before any plan replacement and blocks changing the workflow while its write outcome is unknown. The original plan remains available for explicit reconciliation. The final full verification passed 518 tests, typecheck, lint and trace. Both summary Electron tests were rebuilt and rerun successfully. This is the integration owner's verified resolution, not a second independent review.
