import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const assetRoot = join(root, 'src/renderer/public/live2d/naiwa')
const output = join(assetRoot, 'motions')
mkdirSync(output, { recursive: true })

// These are the independently deforming source channels measured from the
// shipped moc3. The original physics owns the arms, abdomen and torso outputs.
const defaults = {
  ParamAngleX: 0, ParamAngleY: 0, ParamAngleZ: 0,
  ParamEyeBallX: 0, ParamEyeBallY: 0,
  ParamMouthForm: 0, ParamMouthOpenY: 0,
  ParamEyeLOpen: 1, ParamEyeROpen: 1,
  ParamBreath: 0, Paramyt13: 0
}

// Monotone cubic Hermite tangents preserve each keyed range and join with C1
// continuity. The start/end tangents are zero, so restart and fade are quiet.
function curve(id, duration, interior = [], fadeIn = .5) {
  // Cubism fades toward the previous saved value, so ending a curve exactly at
  // the file boundary can freeze a small residual. Reach neutral slightly early
  // and hold it while the fade weight decays; the original physics may settle.
  const neutralTime = duration - Math.min(.32, duration * .12)
  const keys = [[0, defaults[id]], ...interior.map(([time, value]) => [time * neutralTime / duration, value]), [neutralTime, defaults[id]], [duration, defaults[id]]]
  const slope = keys.slice(1).map(([t, value], i) => (value - keys[i][1]) / (t - keys[i][0]))
  const tangents = keys.map((_, i) => {
    if (i === 0 || i === keys.length - 1 || slope[i - 1] * slope[i] <= 0) return 0
    const previous = keys[i][0] - keys[i - 1][0]
    const next = keys[i + 1][0] - keys[i][0]
    const w1 = 2 * next + previous
    const w2 = next + 2 * previous
    return (w1 + w2) / (w1 / slope[i - 1] + w2 / slope[i])
  })
  const segments = [...keys[0]]
  for (let i = 1; i < keys.length; i++) {
    const [t0, v0] = keys[i - 1]
    const [t1, v1] = keys[i]
    const step = (t1 - t0) / 3
    segments.push(1, t0 + step, v0 + tangents[i - 1] * step, t1 - step, v1 - tangents[i] * step, t1, v1)
  }
  return {
    Target: 'Parameter', Id: id,
    // Releasing the large two-arm belly pose needs more inertia than an eye
    // glance. This per-curve fade also applies when a reaction interrupts it.
    ...(id === 'Paramyt13' ? { FadeInTime: 1 } :
      ['ParamAngleX', 'ParamAngleY', 'ParamAngleZ'].includes(id) ? { FadeInTime: Math.max(.45, fadeIn) } : {}),
    Segments: segments.map((n) => Number(n.toFixed(7)))
  }
}

