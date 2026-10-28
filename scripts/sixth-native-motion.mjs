/* global window, document */
import assert from 'node:assert/strict'
import { _electron as electron } from '@playwright/test'
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve, extname, relative, isAbsolute, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'

// Render actual production component and original Cubism assets. A Git ref
// supplies prior component/assets without changing the working checkout.
const root = resolve(import.meta.dirname, '..')
const label = process.argv[2] ?? 'current'
const baseline = process.argv[3]
assert.match(label, /^[a-z0-9-]+$/)
if (baseline) assert.match(baseline, /^[a-f0-9]{7,40}$/)
const output = join(root, 'previews/overnight-2026-10-29/sixth-native', label)
const temp = join(root, 'previews/tmp/sixth-native')
mkdirSync(output, { recursive: true })
mkdirSync(temp, { recursive: true })
const sourceAt = path => baseline
  ? execFileSync('git', ['show', baseline + ':' + relative(root, path).replaceAll('\\', '/')], { cwd: root, windowsHide: true })
  : readFileSync(path)
const component = join(root, 'src/renderer/src/components/Live2DPet.tsx')
const componentSource = sourceAt(component).toString('utf8')
const director = join(root, 'src/renderer/src/avatar/activity-motion-director.ts')
const directorSource = baseline ? null : readFileSync(director, 'utf8')
writeFileSync(join(output, 'component-source.txt'), componentSource)
if (directorSource) writeFileSync(join(output, 'director-source.txt'), directorSource)
const source = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {Live2DModel} from 'pixi-live2d-display/cubism4';
import {extensions,ExtensionType} from 'pixi.js';
import {Live2DPet} from './src/renderer/src/components/Live2DPet';
import {getPetPreset} from './src/shared/pet-presets';
const h=window.harness={frames:[],events:[],modelLoads:0,renderKey:0,config:{fps:60,paused:false},currentActivity:null};
extensions.add({extension:ExtensionType.Application,init(){h.app=this},destroy(){}});
const originalFrom=Live2DModel.from;
Live2DModel.from=async function(...args){
 const model=await originalFrom.apply(this,args);h.model=model;h.modelLoads++;
 const internal=model.internalModel;const update=internal.update.bind(internal);let previous;let applied;
 const updateCore=internal.coreModel.update.bind(internal.coreModel);
 internal.coreModel.update=()=>{const p=internal.coreModel.getModel().parameters;applied=Object.fromEntries(p.ids.map((id,i)=>[id,p.values[i]]));updateCore();};
 internal.motionManager.on('motionStart',group=>h.events.push({group,frame:h.frames.length}));
 internal.update=(dt,now)=>{
  update(dt,now);const raw=internal.coreModel.getModel();
  const vertices=raw.drawables.vertexPositions.flatMap(v=>Array.from(v));let step=0;
  if(previous)for(let i=0;i<vertices.length;i++)step=Math.max(step,Math.abs(vertices[i]-previous[i]));
  previous=vertices;h.frames.push({dt,now,step,group:internal.motionManager.state.currentGroup,priority:internal.motionManager.state.currentPriority,parameters:applied});
 };
 return model;
};
const preset=getPetPreset(new URL(location.href).searchParams.get('preset')??'naiwa');
const renderer=createRoot(document.querySelector('#pet'));
const setRef=ref=>{h.ref=ref};
h.render=()=>renderer.render(React.createElement(Live2DPet,{...h.config,key:h.renderKey,ref:setRef,preset,activityMotion:h.currentActivity}));
h.activity=(activityMotion=null)=>{h.currentActivity=activityMotion;h.render()};
h.configure=config=>{Object.assign(h.config,config);h.render()};
h.remount=()=>{h.renderKey++;h.render()};
h.activity();
h.step=async(frames)=>{h.app.ticker.stop();let time=h.app.ticker.lastTime;for(let i=0;i<frames;i++){time+=1000/60;h.app.ticker.update(time);await Promise.resolve();}};
h.state=()=>({...h.model.internalModel.motionManager.state,frame:h.frames.length});
`
await build({ stdin: { contents: source, resolveDir: root, loader: 'tsx' }, bundle: true, outfile: join(output, 'component.js'), platform: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': '"production"' }, alias: { '@shared': join(root, 'src/shared') }, jsx: 'automatic', plugins: [{ name: 'component-under-test', setup(build) {
  build.onLoad({ filter: /[\\/]Live2DPet\.tsx$/ }, () => ({ contents: componentSource, loader: 'tsx', resolveDir: dirname(component) }))
  if (directorSource) build.onLoad({ filter: /[\\/]activity-motion-director\.ts$/ }, () => ({ contents: directorSource, loader: 'ts', resolveDir: dirname(director) }))
} }] })
writeFileSync(join(output, 'index.html'), '<!doctype html><meta charset="utf-8"><base href="/src/renderer/public/"><style>html,body{margin:0;background:#ece8e1;color:#343b44;font-family:Arial,sans-serif}#pet,.live2d-pet-host{width:640px;height:640px}.live2d-canvas{width:100%;height:100%;display:block}#caption{position:absolute;top:10px;left:18px;font-size:15px;pointer-events:none}</style><div id="caption">Actual component / original native Cubism model</div><div id="pet"></div><script src="live2d/core/live2dcubismcore.min.js"></script><script src="/' + relative(root, join(output, 'component.js')).replaceAll('\\', '/') + '"></script>')
writeFileSync(join(output, 'main.cjs'), "const {app,BrowserWindow}=require('electron');app.commandLine.appendSwitch('force-device-scale-factor','1');app.setPath('userData',process.env.SIXTH_NATIVE_PROFILE);app.whenReady().then(()=>{const w=new BrowserWindow({width:640,height:640,useContentSize:true,show:false,webPreferences:{backgroundThrottling:false}});w.loadURL(process.env.SIXTH_NATIVE_URL)});")
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' }
const server = createServer((request, response) => {
  try {
    const path = resolve(root, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname))
    const rel = relative(root, path)
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Outside workspace')
    response.setHeader('Content-Type', mime[extname(path)] ?? 'application/octet-stream')
    response.end(baseline && rel.replaceAll('\\', '/').startsWith('src/renderer/public/live2d/naiwa/') && extname(path) === '.json' ? sourceAt(path) : readFileSync(path))
  } catch { response.writeHead(404); response.end('Not found') }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const url = `http://127.0.0.1:${server.address().port}/` + relative(root, join(output, 'index.html')).replaceAll('\\', '/')
