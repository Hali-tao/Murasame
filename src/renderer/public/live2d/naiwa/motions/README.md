# Native Nailong motions

These motion3 files drive the existing `../奶蛙.moc3` through its original Cubism rig and physics. No texture, mesh, moc3, physics or expression asset is replaced. The original author attribution stays visible. This addition does not grant additional rights to redistribute the character.

| Group | Duration | Intended response |
| --- | ---: | --- |
| `Idle` | 8.0 s | Low amplitude breathing, asymmetrical gaze and weight shift, blink |
| `Greet` | 2.8 s | Small anticipation, welcoming lean, hands softly gathering |
| `Think` | 4.8 s | Held upward glance and head tilt, hands settle together |
| `Agree` | 2.4 s | Two nods with decreasing amplitude |
| `Confused` | 3.2 s | Searching glance and two unequal tilts |
| `DragLeft` / `DragRight` | 1.8 s | Directional balance response and damped counter-sway |
| `Working` | 6.0 s | Reading gaze, relaxed forward posture and breathing |
| `Comfort` | 4.2 s | Slower lean and gentle nod |

`LegacyIdle` still refers to the original `hahaha.motion3.json`. All nine new motions are distinct, portable Cubism motion3 assets. `Idle` and `Working` advertise looping; the application's motion manager owns actual playback and cancellation.

## Runtime contract

- Play the named motion with no expression overlay. In particular, `sikao` changes an opacity-only arm parameter and is not needed by the new thinking animation.
- The model's original physics remains enabled. It owns `Paramyt3/4/5/6/7/8/9/10/11/12`, `ParamAngleX4/5` and `ParamBodyAngleX2/Y2/Z2`.
- Disable the library's stock `breath` and automatic blink while these complete native motions are playing. The curves already author breathing and eyes. The stock breath also adds unrelated head rotations, not just breathing.
- Avoid competing writes to the same head/eye parameters. Pointer focus can be reduced during reactions; voice mouth movement has higher priority while speaking.
- Use actual motion completion rather than an arbitrary timeout. All groups share the same neutral source values and retain a short neutral tail while fading out.
- The large hands-to-belly pose has a 1 s per-curve fade-in. Head source channels have at least a 0.45 s fade-in. These reduce rapid reversal when one action interrupts another without suppressing the original physical follow-through.

## Measured model capabilities

The bundled Cubism Core reports 48 parameters. Effective independent source channels are `ParamAngleX/Y/Z` in `[-30,30]`, `ParamEyeBallX/Y` in `[-1,1]`, `ParamMouthForm` in `[-1,1]`, `ParamMouthOpenY` in `[0,1]`, `ParamEyeLOpen/ROpen` in `[0,1]`, `ParamBreath` in `[0,1]` and `Paramyt13` in `[0,1]`. Defaults are zero except open eyes, whose default is one.

The unsuffixed `ParamBodyAngleX/Y/Z`, eyebrow, smile, cheek, hair and leg template parameters do not deform vertices or opacity in the supplied moc3. Large independent arm waving and articulated walking therefore cannot be honestly promised from this rig. The new motions use native arm gathering and the existing delayed shoulder/abdomen response.

## Reproduce evidence

Run from the repository root, with `TEMP` and `TMP` pointing to `previews/tmp` on the workspace drive:

```text
node scripts/nailong-motion-probe.mjs
node scripts/nailong-motion-build.mjs
npx vitest run tests/unit/nailong-motion-assets.test.ts
node scripts/nailong-motion-render.mjs LegacyIdle
node scripts/nailong-motion-render.mjs all
node scripts/nailong-motion-quality.mjs
node scripts/nailong-motion-render.mjs interrupt
node scripts/nailong-motion-render.mjs video
```

The render harness opens an isolated hidden Electron instance. It uses the original moc3 and texture, bundled Cubism Core and installed `pixi-live2d-display`, advances original physics at 60 Hz, and exports native screenshots, numeric mesh traces and a deterministic 30 fps MP4. Video encoding requires `ffmpeg` on `PATH`; it only encodes the captured native frames.

Evidence is written to `previews/overnight-2026-10-29/nailong/`. `quality-report.json` checks that each measured trace matches its current motion SHA-256, that authored source values settle within 0.2% of the original range, and that maximum sampled frame displacement remains below 40% of the legacy motion. The interruption report separately measures a sequence of incomplete actions. Numerical smoothness supports review but does not replace visual judgment.
