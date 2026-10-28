/* global window, document, MouseEvent */
import assert from 'node:assert/strict'
import { _electron as electron } from '@playwright/test'
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve, extname, relative, isAbsolute, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

// Real production component, original three Cubism models and original physics.
// No mocked motion manager; this catches low-priority taps replacing a semantic
// motion, including while that motion is still being fetched.
const root = resolve(import.meta.dirname, '..')
const label = process.argv[2] ?? 'current'
assert.match(label, /^[a-z0-9-]+$/)
const baseline = process.argv[3]
if (baseline) assert.match(baseline, /^[a-f0-9]{7,40}$/)
const output = join(root, 'previews/overnight-2026-10-29/fifth-native', label)
const temp = join(root, 'previews/tmp/fifth-native')
mkdirSync(output, { recursive: true })
mkdirSync(temp, { recursive: true })
const component = join(root, 'src/renderer/src/components/Live2DPet.tsx')
const componentSource = baseline
  ? execFileSync('git', ['show', baseline + ':src/renderer/src/components/Live2DPet.tsx'], { cwd: root, encoding: 'utf8', windowsHide: true })
  : readFileSync(component, 'utf8')
const source = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {Live2DModel} from 'pixi-live2d-display/cubism4';
import {extensions,ExtensionType} from 'pixi.js';
import {Live2DPet} from './src/renderer/src/components/Live2DPet';
import {getPetPreset} from './src/shared/pet-presets';
const h=window.harness={frames:[],events:[]};
extensions.add({extension:ExtensionType.Application,init(){h.app=this},destroy(){}});
const originalFrom=Live2DModel.from;
Live2DModel.from=async function(...args){
 const model=await originalFrom.apply(this,args);h.model=model;
 const internal=model.internalModel;const update=internal.update.bind(internal);let previous;let appliedParameters;
 const updateCore=internal.coreModel.update.bind(internal.coreModel);
 internal.coreModel.update=()=>{const p=internal.coreModel.getModel().parameters;appliedParameters=Object.fromEntries(p.ids.map((id,i)=>[id,p.values[i]]));updateCore();};
 internal.motionManager.on('motionStart',group=>h.events.push({group,frame:h.frames.length}));
 internal.update=(dt,now)=>{
  update(dt,now);const raw=internal.coreModel.getModel();
  const vertices=raw.drawables.vertexPositions.flatMap(v=>Array.from(v));let step=0;
  if(previous)for(let i=0;i<vertices.length;i++)step=Math.max(step,Math.abs(vertices[i]-previous[i]));
  previous=vertices;h.frames.push({dt,now,step,group:internal.motionManager.state.currentGroup,priority:internal.motionManager.state.currentPriority,queue:internal.motionManager.queueManager._motions.length,parameters:appliedParameters});
 };
 return model;
};
const preset=getPetPreset(new URL(location.href).searchParams.get('preset')??'naiwa');
const renderer=createRoot(document.querySelector('#pet'));
renderer.render(React.createElement(Live2DPet,{fps:60,ref:ref=>{h.ref=ref},preset}));
h.step=async(frames)=>{h.app.ticker.stop();let time=h.app.ticker.lastTime;for(let i=0;i<frames;i++){time+=1000/60;h.app.ticker.update(time);await Promise.resolve();}};
h.state=()=>({...h.model.internalModel.motionManager.state,frame:h.frames.length});
`
await build({ stdin: { contents: source, resolveDir: root, loader: 'tsx' }, bundle: true, outfile: join(output, 'component.js'), platform: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': '"production"' }, alias: { '@shared': join(root, 'src/shared') }, jsx: 'automatic', plugins: [{ name: 'component-under-test', setup(build) { build.onLoad({ filter: /[\\/]Live2DPet\.tsx$/ }, () => ({ contents: componentSource, loader: 'tsx', resolveDir: dirname(component) })) } }] })
writeFileSync(join(output, 'index.html'), '<!doctype html><meta charset="utf-8"><base href="/src/renderer/public/"><style>html,body{margin:0;background:#ece8e1;color:#343b44;font-family:Arial,sans-serif}#pet,.live2d-pet-host{width:640px;height:640px}.live2d-canvas{width:100%;height:100%;display:block}#caption{position:absolute;top:10px;left:18px;font-size:15px;pointer-events:none}</style><div id="caption">Actual production component · original native Cubism model</div><div id="pet"></div><script src="live2d/core/live2dcubismcore.min.js"></script><script src="/' + relative(root, join(output, 'component.js')).replaceAll('\\', '/') + '"></script>')
writeFileSync(join(output, 'main.cjs'), "const {app,BrowserWindow}=require('electron');app.commandLine.appendSwitch('force-device-scale-factor','1');app.setPath('userData',process.env.FIFTH_NATIVE_PROFILE);app.whenReady().then(()=>{const w=new BrowserWindow({width:640,height:640,useContentSize:true,show:false,webPreferences:{backgroundThrottling:false}});w.loadURL(process.env.FIFTH_NATIVE_URL)});")
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' }
const server = createServer((request, response) => {
  try {
    const path = resolve(root, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname))
    const rel = relative(root, path)
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Outside workspace')
    response.setHeader('Content-Type', mime[extname(path)] ?? 'application/octet-stream')
    response.end(readFileSync(path))
  } catch { response.writeHead(404); response.end('Not found') }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const url = `http://127.0.0.1:${server.address().port}/` + relative(root, join(output, 'index.html')).replaceAll('\\', '/')
