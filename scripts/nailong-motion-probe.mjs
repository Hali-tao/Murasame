import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'

const root = join(import.meta.dirname, '..')
const assets = join(root, 'src/renderer/public/live2d/naiwa')
const output = join(root, 'previews/overnight-2026-10-29/nailong')
mkdirSync(output, { recursive: true })
const context = vm.createContext({ console, setTimeout, clearTimeout, TextDecoder, performance, atob })
vm.runInContext(readFileSync(join(root, 'src/renderer/public/live2d/core/live2dcubismcore.min.js'), 'utf8'), context)
await new Promise((resolve) => setTimeout(resolve, 100))
const core = context.Live2DCubismCore
const buffer = readFileSync(join(assets, '奶蛙.moc3'))
const moc = core.Moc.fromArrayBuffer(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength))
if (!moc) throw new Error('Cubism Core did not load the original moc3')
const model = core.Model.fromMoc(moc)
const cdi = JSON.parse(readFileSync(join(assets, '奶蛙.cdi3.json'), 'utf8'))
const names = new Map(cdi.Parameters.map((p) => [p.Id, p.Name]))
const params = model.parameters
params.values.set(params.defaultValues)
model.update()
const base = model.drawables.vertexPositions.map((vertices) => Array.from(vertices))
const baseOpacity = Array.from(model.drawables.opacities)
const parameters = params.ids.map((id, i) => {
  const probes = [params.minimumValues[i], params.maximumValues[i]].map((value) => {
    params.values.set(params.defaultValues)
    params.values[i] = value
    model.update()
    let maxVertexDelta = 0
    const affectedDrawables = []
    model.drawables.vertexPositions.forEach((vertices, j) => {
      let max = 0
      vertices.forEach((n, k) => { max = Math.max(max, Math.abs(n - base[j][k])) })
      const opacityDelta = Math.abs(model.drawables.opacities[j] - baseOpacity[j])
      maxVertexDelta = Math.max(maxVertexDelta, max)
      if (max > 1e-6 || opacityDelta > 1e-6) affectedDrawables.push({ id: model.drawables.ids[j], maxVertexDelta: max, opacityDelta })
    })
    return { value, maxVertexDelta, affectedDrawables }
  })
  return { id, name: names.get(id), min: params.minimumValues[i], max: params.maximumValues[i], default: params.defaultValues[i], probes }
})
const physics = JSON.parse(readFileSync(join(assets, '奶蛙.physics3.json'), 'utf8'))
const result = {
  generatedAt: new Date().toISOString(), source: 'Original 奶蛙.moc3 loaded with bundled Cubism Core; parameter ranges are read from model.parameters',
  coreVersion: core.Version.csmGetVersion(), canvas: model.canvasinfo,
  parameters,
  physics: physics.PhysicsSettings.map((p) => ({ id: p.Id, inputs: p.Input.map((n) => n.Source.Id), outputs: p.Output.map((n) => ({ id: n.Destination.Id, weight: n.Weight })) })),
  drawables: model.drawables.ids.map((id, i) => ({ id, parentPart: model.drawables.parentPartIndices[i], vertexCount: model.drawables.vertexCounts[i], defaultOpacity: baseOpacity[i] }))
}
writeFileSync(join(output, 'parameter-probe.json'), JSON.stringify(result, null, 2) + '\n')
console.table(parameters.map((p) => ({ id: p.id, name: p.name, min: p.min, max: p.max, default: p.default, vertexDelta: Math.max(...p.probes.map((v) => v.maxVertexDelta)).toFixed(4), affected: p.probes.map((v) => v.affectedDrawables.length).join('/') })))
model.release()
moc._release()