const blink = (time) => [[time - .14, 1], [time, .03], [time + .19, 1]]
const motions = [
  {
    group: 'Idle', file: 'idle-breathe', duration: 8, loop: true, fade: .8,
    description: 'Relaxed breathing, a small asymmetrical weight shift and a quiet blink.',
    tracks: {
      ParamAngleX: [[1.7, 3.2], [4, -.9], [5.9, -2.8]],
      ParamAngleY: [[1.5, 1.1], [3.3, -.7], [5.6, 1.3]],
      ParamAngleZ: [[2.1, -1.7], [4.2, .6], [6.2, 1.5]],
      ParamEyeBallX: [[2, .11], [3.4, .11], [4.7, -.08], [6.4, -.08]],
      ParamEyeBallY: [[2.3, .04], [5.4, -.03]],
      ParamBreath: [[1.7, .3], [3.8, .055], [5.7, .25], [7.1, .04]],
      ParamEyeLOpen: blink(4.15), ParamEyeROpen: blink(4.18)
    }
  },
  {
    group: 'Greet', file: 'greet-welcome', duration: 2.8, fade: .3,
    description: 'A small anticipation, welcoming lean, hands gathering softly at the belly, then release.',
    tracks: {
      ParamAngleX: [[.28, -2.4], [.85, 8.5], [1.5, 5.2], [2.18, 1.6]],
      ParamAngleY: [[.28, -3.6], [.78, 7], [1.36, 3.4], [2.1, .8]],
      ParamAngleZ: [[.3, 1.3], [.9, -7], [1.55, -4], [2.2, -.7]],
      ParamEyeBallX: [[.55, .14], [1.45, .06]],
      ParamEyeBallY: [[.55, .1], [1.45, .04]],
      ParamMouthForm: [[.72, .55], [1.6, .4], [2.25, .1]],
      ParamMouthOpenY: [[.58, .22], [1, .12], [1.45, .2], [1.95, .04]],
      Paramyt13: [[.45, .1], [1.05, .38], [1.55, .38], [2.2, .08]],
      ParamBreath: [[.65, .25], [1.7, .13]],
      ParamEyeLOpen: [[.7, .88], [1.5, .92]], ParamEyeROpen: [[.7, .88], [1.5, .92]]
    }
  },
  {
    group: 'Think', file: 'think-consider', duration: 4.8, fade: .55,
    description: 'Hands settle together, gaze lifts sideways, a held head tilt, then a slower neutral return.',
    tracks: {
      ParamAngleX: [[1, 6], [2.6, 6], [3.7, 2.8]],
      ParamAngleY: [[1.1, 5.2], [2.7, 4.8], [3.8, 1.6]],
      ParamAngleZ: [[1.2, -8.3], [2.8, -8.3], [3.8, -3.1]],
      ParamEyeBallX: [[.65, .3], [2.25, .3], [3.1, .1], [3.8, .1]],
      ParamEyeBallY: [[.7, .28], [2.3, .28], [3.2, .06]],
      ParamMouthForm: [[1, -.18], [2.8, -.18]],
      Paramyt13: [[1.15, .68], [2.85, .68], [3.8, .25]],
      ParamBreath: [[1.3, .18], [2.8, .07], [3.7, .15]],
      ParamEyeLOpen: [[.75, .82], [2.75, .82], [3.25, 1]], ParamEyeROpen: [[.75, .82], [2.75, .82], [3.25, 1]]
    }
  },
  {
    group: 'Agree', file: 'agree-nod', duration: 2.4, fade: .25,
    description: 'Two damped nods: down/up, a smaller confirmation, and soft settling.',
    tracks: {
      ParamAngleX: [[.6, 1.2], [1.6, .5]],
      ParamAngleY: [[.22, 2], [.61, -10.5], [.97, 4], [1.35, -6.5], [1.72, 1.5]],
      ParamAngleZ: [[.65, 1.6], [1.45, -.8]],
      ParamEyeBallY: [[.58, -.13], [1.05, .03], [1.4, -.07]],
      ParamMouthForm: [[.58, .42], [1.5, .36]],
      ParamBreath: [[.4, .12], [1.1, .05], [1.7, .1]],
      ParamEyeLOpen: [[.61, .7], [1, 1], [1.36, .86]], ParamEyeROpen: [[.61, .7], [1, 1], [1.36, .86]]
    }
  },
  {
    group: 'Confused', file: 'confused-check', duration: 3.2, fade: .4,
    description: 'A searching glance, two unequal head tilts and an unhurried return.',
    tracks: {
      ParamAngleX: [[.7, -5.5], [1.65, 5], [2.5, 1.2]],
      ParamAngleY: [[.75, 1.6], [1.8, 2.8], [2.5, .7]],
      ParamAngleZ: [[.85, 9.2], [1.95, -6.4], [2.65, -1]],
      ParamEyeBallX: [[.5, -.3], [1.55, .23], [2.45, .03]],
      ParamEyeBallY: [[.8, .12], [1.8, .12]],
      ParamMouthForm: [[.7, -.36], [1.9, -.28]],
      ParamMouthOpenY: [[1.3, .07], [2.1, .07]],
      ParamBreath: [[.85, .14], [2, .07]],
      ParamEyeLOpen: [[.75, .85], [1.8, .94]], ParamEyeROpen: [[.75, .94], [1.8, .85]]
    }
  },
  ...[-1, 1].map((direction) => ({
    group: direction < 0 ? 'DragLeft' : 'DragRight', file: direction < 0 ? 'drag-left-settle' : 'drag-right-settle', duration: 1.8, fade: .18,
    description: 'A bounded directional balance response with one damped counter-sway; no teleport or detached pieces.',
    tracks: {
      ParamAngleX: [[.36, direction * 9.5], [.72, direction * 6.7], [1.12, direction * -2.2], [1.5, direction * .5]],
      ParamAngleY: [[.38, -3.8], [.8, -1.6], [1.2, .8]],
      ParamAngleZ: [[.4, direction * -8.4], [.78, direction * -5.2], [1.16, direction * 2], [1.5, direction * -.45]],
      ParamEyeBallX: [[.3, direction * .28], [.85, direction * .14], [1.2, direction * -.05]],
      ParamMouthOpenY: [[.32, .08], [.78, .035]],
      ParamBreath: [[.45, .12], [1, .04]],
      ParamEyeLOpen: [[.32, .82], [.8, .95]], ParamEyeROpen: [[.32, .82], [.8, .95]]
    }
  })),
  {
    group: 'Working', file: 'working-attentive', duration: 6, loop: true, fade: .6,
    description: 'A relaxed focused posture, small reading eye movements and subtle forward nods.',
    tracks: {
      ParamAngleX: [[1.1, -2], [2.25, 2.2], [3.6, -1.4], [4.8, 1]],
      ParamAngleY: [[.9, -4.8], [2.4, -3.6], [3.5, -5.4], [4.8, -2.8]],
      ParamAngleZ: [[1.2, 1.3], [3.1, -.8], [4.7, .5]],
      ParamEyeBallX: [[.8, -.16], [1.5, -.16], [2.2, .14], [2.8, .14], [3.5, -.12], [4.1, -.12], [4.7, .08]],
      ParamEyeBallY: [[.8, -.18], [2.4, -.14], [3.6, -.22], [4.8, -.09]],
      Paramyt13: [[1.2, .3], [4.65, .3]],
      ParamMouthForm: [[1.1, .12], [4.5, .12]],
      ParamBreath: [[1.3, .22], [2.9, .06], [4.4, .21], [5.3, .05]],
      ParamEyeLOpen: blink(3.02), ParamEyeROpen: blink(3.05)
    }
  },
  {
    group: 'Comfort', file: 'comfort-soften', duration: 4.2, fade: .65,
    description: 'A low-energy lean toward the viewer, slower breathing and a gentle nod.',
    tracks: {
      ParamAngleX: [[1.1, -3.8], [2.5, -3], [3.25, -.8]],
      ParamAngleY: [[1, -2.2], [1.8, -5.2], [2.6, -1.4]],
      ParamAngleZ: [[1.3, 5.8], [2.7, 4.1], [3.4, 1]],
      ParamEyeBallX: [[1.1, -.08], [2.5, -.04]],
      ParamEyeBallY: [[1.4, -.06], [2.8, -.03]],
      ParamMouthForm: [[1.15, .3], [2.8, .3]],
      Paramyt13: [[1.2, .43], [2.65, .43], [3.45, .1]],
      ParamBreath: [[1.45, .2], [3, .045]],
      ParamEyeLOpen: [[1.15, .75], [2.65, .8], [3.3, .95]], ParamEyeROpen: [[1.15, .75], [2.65, .8], [3.3, .95]]
    }
  }
]

