/* global window, document */
import assert from 'node:assert/strict'
import { _electron as electron } from '@playwright/test'
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve, extname, relative, isAbsolute, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

// Exercise the actual React component, Pixi ticker, Cubism SDK and original moc3.
// A second clock advancing while the component is paused must fail this check.
const root = resolve(import.meta.dirname, '..')
const label = process.argv[2] ?? 'current'
assert.match(label, /^[a-z0-9-]+$/)
const output = join(root, 'previews/overnight-2026-10-29/native-motion-maturity', label)
const temp = join(root, 'previews/tmp/nailong-motion-maturity')
mkdirSync(output, { recursive: true })
mkdirSync(temp, { recursive: true })
const component = join(root, 'src/renderer/src/components/Live2DPet.tsx')
const baseline = process.argv[3]
if (baseline) assert.match(baseline, /^[a-f0-9]{40}$/)
const componentSource = baseline
  ? execFileSync('git', ['show', baseline + ':src/renderer/src/components/Live2DPet.tsx'], { cwd: root, encoding: 'utf8', windowsHide: true })
  : readFileSync(component, 'utf8')
const source = `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {Live2DModel} from 'pixi-live2d-display/cubism4';
import {extensions,ExtensionType} from 'pixi.js';
import {Live2DPet} from './src/renderer/src/components/Live2DPet';
import {getPetPreset} from './src/shared/pet-presets';
const harness=window.harness={models:[],frames:[],props:{paused:false,fps:Number(new URL(location.href).searchParams.get('fps')??24)}};
extensions.add({extension:ExtensionType.Application,init(){harness.app=this},destroy(){}});
const originalFrom=Live2DModel.from;
Live2DModel.from=async function(...args){
  const model=await originalFrom.apply(this,args);harness.models.push(model);harness.model=model;
  const internal=model.internalModel;const update=internal.update.bind(internal);let previous;
  internal.update=(dt,now)=>{
    update(dt,now);
    const raw=internal.coreModel.getModel();const flat=raw.drawables.vertexPositions.flatMap(v=>Array.from(v));
    let step=0;if(previous)for(let i=0;i<flat.length;i++)step=Math.max(step,Math.abs(flat[i]-previous[i]));previous=flat;
    harness.frames.push({wall:performance.now(),dt,now,group:internal.motionManager.state.currentGroup,step});
  };
  return model;
};
function Harness(){const [props,setProps]=useState(harness.props);harness.configure=(next)=>{flushSync(()=>setProps(p=>{harness.props={...p,...next};return harness.props}));};return React.createElement(Live2DPet,{...props,ref:ref=>{harness.ref=ref},preset:getPetPreset('naiwa')});}
const renderer=createRoot(document.querySelector('#pet'));renderer.render(React.createElement(Harness));harness.unmount=()=>flushSync(()=>renderer.unmount());
harness.snapshot=()=>({elapsed:harness.model.elapsedTime,pending:harness.model.deltaTime,frames:harness.frames.length,group:harness.model.internalModel.motionManager?.state.currentGroup,wall:performance.now()});
`
await build({ stdin: { contents: source, resolveDir: root, loader: 'tsx' }, bundle: true, outfile: join(output, 'component.js'), platform: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': '"production"' }, alias: { '@shared': join(root, 'src/shared') }, jsx: 'automatic', plugins: [{ name: 'component-under-test', setup(build) { build.onLoad({ filter: /[\\/]Live2DPet\.tsx$/ }, () => ({ contents: componentSource, loader: 'tsx', resolveDir: dirname(component) })) } }] })
writeFileSync(join(output, 'index.html'), '<!doctype html><meta charset="utf-8"><base href="/src/renderer/public/"><style>html,body{margin:0;background:#ece8e1;color:#343b44;font-family:Arial,sans-serif}#pet,.live2d-pet-host{width:640px;height:640px}.live2d-canvas{width:100%;height:100%;display:block}#caption{position:absolute;top:10px;left:18px;font-size:15px;pointer-events:none}</style><div id="caption">Native Nailong · actual production component</div><div id="pet"></div><script src="live2d/core/live2dcubismcore.min.js"></script><script src="/' + relative(root, join(output, 'component.js')).replaceAll('\\', '/') + '"></script>')
writeFileSync(join(output, 'main.cjs'), "const {app,BrowserWindow}=require('electron');app.commandLine.appendSwitch('force-device-scale-factor','1');app.setPath('userData',process.env.NAILONG_MATURITY_PROFILE);app.whenReady().then(()=>{const w=new BrowserWindow({width:640,height:640,useContentSize:true,show:false,webPreferences:{backgroundThrottling:false}});w.loadURL(process.env.NAILONG_MATURITY_URL)});")
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
const app = await electron.launch({ args: [join(output, 'main.cjs')], cwd: root, env: { ...process.env, TEMP: temp, TMP: temp, NAILONG_MATURITY_PROFILE: join(temp, `profile-${label}-${Date.now()}`), NAILONG_MATURITY_URL: url } })
const errors = []
const checks = []
const recordCheck = (name, passed, evidence) => checks.push({ name, passed, ...evidence })
try {
  const page = await app.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  await page.locator('[data-live2d-state="ready"]').waitFor({ timeout: 30000 })
  await page.waitForFunction(() => window.harness.frames.length > 3)
  for (const scenario of [
    { name: 'hidden-pause', group: 'Greet', config: { paused: true }, resume: { paused: false }, holdMs: 3200 },
    { name: 'zero-fps', group: 'Think', config: { fps: 0 }, resume: { fps: 24 }, holdMs: 1600 }
  ]) {
    await page.evaluate(group => window.harness.ref.playNamedMotion(group, null), scenario.group)
    await page.waitForFunction(group => window.harness.frames.at(-1).group === group, scenario.group)
    await page.waitForTimeout(450)
    await page.evaluate(config => window.harness.configure(config), scenario.config)
    await page.waitForTimeout(80)
    const before = await page.evaluate(() => window.harness.snapshot())
    await page.screenshot({ path: join(output, `${scenario.name}-before.png`) })
    await page.waitForTimeout(scenario.holdMs)
    const held = await page.evaluate(() => window.harness.snapshot())
    await page.screenshot({ path: join(output, `${scenario.name}-held.png`) })
    await page.evaluate(config => window.harness.configure(config), scenario.resume)
    await page.waitForFunction(count => window.harness.frames.length > count + 2, held.frames)
    const resumed = await page.evaluate(count => ({ snapshot: window.harness.snapshot(), frames: window.harness.frames.slice(count) }), held.frames)
    await page.screenshot({ path: join(output, `${scenario.name}-resumed.png`) })
    const elapsedWhilePaused = held.elapsed - before.elapsed
    const maxResumeDeltaMs = Math.max(...resumed.frames.map(frame => frame.dt))
    recordCheck(`${scenario.name}: model clock is frozen`, Math.abs(elapsedWhilePaused) < 0.01 && held.frames === before.frames, { before, held, elapsedWhilePaused })
    recordCheck(`${scenario.name}: first frames resume the interrupted action`, maxResumeDeltaMs < 150 && resumed.frames.every(frame => frame.group === scenario.group), { maxResumeDeltaMs, resumed })
  }
  // Hidden Windows surfaces can throttle requestAnimationFrame independently of
  // Pixi. Feed the real app ticker 120 display ticks for a reproducible FPS check.
  for (const fps of [60, 24, 12, 8]) {
    const cadence = await page.evaluate(fps => {
      const harness = window.harness
      harness.configure({ fps })
      const ticker = harness.app.ticker
      ticker.stop()
      const before = harness.snapshot()
      const start = ticker.lastTime
      for (let frame = 1; frame <= 120; frame++) ticker.update(start + frame * 1000 / 60)
      const after = harness.snapshot()
      return { before, after, elapsedDelta: after.elapsed - before.elapsed, renders: after.frames - before.frames }
    }, fps)
    recordCheck(`${fps} fps preserves motion time and render budget over two seconds`, cadence.elapsedDelta >= 1800 && cadence.elapsedDelta <= 2010 && cadence.renders >= fps * 2 - 2 && cadence.renders <= fps * 2 + 1, cadence)
  }
  await page.evaluate(() => window.harness.unmount())
  const removedStart = await page.evaluate(() => window.harness.snapshot())
  await page.waitForTimeout(300)
  const removedEnd = await page.evaluate(() => window.harness.snapshot())
  recordCheck('unmount detaches animation clock', removedStart.elapsed === removedEnd.elapsed && removedStart.frames === removedEnd.frames, { removedStart, removedEnd })
  await page.goto(url + '?fps=0')
  await page.locator('[data-live2d-state="ready"]').waitFor({ timeout: 30000 })
  const reducedBefore = await page.evaluate(() => {
    const harness = window.harness
    const gl = harness.app.renderer.gl
    const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4)
    gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    let visiblePixels = 0
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) visiblePixels++
    return { ...harness.snapshot(), visiblePixels }
  })
  await page.screenshot({ path: join(output, 'initial-zero-fps.png') })
  await page.waitForTimeout(350)
  const reducedAfter = await page.evaluate(() => window.harness.snapshot())
  recordCheck('initial reduced-motion mode shows a static native character', reducedBefore.visiblePixels > 1000 && reducedAfter.elapsed === reducedBefore.elapsed && reducedAfter.frames === reducedBefore.frames, { reducedBefore, reducedAfter })
  await page.evaluate(() => {
    const host = document.querySelector('.live2d-pet-host')
    host.style.width = '520px'
    host.style.height = '520px'
    window.dispatchEvent(new Event('resize'))
  })
  await page.waitForFunction(() => window.harness.app.renderer.width === 520)
  await page.screenshot({ path: join(output, 'resized-zero-fps.png') })
  const resized = await page.evaluate(() => {
    const harness = window.harness
    const gl = harness.app.renderer.gl
    const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4)
    gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    let visiblePixels = 0
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) visiblePixels++
    return { ...harness.snapshot(), visiblePixels }
  })
  recordCheck('static native character stays visible after resize without advancing animation', resized.visiblePixels > 1000 && resized.elapsed === reducedAfter.elapsed, { resized })
  recordCheck('native page has no runtime errors', errors.length === 0, { errors })
  const report = { generatedAt: new Date().toISOString(), label, baseline, componentSha256: createHash('sha256').update(componentSource).digest('hex'), runtime: 'Actual Live2DPet.tsx bundled with installed React, Pixi, pixi-live2d-display and original moc3. Pause uses real time; cadence feeds the real Pixi ticker controlled display times. No mocked model.', checks, passed: checks.every(check => check.passed) }
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
  assert.ok(report.passed, checks.filter(check => !check.passed).map(check => check.name).join('; '))
} finally {
  await app.close()
  await new Promise(resolve => server.close(resolve))
}
