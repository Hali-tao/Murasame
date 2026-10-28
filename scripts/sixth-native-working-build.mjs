import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const assets = resolve(import.meta.dirname, '../src/renderer/public/live2d/naiwa')
const duration = 12

// A sustained posture has a non-neutral periodic boundary. Unlike the existing
// one-shot Working, hands do not drop and gather again at every repeat. Only
// measured source parameters are authored; original rig physics follows them.
const blink = time => [[time - .13, 1], [time, .03], [time + .19, 1]]
const tracks = {
  ParamAngleX: [[0, -1.2], [1.5, -2.1], [3.1, 1.6], [4.8, 1.6], [6.5, -.8], [8.2, -1.8], [10.1, .8], [11, .2], [12, -1.2]],
  ParamAngleY: [[0, -4], [1.6, -4.6], [3.4, -3.6], [5.4, -4.4], [7.3, -5.1], [9.1, -3.5], [10.8, -3.6], [12, -4]],
  ParamAngleZ: [[0, .45], [2.2, 1.1], [4.8, -.55], [7.3, .75], [9.6, -.35], [12, .45]],
  ParamEyeBallX: [[0, -.08], [.9, -.16], [1.9, -.16], [2.35, .13], [4.35, .13], [4.8, -.07], [6.8, -.07], [7.3, -.16], [8.7, -.16], [9.15, .09], [10.35, .09], [10.8, -.08], [12, -.08]],
  ParamEyeBallY: [[0, -.16], [1.8, -.19], [3.1, -.14], [5.1, -.18], [7.1, -.22], [8.9, -.13], [10.8, -.14], [12, -.16]],
  ParamMouthForm: [[0, .1], [4.4, .12], [8.1, .08], [12, .1]],
  ParamMouthOpenY: [[0, 0], [12, 0]],
  ParamEyeLOpen: [[0, 1], ...blink(3.12), ...blink(8.53), [12, 1]],
  ParamEyeROpen: [[0, 1], ...blink(3.15), ...blink(8.56), [12, 1]],
  ParamBreath: [[0, .15], [1.15, .26], [3.25, .06], [5.4, .24], [7.5, .055], [9.55, .22], [11.2, .08], [12, .15]],
  Paramyt13: [[0, .25], [2.4, .28], [5.6, .23], [8.3, .27], [10.8, .24], [12, .25]]
}

function periodicCurve(id, keys) {
  const slope = keys.slice(1).map(([time, value], i) => (value - keys[i][1]) / (time - keys[i][0]))
  const tangent = (left, right, previous, next) => {
    if (left * right <= 0) return 0
    const w1 = 2 * next + previous
    const w2 = next + 2 * previous
    return (w1 + w2) / (w1 / left + w2 / right)
  }
  const seam = tangent(slope.at(-1), slope[0], duration - keys.at(-2)[0], keys[1][0])
  const tangents = keys.map((_, i) => i === 0 || i === keys.length - 1 ? seam : tangent(slope[i - 1], slope[i], keys[i][0] - keys[i - 1][0], keys[i + 1][0] - keys[i][0]))
  const segments = [...keys[0]]
  for (let i = 1; i < keys.length; i++) {
    const [t0, v0] = keys[i - 1]
    const [t1, v1] = keys[i]
    const step = (t1 - t0) / 3
    segments.push(1, t0 + step, v0 + tangents[i - 1] * step, t1 - step, v1 - tangents[i] * step, t1, v1)
  }
  return {
    Target: 'Parameter', Id: id,
    ...(id === 'Paramyt13' ? { FadeInTime: 1.2 } : id.startsWith('ParamAngle') ? { FadeInTime: .8 } : {}),
    Segments: segments.map(value => Number(value.toFixed(7)))
  }
}

const curves = Object.entries(tracks).map(([id, keys]) => periodicCurve(id, keys))
const segments = curves.reduce((sum, curve) => sum + (curve.Segments.length - 2) / 7, 0)
const motion = {
  Version: 3,
  Meta: {
    Duration: duration, Fps: 30, Loop: true, FadeInTime: .8, FadeOutTime: .8,
    AreBeziersRestricted: true, CurveCount: curves.length,
    TotalSegmentCount: segments, TotalPointCount: 3 * segments + curves.length,
    UserDataCount: 0, TotalUserDataSize: 0
  },
  Curves: curves
}
writeFileSync(resolve(assets, 'motions/working-continuous.motion3.json'), JSON.stringify(motion, null, 2) + '\n')
const settingsPath = resolve(assets, '奶蛙.model3.json')
const settings = JSON.parse(readFileSync(settingsPath, 'utf8'))
settings.FileReferences.Motions.WorkingLoop = [{ File: 'motions/working-continuous.motion3.json', FadeInTime: .8, FadeOutTime: .8 }]
writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n')
console.log(JSON.stringify({ group: 'WorkingLoop', duration, curves: curves.length, segments }))