for (const motion of motions) {
  const curves = Object.keys(defaults).map((id) => curve(id, motion.duration, motion.tracks[id], motion.fade))
  const segmentCount = curves.reduce((sum, c) => sum + (c.Segments.length - 2) / 7, 0)
  const data = {
    Version: 3,
    Meta: {
      Duration: motion.duration, Fps: 30, Loop: !!motion.loop,
      FadeInTime: motion.fade, FadeOutTime: Math.max(motion.fade, .35),
      AreBeziersRestricted: true, CurveCount: curves.length,
      TotalSegmentCount: segmentCount, TotalPointCount: segmentCount * 3 + curves.length,
      UserDataCount: 0, TotalUserDataSize: 0
    },
    Curves: curves
  }
  writeFileSync(join(output, `${motion.file}.motion3.json`), JSON.stringify(data, null, 2) + '\n')
}
const settingsPath = join(assetRoot, '奶蛙.model3.json')
const settings = JSON.parse(readFileSync(settingsPath, 'utf8'))
settings.FileReferences.Motions = Object.fromEntries([
  ...motions.map((motion) => [motion.group, [{ File: `motions/${motion.file}.motion3.json`, FadeInTime: motion.fade, FadeOutTime: Math.max(motion.fade, .35) }]]),
  ['LegacyIdle', [{ File: 'hahaha.motion3.json' }]]
])
writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n')
console.log(JSON.stringify(motions.map(({group,duration,description}) => ({group,duration,description})),null,2))
