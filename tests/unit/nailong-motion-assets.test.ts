import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'

interface Curve { Target: string; Id: string; Segments: number[] }
interface Motion { Meta: { Duration: number; CurveCount: number; TotalSegmentCount: number; TotalPointCount: number; FadeInTime: number; FadeOutTime: number }; Curves: Curve[] }
interface RawModel {
  parameters: { ids: string[]; values: Float32Array; minimumValues: Float32Array; maximumValues: Float32Array; defaultValues: Float32Array }
  drawables: { vertexPositions: Float32Array[] }
  update(): void
}
interface Core { Moc: { fromArrayBuffer(buffer: ArrayBuffer): unknown }; Model: { fromMoc(moc: unknown): RawModel } }
const assetRoot = resolve('src/renderer/public/live2d/naiwa')
const groups = ['Idle', 'Greet', 'Think', 'Agree', 'Confused', 'DragLeft', 'DragRight', 'Working', 'Comfort']
const settings = JSON.parse(readFileSync(resolve(assetRoot, '奶蛙.model3.json'), 'utf8')) as { FileReferences: { Motions: Record<string, { File: string }[]> } }
let model: RawModel
let bounds: Map<string, { min: number; max: number; default: number }>

beforeAll(async () => {
  const context = vm.createContext({ console, setTimeout, clearTimeout, TextDecoder, performance, atob })
  vm.runInContext(readFileSync(resolve('src/renderer/public/live2d/core/live2dcubismcore.min.js'), 'utf8'), context)
  await new Promise((resolve) => setTimeout(resolve, 100))
  const core = context.Live2DCubismCore as Core
  const mocBuffer = readFileSync(resolve(assetRoot, '奶蛙.moc3'))
  model = core.Model.fromMoc(core.Moc.fromArrayBuffer(mocBuffer.buffer.slice(mocBuffer.byteOffset, mocBuffer.byteOffset + mocBuffer.byteLength)))
  const p = model.parameters
  bounds = new Map(p.ids.map((id, i) => [id, { min: p.minimumValues[i], max: p.maximumValues[i], default: p.defaultValues[i] }]))
})

function load(group: string): Motion {
  const reference = settings.FileReferences.Motions[group]?.[0]
  expect(reference, `${group} must resolve to a native motion file`).toBeDefined()
  return JSON.parse(readFileSync(resolve(assetRoot, reference.File), 'utf8')) as Motion
}

describe('native nailong motion assets', () => {
  it('resolves distinct semantic actions to loadable native motions', () => {
    const filenames = groups.map((group) => {
      const motion = load(group)
      expect(motion.Curves.length).toBeGreaterThanOrEqual(4)
      return settings.FileReferences.Motions[group][0].File
    })
    expect(new Set(filenames).size).toBe(groups.length)
  })

  it.each(groups)('%s stays within the original moc3 bounds and returns smoothly to its neutral pose', (group) => {
    const motion = load(group)
    expect(motion.Meta.FadeInTime).toBeGreaterThan(0)
    expect(motion.Meta.FadeOutTime).toBeGreaterThan(0)
    let segments = 0
    let points = 0
    for (const curve of motion.Curves) {
      const bound = bounds.get(curve.Id)
      expect(bound, `${group}/${curve.Id} must exist in the moc3`).toBeDefined()
      if (!bound) throw new Error(curve.Id)
      expect(curve.Target).toBe('Parameter')
      const data = curve.Segments
      expect(data[0]).toBe(0)
      expect(data[1]).toBeCloseTo(bound.default, 5)
      let time = data[0]
      let value = data[1]
      let lastSlope = 0
      points += 1
      for (let i = 2; i < data.length; i += 7) {
        expect(data[i]).toBe(1)
        const [t1, v1, t2, v2, endTime, endValue] = data.slice(i + 1, i + 7)
        expect(t1).toBeGreaterThan(time)
        expect(t2).toBeGreaterThan(t1)
        expect(endTime).toBeGreaterThan(t2)
        const incomingSlope = (v1 - value) / (t1 - time)
        expect(Math.abs(incomingSlope - lastSlope), `${group}/${curve.Id} tangent discontinuity at ${time}`).toBeLessThan(0.003)
        for (const v of [value, v1, v2, endValue]) {
          expect(v).toBeGreaterThanOrEqual(bound.min - 1e-6)
          expect(v).toBeLessThanOrEqual(bound.max + 1e-6)
        }
        lastSlope = (endValue - v2) / (endTime - t2)
        time = endTime
        value = endValue
        segments += 1
        points += 3
      }
      expect(lastSlope).toBeCloseTo(0, 5)
      expect(time).toBeCloseTo(motion.Meta.Duration, 5)
      expect(value).toBeCloseTo(bound.default, 5)
    }
    expect(motion.Meta.CurveCount).toBe(motion.Curves.length)
    expect(motion.Meta.TotalSegmentCount).toBe(segments)
    expect(motion.Meta.TotalPointCount).toBe(points)
  })

  it.each(groups)('%s changes actual original mesh vertices instead of inert template parameters', (group) => {
    const motion = load(group)
    const p = model.parameters
    p.values.set(p.defaultValues)
    model.update()
    const neutral = model.drawables.vertexPositions.map((v) => Array.from(v))
    let maxDisplacement = 0
    for (const curve of motion.Curves) {
      const index = p.ids.indexOf(curve.Id)
      for (let i = 8; i < curve.Segments.length; i += 7) {
        p.values.set(p.defaultValues)
        p.values[index] = curve.Segments[i]
        model.update()
        model.drawables.vertexPositions.forEach((vertices, j) => vertices.forEach((v, k) => {
          maxDisplacement = Math.max(maxDisplacement, Math.abs(v - neutral[j][k]))
        }))
      }
    }
    expect(maxDisplacement).toBeGreaterThan(0.004)
  })

  it('leaves physics-owned limbs and trunk to the original follow-through simulation', () => {
    const physics = JSON.parse(readFileSync(resolve(assetRoot, '奶蛙.physics3.json'), 'utf8')) as { PhysicsSettings: { Output: { Destination: { Id: string } }[] }[] }
    const physicsOwned = new Set(physics.PhysicsSettings.flatMap((setting) => setting.Output.map((item) => item.Destination.Id)))
    for (const group of groups) {
      for (const curve of load(group).Curves) expect(physicsOwned.has(curve.Id), `${group}/${curve.Id} competes with physics`).toBe(false)
    }
  })
})
