import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root=join(import.meta.dirname,'..')
const output=join(root,'previews/overnight-2026-10-29/nailong')
const assetRoot=join(root,'src/renderer/public/live2d/naiwa')
const read=(path)=>JSON.parse(readFileSync(path,'utf8'))
const settings=read(join(assetRoot,'奶蛙.model3.json'))
const parameterProbe=read(join(output,'parameter-probe.json'))
const bounds=new Map(parameterProbe.parameters.map(p=>[p.id,p]))
const baseline=read(join(output,'LegacyIdle-samples.json'))
const results=[]
for(const [group,references] of Object.entries(settings.FileReferences.Motions)){
  if(group==='LegacyIdle')continue
  const motionFile=join(assetRoot,references[0].File)
  const motion=read(motionFile)
  const samples=read(join(output,`${group}-samples.json`))
  const final=samples.frames.at(-1).parameters
  const sourceResiduals=motion.Curves.map(c=>{
    const p=bounds.get(c.Id)
    return {id:c.Id,value:final[c.Id],normalizedResidual:Math.abs(final[c.Id]-p.default)/(p.max-p.min)}
  })
  const worst=sourceResiduals.reduce((a,b)=>a.normalizedResidual>b.normalizedResidual?a:b)
  assert.ok(worst.normalizedResidual<.002,`${group} ends with ${worst.id}=${worst.value}; ${100*worst.normalizedResidual}% of its full range remains after fade out`)
  assert.equal(samples.sourceMotionSha256,createHash('sha256').update(readFileSync(motionFile)).digest('hex'),`${group} evidence is stale; run render again`)
  assert.ok(samples.maxStep<baseline.maxStep*.4,`${group} contains excessive frame displacement`)
  const physicalFollowThrough=parameterProbe.physics.flatMap(p=>p.outputs).map(({id})=>{
    const values=samples.frames.map(f=>f.parameters[id])
    return {id,min:Math.min(...values),max:Math.max(...values),final:final[id]}
  })
  results.push({group,duration:motion.Meta.Duration,maxVertexStep:samples.maxStep,reductionFromLegacy:1-samples.maxStep/baseline.maxStep,maxVertexDisplacement:samples.maximumDisplacement,worstFinalSourceResidual:worst,physicalFollowThrough})
}
const report={generatedAt:new Date().toISOString(),measurement:'Native Cubism Core meshes after physics; 60 Hz; stock breath and blink disabled; values include all visible meshes and blink motion. Lower frame displacement does not independently establish perceptual quality.',baseline:{group:'LegacyIdle',maxVertexStep:baseline.maxStep,maxVertexDisplacement:baseline.maximumDisplacement},results,checks:['Each trace matches current motion SHA-256','All final authored source values settle within 0.2% of original parameter range','Maximum frame displacement under 40% of legacy motion']}
writeFileSync(join(output,'quality-report.json'),JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify({groups:results.length,baselineStep:baseline.maxStep,maxNewStep:Math.max(...results.map(r=>r.maxVertexStep)),maxFinalSourceResidual:Math.max(...results.map(r=>r.worstFinalSourceResidual.normalizedResidual))},null,2))
