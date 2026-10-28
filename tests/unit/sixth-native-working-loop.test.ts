import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'

interface Curve { Target: string; Id: string; Segments: number[] }
interface Motion { Meta: { Duration: number; Loop: boolean; CurveCount: number; TotalSegmentCount: number; TotalPointCount: number }; Curves: Curve[] }
interface RawModel {
  parameters: { ids: string[]; values: Float32Array; minimumValues: Float32Array; maximumValues: Float32Array; defaultValues: Float32Array }
  drawables: { vertexPositions: Float32Array[] }
  update(): void
}
interface Core { Moc: { fromArrayBuffer(buffer: ArrayBuffer): unknown }; Model: { fromMoc(moc: unknown): RawModel } }
const assets = resolve('src/renderer/public/live2d/naiwa')
let model: RawModel

beforeAll(async () => {
  const context = vm.createContext({ console, setTimeout, clearTimeout, TextDecoder, performance, atob })
  vm.runInContext(readFileSync(resolve('src/renderer/public/live2d/core/live2dcubismcore.min.js'), 'utf8'), context)
  await new Promise(resolve => setTimeout(resolve, 100))
  const core = context.Live2DCubismCore as Core
  const buffer = readFileSync(resolve(assets, '奶蛙.moc3'))
  model = core.Model.fromMoc(core.Moc.fromArrayBuffer(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)))
})

function load(): Motion {
  const settings = JSON.parse(readFileSync(resolve(assets, '奶蛙.model3.json'), 'utf8')) as { FileReferences: { Motions: Record<string, { File: string }[]> } }
  const reference = settings.FileReferences.Motions.WorkingLoop?.[0]
  expect(reference, 'sustained work must resolve to its native periodic motion').toBeDefined()
  return JSON.parse(readFileSync(resolve(assets, reference.File), 'utf8')) as Motion
}

// Restricted Cubism Beziers have equally spaced time control points, so u is
// the exact normalized time. Evaluate the real asset, not its authoring helper.
function sample(curve: Curve, time: number): number {
  const data = curve.Segments
  let start = data[0]
  let value = data[1]
  for (let i = 2; i < data.length; i += 7) {
    const end = data[i + 5]
    if (time <= end) {
      const u = (time - start) / (end - start)
      return (1 - u) ** 3 * value + 3 * (1 - u) ** 2 * u * data[i + 2] + 3 * (1 - u) * u ** 2 * data[i + 4] + u ** 3 * data[i + 6]
    }
    start = end
    value = data[i + 6]
  }
  return value
}

describe('sustained native working posture', () => {
  it('keeps attention and hands settled through the repeated boundary instead of fully releasing them', () => {
    const motion = load()
    const hand = motion.Curves.find(curve => curve.Id === 'Paramyt13')!
    const gaze = motion.Curves.find(curve => curve.Id === 'ParamEyeBallY')!
    expect(motion.Meta.Loop).toBe(true)
    for (let t = 0; t <= motion.Meta.Duration; t += 1 / 60) {
      expect(sample(hand, t), `hands released at ${t}`).toBeGreaterThanOrEqual(0.1)
      expect(sample(hand, t)).toBeLessThanOrEqual(0.4)
      expect(sample(gaze, t), `work gaze drifted above the reading plane at ${t}`).toBeLessThanOrEqual(0)
    }
  })

  it('joins every curve and the repeated boundary with matching position and velocity', () => {
    const motion = load()
    for (const curve of motion.Curves) {
      const data = curve.Segments
      let time = data[0]
      let value = data[1]
      const initialSlope = (data[4] - value) / (data[3] - time)
      let previousSlope = initialSlope
      for (let i = 2; i < data.length; i += 7) {
        expect(data[i]).toBe(1)
        const [t1, v1, t2, v2, end, last] = data.slice(i + 1, i + 7)
        expect(t1).toBeGreaterThan(time)
        expect(t2).toBeGreaterThan(t1)
        expect(end).toBeGreaterThan(t2)
        expect(t1 - time).toBeCloseTo((end - time) / 3, 5)
        expect(t2 - time).toBeCloseTo(2 * (end - time) / 3, 5)
        expect((v1 - value) / (t1 - time), `${curve.Id} at ${time}`).toBeCloseTo(previousSlope, 4)
        previousSlope = (last - v2) / (end - t2)
        time = end
        value = last
      }
      expect(time).toBeCloseTo(motion.Meta.Duration, 6)
      expect(value, `${curve.Id} position across wrap`).toBeCloseTo(data[1], 6)
      expect(previousSlope, `${curve.Id} velocity across wrap`).toBeCloseTo(initialSlope, 4)
    }
  })

  it('animates actual native mesh without competing with original physics or exceeding rig limits', () => {
    const motion = load()
    const physics = JSON.parse(readFileSync(resolve(assets, '奶蛙.physics3.json'), 'utf8')) as { PhysicsSettings: { Output: { Destination: { Id: string } }[] }[] }
    const owned = new Set(physics.PhysicsSettings.flatMap(setting => setting.Output.map(item => item.Destination.Id)))
    const p = model.parameters
    p.values.set(p.defaultValues); model.update()
    const neutral = model.drawables.vertexPositions.map(v => Array.from(v))
    let displacement = 0
    for (let t = 0; t < motion.Meta.Duration; t += 0.1) {
      p.values.set(p.defaultValues)
      for (const curve of motion.Curves) {
        expect(owned.has(curve.Id), `${curve.Id} competes with physics`).toBe(false)
        const index = p.ids.indexOf(curve.Id)
        expect(index).toBeGreaterThanOrEqual(0)
        const value = sample(curve, t)
        expect(value).toBeGreaterThanOrEqual(p.minimumValues[index] - 1e-6)
        expect(value).toBeLessThanOrEqual(p.maximumValues[index] + 1e-6)
        p.values[index] = value
      }
      model.update()
      model.drawables.vertexPositions.forEach((v, j) => v.forEach((n, k) => { displacement = Math.max(displacement, Math.abs(n - neutral[j][k])) }))
    }
    expect(displacement).toBeGreaterThan(0.01)
  })

  it('keeps breathing active while retaining a complete blink in each cycle', () => {
    const motion = load()
    const breath = motion.Curves.find(curve => curve.Id === 'ParamBreath')!
    for (let start = 0; start < motion.Meta.Duration; start += 3) {
      const values = Array.from({ length: 90 }, (_, i) => sample(breath, Math.min(motion.Meta.Duration, start + i / 30)))
      expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(0.05)
    }
    for (const id of ['ParamEyeLOpen', 'ParamEyeROpen']) {
      const eye = motion.Curves.find(curve => curve.Id === id)!
      const values = Array.from({ length: Math.ceil(motion.Meta.Duration * 60) }, (_, i) => sample(eye, i / 60))
      expect(Math.min(...values)).toBeLessThan(0.1)
      expect(values.filter(value => value < 0.5).length / 60).toBeLessThan(0.8)
      expect(values[0]).toBeCloseTo(1)
      expect(values.at(-1)).toBeCloseTo(1)
    }
  })
})
