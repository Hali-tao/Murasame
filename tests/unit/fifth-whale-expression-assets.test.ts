import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'
import { capabilityOf } from '../../src/shared/avatar/capability'

interface Expression { Type: string; Parameters: Array<{ Id: string; Value: number; Blend: string }> }
interface RawModel {
  parameters: { ids: string[]; values: Float32Array; defaultValues: Float32Array }
  drawables: { ids: string[]; opacities: Float32Array; vertexPositions: Float32Array[] }
  update(): void
}
interface Core { Moc: { fromArrayBuffer(buffer: ArrayBuffer): unknown }; Model: { fromMoc(moc: unknown): RawModel } }
const assetRoot = resolve('src/renderer/public/live2d/whale-girl')
const files = readdirSync(resolve(assetRoot, 'expressions')).filter(file => file.endsWith('.exp3.json'))
const settings = JSON.parse(readFileSync(resolve(assetRoot, 'c_0120.model3.json'), 'utf8')) as { FileReferences: { Expressions?: Array<{ Name: string; File: string }> } }
let model: RawModel

beforeAll(async () => {
  const context = vm.createContext({ console, setTimeout, clearTimeout, TextDecoder, performance, atob })
  vm.runInContext(readFileSync(resolve('src/renderer/public/live2d/core/live2dcubismcore.min.js'), 'utf8'), context)
  await new Promise(resolve => setTimeout(resolve, 100))
  const core = context.Live2DCubismCore as Core
  const buffer = readFileSync(resolve(assetRoot, 'c_0120.moc3'))
  model = core.Model.fromMoc(core.Moc.fromArrayBuffer(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)))
})

describe('registered whale expressions use the original native model', () => {
  it('makes every shipped expression reachable by its real name', () => {
    const references = settings.FileReferences.Expressions ?? []
    expect(references.map(item => item.File).sort()).toEqual(files.map(file => 'expressions/' + file).sort())
    expect(new Set(references.map(item => item.Name)).size).toBe(references.length)
    for (const reference of references) expect(reference.Name).toBe(reference.File.split('/').at(-1)?.replace('.exp3.json', ''))
    for (const name of capabilityOf('whale-girl').expressions) expect(references.some(item => item.Name === name)).toBe(true)
  })

  it.each(files)('%s has real native targets and no unsupported effective parameter changes', file => {
    const expression = JSON.parse(readFileSync(resolve(assetRoot, 'expressions', file), 'utf8')) as Expression
    expect(expression.Type).toBe('Live2D Expression')
    expect(expression.Parameters.length).toBeGreaterThan(0)
    let nativeTargets = 0
    for (const parameter of expression.Parameters) {
      if (model.parameters.ids.includes(parameter.Id)) nativeTargets++
      else {
        // One original accessory expression contains two legacy zero additions.
        // They are harmless no-ops, not evidence of a working native channel.
        expect(parameter, `${file}: unknown ${parameter.Id} must have no effect`).toMatchObject({ Value: 0, Blend: 'Add' })
      }
      expect(Number.isFinite(parameter.Value)).toBe(true)
      expect(['Add', 'Multiply', 'Overwrite']).toContain(parameter.Blend)
    }
    expect(nativeTargets).toBeGreaterThan(0)
  })

  it('the authored question-mark parameter exposes real drawable geometry and can return to neutral', () => {
    const p = model.parameters
    const index = p.ids.indexOf('ParamCheek74')
    expect(index).toBeGreaterThanOrEqual(0)
    p.values.set(p.defaultValues)
    model.update()
    const neutral = Array.from(model.drawables.opacities)
    p.values[index] = 1
    model.update()
    const appeared = Array.from(model.drawables.opacities).map((value, i) => value - neutral[i])
    expect(Math.max(...appeared)).toBeGreaterThan(0.9)
    p.values.set(p.defaultValues)
    model.update()
    expect(Array.from(model.drawables.opacities)).toEqual(neutral)
  })
})