const app = await electron.launch({ args: [join(output, 'main.cjs')], cwd: root, env: { ...process.env, TEMP: temp, TMP: temp, FIFTH_NATIVE_PROFILE: join(temp, `profile-${label}-${Date.now()}`), FIFTH_NATIVE_URL: url } })
const errors = []
const checks = []
const sequences = []
const record = (name, passed, evidence) => checks.push({ name, passed, ...evidence })
try {
  const page = await app.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  const ready = async preset => {
    await page.goto(url + '?preset=' + preset)
    await page.locator('[data-live2d-state="ready"]').waitFor({ timeout: 30000 })
    await page.evaluate(() => { window.harness.app.ticker.stop() })
  }
  const step = frames => page.evaluate(frames => window.harness.step(frames), frames)
  const named = async group => {
    await page.evaluate(group => window.harness.ref.playNamedMotion(group, null), group)
    await page.waitForFunction(group => window.harness.state().currentGroup === group, group)
  }
  const capture = async name => {
    await page.evaluate(name => { document.querySelector('#caption').textContent = name }, name)
    await page.screenshot({ path: join(output, name + '.png') })
  }
  for (const item of [
    { preset: 'naiwa', semantic: 'Think', next: 'Comfort', tap: 'Greet', idle: 'Idle' },
    { preset: 'tororo', semantic: 'FlickUp', next: 'FlickDown', tap: 'Tap', idle: 'Idle' },
    { preset: 'whale-girl', semantic: 'selfieQuick', next: 'bubble', tap: 'aidale', idle: 'idle' }
  ]) {
    await ready(item.preset)
    await page.evaluate(() => window.harness.ref.playMotion('tap'))
    await page.waitForTimeout(150)
    await step(24)
    let state = await page.evaluate(() => window.harness.state())
    record(`${item.preset}: a tap can interrupt initial idle`, state.currentGroup === item.tap, { state })
    await named(item.semantic)
    await step(55)
    await capture(item.preset + '-semantic-before-tap')
    await page.evaluate(() => window.harness.ref.playMotion('tap'))
    await page.waitForTimeout(100)
    await step(18)
    state = await page.evaluate(() => window.harness.state())
    await capture(item.preset + '-semantic-after-tap')
    record(`${item.preset}: tap cannot replace an active semantic motion`, state.currentGroup === item.semantic, { state })
    if (item.preset === 'naiwa') {
      await named(item.semantic)
      await step(36)
      await page.evaluate(() => window.harness.ref.playMotion('drag'))
      await page.waitForTimeout(100)
      await step(12)
      state = await page.evaluate(() => window.harness.state())
      record('naiwa: releasing a drag cannot replace an active semantic motion', state.currentGroup === item.semantic, { state })
    }
    await named(item.next)
    await step(10)
    state = await page.evaluate(() => window.harness.state())
    record(`${item.preset}: a newer semantic motion can take over`, state.currentGroup === item.next, { state })
    await named(item.idle)
    await step(12)
    await page.evaluate(() => window.harness.ref.playMotion('tap'))
    await page.waitForTimeout(100)
    await step(12)
    state = await page.evaluate(() => window.harness.state())
    record(`${item.preset}: explicit idle releases the interaction priority`, state.currentGroup === item.tap, { state })
    // Fresh load leaves this semantic motion uncached: its reservation must also
    // outrank an immediately following low-priority pointer reaction.
    await ready(item.preset)
    await page.evaluate(group => { window.harness.ref.playNamedMotion(group, null); window.harness.ref.playMotion('tap') }, item.semantic)
    await page.waitForTimeout(400)
    await step(20)
    state = await page.evaluate(() => window.harness.state())
    record(`${item.preset}: pending semantic load cannot be displaced by a tap`, state.currentGroup === item.semantic, { state })
  }
  await ready('whale-girl')
  await page.evaluate(() => window.harness.ref.playNamedMotion('idle', '问号'))
  await page.waitForTimeout(200)
  await step(30)
  await page.evaluate(() => window.harness.ref.playMotion('tap'))
  await page.waitForTimeout(100)
  await step(12)
  const expressiveIdle = await page.evaluate(() => window.harness.state())
  record('whale-girl: an idle motion carrying a semantic expression keeps emotion priority', expressiveIdle.currentGroup === 'idle', { state: expressiveIdle })
  await capture('whale-girl-expressive-idle-after-tap')
  await ready('naiwa')
  for (const [group, frames] of [['Working', 84], ['Greet', 55], ['DragRight', 29], ['Comfort', 61], ['Idle', 120]]) {
    const start = await page.evaluate(() => window.harness.frames.length)
    await named(group)
    // Moving the pointer while an authored motion is active should preserve the
    // original body physics and bounded authored pose.
    await page.evaluate(() => window.dispatchEvent(new MouseEvent('mousemove', { clientX: 615, clientY: 70 })))
    await step(frames)
    await capture('naiwa-transition-' + group)
    const framesData = await page.evaluate(start => window.harness.frames.slice(start), start)
    sequences.push({ group, frames: framesData })
    const maxStep = Math.max(...framesData.map(frame => frame.step))
    record(`naiwa: ${group} transition remains continuous with original physics`, maxStep < 0.025, { maxStep, frameCount: framesData.length })
    record(`naiwa: ${group} uses a single body motion`, framesData.every(frame => frame.queue <= 1), { maxQueue: Math.max(...framesData.map(frame => frame.queue)) })
  }
  await named('Greet')
  await page.evaluate(() => window.harness.ref.setMouth(0.63))
  await step(40)
  let frame = await page.evaluate(() => window.harness.frames.at(-1))
  record('naiwa: speech mouth wins over the authored mouth curve', Math.abs(frame.parameters.ParamMouthOpenY - 0.63) < 0.0001, { actual: frame.parameters.ParamMouthOpenY })
  await page.evaluate(() => window.harness.ref.setMouth(null))
  await step(240)
  frame = await page.evaluate(() => window.harness.frames.at(-1))
  record('naiwa: completed reaction returns to idle without a wall-clock timeout', frame.group === 'Idle', { group: frame.group })
  await page.evaluate(() => window.harness.ref.playMotion('drag'))
  await page.waitForTimeout(100)
  await step(24)
  frame = await page.evaluate(() => window.harness.frames.at(-1))
  record('naiwa: drag reaction starts after idle is restored', frame.group === 'DragLeft', { group: frame.group })
  await capture('naiwa-drag-from-idle')
  record('native page has no runtime errors', errors.length === 0, { errors })
  const report = { generatedAt: new Date().toISOString(), label, baseline, componentSha256: createHash('sha256').update(componentSource).digest('hex'), runtime: 'Actual Live2DPet.tsx, React, Pixi ticker, original Cubism moc3 and physics. Controlled 60 Hz ticker steps; original three assets. No mocked model or motion manager.', checks, passed: checks.every(check => check.passed) }
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  writeFileSync(join(output, 'transition-samples.json'), JSON.stringify(sequences, null, 2) + '\n')
  console.log(JSON.stringify({ label, passed: report.passed, checks: checks.length, failed: checks.filter(check => !check.passed) }, null, 2))
  assert.ok(report.passed, checks.filter(check => !check.passed).map(check => check.name).join('; '))
} finally {
  await app.close()
  await new Promise(resolve => server.close(resolve))
}