const app = await electron.launch({ args: [join(output, 'main.cjs')], cwd: root, env: { ...process.env, TEMP: temp, TMP: temp, SIXTH_NATIVE_PROFILE: join(temp, `profile-${label}-${Date.now()}`), SIXTH_NATIVE_URL: url } })
const errors = []
const sequences = []
try {
  const page = await app.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  const ready = async preset => {
    await page.goto(url + '?preset=' + preset)
    await page.locator('[data-live2d-state="ready"]').waitFor({ timeout: 30000 })
    await page.evaluate(() => window.harness.app.ticker.stop())
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
  // Use the SDK's actual rendering and parameter ranges, including which curves
  // are owned by the original physics. Do not infer rig capabilities from names.
  await ready('naiwa')
  const capability = await page.evaluate(() => {
    const raw = window.harness.model.internalModel.coreModel.getModel()
    const p = raw.parameters
    const saved = Array.from(p.values)
    p.values.set(p.defaultValues); raw.update()
    const neutral = raw.drawables.vertexPositions.map(v => Array.from(v))
    const opacity = Array.from(raw.drawables.opacities)
    const parameters = p.ids.map((id, i) => {
      const probes = [p.minimumValues[i], p.maximumValues[i]].map(value => {
        p.values.set(p.defaultValues); p.values[i] = value; raw.update()
        let vertexDelta = 0; let opacityDelta = 0
        raw.drawables.vertexPositions.forEach((v, j) => v.forEach((n, k) => { vertexDelta = Math.max(vertexDelta, Math.abs(n - neutral[j][k])) }))
        raw.drawables.opacities.forEach((v, j) => { opacityDelta = Math.max(opacityDelta, Math.abs(v - opacity[j])) })
        return { value, vertexDelta, opacityDelta }
      })
      return { id, min: p.minimumValues[i], max: p.maximumValues[i], default: p.defaultValues[i], probes }
    })
    p.values.set(saved); raw.update()
    return { parameters }
  })
  writeFileSync(join(output, 'capabilities.json'), JSON.stringify(capability, null, 2) + '\n')
  for (const item of [
    { preset: 'tororo', group: 'Idle', seconds: 14 },
    { preset: 'whale-girl', group: 'idle', seconds: 14 },
    { preset: 'naiwa', group: baseline ? 'Working' : 'WorkingLoop', seconds: 26, persistent: !baseline },
    { preset: 'naiwa', group: 'Think', seconds: 6 },
    { preset: 'naiwa', group: 'Greet', seconds: 4 },
    { preset: 'naiwa', group: 'Agree', seconds: 4 }
  ].filter(item => !process.env.SIXTH_NATIVE_WORK_ONLY || item.preset === 'naiwa' && item.group.startsWith('Working'))) {
    await ready(item.preset)
    await step(120)
    if (item.persistent) {
      await page.evaluate(group => window.harness.activity({ key: 'render-work', motion: group, expression: null, loop: true }), item.group)
      await page.waitForFunction(group => window.harness.state().currentGroup === group, item.group)
    } else await named(item.group)
    const start = await page.evaluate(() => window.harness.frames.length)
    const checkpoints = new Set([30, 90, 150, 180, 240, 300, 344, 360, 390, 450, 540, 660, 704, 720, 750, 900, 1080, 1440])
    const encoder = item.preset === 'naiwa' && item.group.startsWith('Working')
      ? spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', '30', '-vcodec', 'png', '-i', 'pipe:0', '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', join(output, 'working.mp4')], { windowsHide: true })
      : null
    let encoderErrors = ''
    encoder?.stderr.on('data', data => { encoderErrors += data.toString() })
    const encoded = encoder ? once(encoder, 'close') : null
    if (encoder) await page.evaluate(() => {
      const canvas = window.recordCanvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 640
      window.videoFrame = time => {
        const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ece8e1'; ctx.fillRect(0, 0, 640, 640)
        ctx.drawImage(window.harness.app.view, 0, 0); ctx.fillStyle = '#343b44'; ctx.font = '16px Arial'
        ctx.fillText('Native Working / ' + time.toFixed(2) + ' s / ' + window.harness.state().currentGroup, 18, 28)
        return canvas.toDataURL('image/png').split(',')[1]
      }
    })
    try {
      for (let frame = 2; frame <= item.seconds * 60; frame += 2) {
        await step(2)
        if (checkpoints.has(frame)) await capture(`${item.preset}-${item.group}-${String(frame).padStart(4, '0')}`)
        if (encoder) {
          const png = await page.evaluate(time => window.videoFrame(time), frame / 60)
          if (!encoder.stdin.write(Buffer.from(png, 'base64'))) await once(encoder.stdin, 'drain')
        }
      }
      if (encoder) { encoder.stdin.end(); const [code] = await encoded; assert.equal(code, 0, encoderErrors) }
    } catch (error) { encoder?.kill(); throw error }
    const data = await page.evaluate(start => ({ frames: window.harness.frames.slice(start), events: window.harness.events.filter(event => event.frame >= start), state: window.harness.state(), motionLoop: window.harness.model.internalModel.motionManager.motionGroups[window.harness.state().currentGroup]?.[0]?.isLoop?.() }), start)
    const summary = { ...item, maxStep: Math.max(...data.frames.map(frame => frame.step)), finalGroup: data.state.currentGroup, motionLoop: data.motionLoop, events: data.events }
    sequences.push(summary)
    writeFileSync(join(output, `${item.preset}-${item.group}-samples.json`), JSON.stringify({ ...summary, frames: data.frames }, null, 2) + '\n')
    console.log(JSON.stringify(summary))
    if (item.persistent) {
      assert.equal(data.state.currentGroup, 'WorkingLoop', 'work must still be active after two full periods')
      assert.equal(data.motionLoop, true, 'SDK loop flag must be set by production component')
      const steady = data.frames.slice(120)
      const boundaryFrames = steady.filter((_, i) => Math.abs(((i + 120) / 60) - 12) < .3 || Math.abs(((i + 120) / 60) - 24) < .3)
      const loopBoundaryStep = Math.max(...boundaryFrames.map(frame => frame.step))
      assert.ok(loopBoundaryStep < .004, `body seam displaced by ${loopBoundaryStep}`)
      assert.ok(steady.every(frame => frame.parameters.Paramyt13 >= .1), 'work hands must remain gathered during each loop')
      const transitions = []
      const transientStart = await page.evaluate(() => window.harness.frames.length)
      await named('Greet')
      await step(240)
      const resumed = await page.evaluate(start => ({ frames: window.harness.frames.slice(start), group: window.harness.state().currentGroup }), transientStart)
      assert.equal(resumed.group, 'WorkingLoop', 'completed spoken/semantic response must restore current work')
      const resumeStep = Math.max(...resumed.frames.map(frame => frame.step))
      assert.ok(resumeStep < .025, `transient return displaced by ${resumeStep}`)
      transitions.push({ name: 'transient-greet-resumes-work', expected: 'WorkingLoop', group: resumed.group, maxStep: resumeStep })
      await capture('naiwa-activity-transient-resumed')

      await page.evaluate(() => window.harness.configure({ fps: 8 }))
      await page.waitForFunction(() => window.harness.app.ticker.maxFPS === 8)
      const lowFpsStart = await page.evaluate(() => { window.harness.app.ticker.stop(); return window.harness.frames.length })
      await step(780)
      const lowFps = await page.evaluate(start => ({ frames: window.harness.frames.slice(start), group: window.harness.state().currentGroup }), lowFpsStart)
      writeFileSync(join(output, 'low-fps-samples.json'), JSON.stringify(lowFps, null, 2) + '\n')
      assert.equal(lowFps.group, 'WorkingLoop')
      assert.ok(lowFps.frames.length >= 90 && lowFps.frames.length <= 110, `13 seconds at 8 fps rendered ${lowFps.frames.length} frames`)
      const lowFpsStep = Math.max(...lowFps.frames.map(frame => frame.step))
      // One 8-fps sample spans 7.5 normal frames and can contain an entire blink.
      // Compare the same velocity envelope used by the 60-fps transition gate,
      // instead of treating its larger absolute per-frame distance as a snap.
      const lowFpsVelocity = Math.max(...lowFps.frames.filter(frame => frame.dt > 0).map(frame => frame.step * 1000 / frame.dt))
      assert.ok(lowFpsVelocity < .025 * 60, `8 fps mesh velocity exceeded the 60 fps envelope: ${lowFpsVelocity}`)
      transitions.push({ name: 'low-fps-work', expected: 'WorkingLoop', group: lowFps.group, maxStep: lowFpsStep, maxVelocity: lowFpsVelocity, frames: lowFps.frames.length })
      await capture('naiwa-activity-low-fps')

      const loadCount = await page.evaluate(() => { const count = window.harness.modelLoads; window.harness.remount(); return count })
      await page.waitForFunction(count => window.harness.modelLoads > count && window.harness.state().currentGroup === 'WorkingLoop', loadCount)
      await page.locator('[data-live2d-state="ready"]').waitFor()
      await step(180)
      assert.equal(await page.evaluate(() => window.harness.state().currentGroup), 'WorkingLoop', 'current activity must survive native model reload')
      transitions.push({ name: 'model-reload', expected: 'WorkingLoop', group: 'WorkingLoop' })
      await capture('naiwa-activity-reloaded')
      await page.evaluate(() => window.harness.configure({ fps: 60 }))
      await page.waitForFunction(() => window.harness.app.ticker.maxFPS === 60)
      await step(12)
      for (const next of [
        { name: 'think', activity: { key: 'render-think', motion: 'Think', expression: null, loop: true }, expected: 'Think', frames: 180 },
        { name: 'work-resume', activity: { key: 'render-work-2', motion: 'WorkingLoop', expression: null, loop: true }, expected: 'WorkingLoop', frames: 150 },
        { name: 'cancel', activity: null, expected: 'Idle', frames: 150 }
      ]) {
        const transitionStart = await page.evaluate(() => window.harness.frames.length)
        await page.evaluate(activity => window.harness.activity(activity), next.activity)
        await page.waitForFunction(group => window.harness.state().currentGroup === group, next.expected)
        await step(next.frames)
        await capture('naiwa-activity-' + next.name)
        const result = await page.evaluate(start => ({ frames: window.harness.frames.slice(start), group: window.harness.state().currentGroup }), transitionStart)
        const peak = Math.max(...result.frames.map(frame => frame.step))
        assert.ok(peak < .025, `${next.name} transition displaced by ${peak}`)
        assert.equal(result.group, next.expected)
        transitions.push({ name: next.name, expected: next.expected, group: result.group, maxStep: peak })
      }
      writeFileSync(join(output, 'loop-and-transitions.json'), JSON.stringify({ loopBoundaryStep, transitions }, null, 2) + '\n')
    }
  }
  const sourceHashes = Object.fromEntries([
    '奶蛙.model3.json', '奶蛙.moc3', '奶蛙.physics3.json',
    'motions/working-attentive.motion3.json',
    ...(!baseline ? ['motions/working-continuous.motion3.json'] : [])
  ].map(file => [file, createHash('sha256').update(sourceAt(join(root, 'src/renderer/public/live2d/naiwa', file))).digest('hex')]))
  writeFileSync(join(output, 'report.json'), JSON.stringify({ generatedAt: new Date().toISOString(), label, baseline, componentSha256: createHash('sha256').update(componentSource).digest('hex'), directorSha256: directorSource ? createHash('sha256').update(directorSource).digest('hex') : null, sourceHashes, runtime: 'Actual production Live2DPet, original Cubism moc3/textures/physics, 60 Hz model updates and 30 fps captured video', sequences, errors }, null, 2) + '\n')
  assert.equal(errors.length, 0, errors.join('; '))
} finally {
  await app.close()
  await new Promise(resolve => server.close(resolve))
}
