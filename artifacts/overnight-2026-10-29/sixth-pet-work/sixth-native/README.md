# Sixth-round native WorkingLoop evidence

This is an upgrade to the existing native nailong moc3. No new art, mesh, rig, walking, independent raised-arm motion or 3D model is claimed. The runtime is the production React `Live2DPet`, Pixi, bundled Cubism Core and the original physics. Hidden Electron profiles and all temporary data are local to `previews/tmp`.

## Concrete change

The original `Working` asset and its neutral ending remain unchanged. The new `WorkingLoop` is a twelve-second sustained reading posture: lightly gathered hands stay settled, breathing continues independently, gaze scans and the head settles more slowly, and two blinks are spaced through the period. The periodic source curves match value and velocity at their endpoints. The root task owns actual activity-state playback and SDK loop activation through the new `activityMotion` prop.

The existing SDK parses `Meta.Loop` but does not activate it. The baseline actual component started `Working` once and returned to `Idle` after six seconds. The current component started `WorkingLoop` once and kept it active for the full twenty-six-second recording, with `isLoop() === true`.

## What to view

- `working-before-after.mp4`: 26 seconds, 1280×640, 30 fps. Left is baseline; right is sustained native work. Both sides are actual model captures, with only labels and side-by-side video layout added.
- `working-before-after-12s.png`: a decoded frame from that video.
- `before/working.mp4`: baseline `f94e56b`, original single Working response.
- `final-current/working.mp4`: final component's sustained work and original native rendering.
- `after/`: complete reference pass covering actual white-cat/whale-girl idle and nailong WorkingLoop, Think, Greet and Agree, with raw parameter/mesh traces and screenshots.
- `final-current/`: final focused extended pass covering more than two work periods, transient response recovery, 8 fps, remount, thought, work resume and cancellation. Its component and director source SHA match the current files and exact runtime source is saved as `.txt`.
- `diagnostic/`: earlier passing focused pass retained for the low-fps peak-frame investigation.

The captures were visually inspected at three, twelve and twenty-four seconds and after cancellation, transient recovery, low-fps playback and reload. Hands stay lightly gathered through repeats and settle down after cancellation; feet stay grounded, the original body remains continuous, and the author mark remains visible.

## Measured results

| Check | Actual result |
| --- | --- |
| Baseline Working after 26 s | Idle; SDK loop false |
| Current work after 26 s | WorkingLoop; SDK loop true; one start event |
| Peak mesh step near 12/24 s boundaries | 0.00027424 normalized model units |
| Greet finishes and restores work | WorkingLoop; maximum transition step 0.00558010 |
| 13 s at requested 8 fps | 103 model updates; WorkingLoop stays active |
| Maximum 8 fps mesh speed | 0.379916 normalized model units/s |
| Remount with current activity | WorkingLoop restored |
| Work → Think | Maximum step 0.00447112 |
| Think → work | Maximum step 0.00817402 |
| Cancel → Idle | Maximum step 0.00517511 |
| Original three-character shape/physics/motion/expression assets | 89/89 SHA-256 unchanged from f94e56b |

Raw results: `final-current/loop-and-transitions.json`, `final-current/low-fps-samples.json`, `diagnostic/low-fps-peak.json`, `original-assets-preserved.json` and each pass's `report.json`. The latest source snapshots are component SHA `0ce12d4ce6161330f32801f2f3b18a46ebc39c42f010724c99a8c4c908db40f4` and director SHA `0ac259becd6320d3661744b93d4311d055227647378c0cdaef04966428fc6b96`.

The first extended pass in `final/` was intentionally retained as an incomplete diagnostic, marked `NOT-FINAL.txt`. Its fixed per-frame bound mixed the 8 fps sampling interval with 60 fps sampling. The actual peak frame spans 133.33 ms and closes the eyes from 1 to 0.031/0.136, with tiny head changes. The corrected check compares mesh velocity against the same 60-fps envelope, keeping the unchanged motion and preserving the original failure log (`final-run.log`). Both `diagnostic/` and the subsequent latest-source `final-current/` pass; do not present the incomplete `final/` folder as final acceptance.

## Tests and scope

`test-red.log` records the four new asset regressions failing because no continuous work asset existed. `test-green.log` records all four new and twenty original asset tests passing (24/24). The new tests load the actual moc3, sample real curves, enforce parameter bounds and noncompeting physics, validate periodic position/velocity continuity, preserve attentive hands through the boundary, and verify ongoing breathing and complete blinks. Targeted lint passed.

The existing `scripts/fifth-native-motion.mjs` was rerun against the final component as `sixth-final`: all 31 original three-character/priority/transition checks passed, with no runtime errors. Its report is copied here as `fifth-component-regression.json`; original screenshots and full trace remain under `../fifth-native/sixth-final/`.

An intermediate full-unit run (`full-unit.log`) was made while other agents were in their red stage: 717/721 passed, with three missing `onStatusChanged` bridge failures and the then-unsynchronized capability count. This is not final whole-project acceptance. Root owns the final frozen full suite and package verification.

## Reproduce

```text
node scripts/sixth-native-working-build.mjs
npx vitest run tests/unit/sixth-native-working-loop.test.ts tests/unit/nailong-motion-assets.test.ts
node scripts/sixth-native-motion.mjs before f94e56b
node scripts/sixth-native-motion.mjs after
```

Set TEMP/TMP to `previews/tmp`. For an independent work-only extended pass, set `SIXTH_NATIVE_WORK_ONLY=1` and use another output label. The harness's generated `component.js`, `main.cjs` and `index.html` are disposable runtime files in ignored previews. Archive source as `.txt` snapshots or inside a ZIP if needed; do not put generated bundles into the linted source/artifact tree.
