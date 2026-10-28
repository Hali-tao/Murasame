/* global window, document */
import assert from 'node:assert/strict'
import { _electron as electron } from '@playwright/test'
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { join, resolve, extname, relative, isAbsolute } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const label = process.argv[2] ?? 'current'
assert.match(label, /^[a-z0-9-]+$/)
const baseline = process.argv[3]
if (baseline) assert.match(baseline, /^[a-f0-9]{7,40}$/)
const output = join(root, 'previews/overnight-2026-10-29/fifth-native/whale-expressions', label)
const temp = join(root, 'previews/tmp/fifth-whale-expressions')
mkdirSync(output, { recursive: true })
mkdirSync(temp, { recursive: true })
const modelPath = 'src/renderer/public/live2d/whale-girl/c_0120.model3.json'
const modelSource = baseline ? execFileSync('git', ['show', baseline + ':' + modelPath], { cwd: root, encoding: 'utf8', windowsHide: true }) : readFileSync(join(root, modelPath), 'utf8')
const names = readdirSync(join(root, 'src/renderer/public/live2d/whale-girl/expressions')).filter(file => file.endsWith('.exp3.json')).map(file => file.replace('.exp3.json', ''))
await build({ stdin: { contents: `
import React from 'react';import {createRoot} from 'react-dom/client';
import {Live2DModel} from 'pixi-live2d-display/cubism4';import {extensions,ExtensionType} from 'pixi.js';
import {Live2DPet} from './src/renderer/src/components/Live2DPet';import {getPetPreset} from './src/shared/pet-presets';
const h=window.harness={samples:[]};extensions.add({extension:ExtensionType.Application,init(){h.app=this},destroy(){}});
const originalFrom=Live2DModel.from;Live2DModel.from=async function(...args){const m=await originalFrom.apply(this,args);h.model=m;
const core=m.internalModel.coreModel;const update=core.update.bind(core);core.update=()=>{const p=core.getModel().parameters;h.parameters=Object.fromEntries(p.ids.map((id,i)=>[id,p.values[i]]));update();};return m;};
createRoot(document.querySelector('#pet')).render(React.createElement(Live2DPet,{fps:60,ref:r=>{h.ref=r},preset:getPetPreset('whale-girl')}));
h.step=async(frames)=>{h.app.ticker.stop();let time=h.app.ticker.lastTime;for(let i=0;i<frames;i++){time+=1000/60;h.app.ticker.update(time);await Promise.resolve();}};
h.snapshot=()=>{const i=h.model.internalModel;const raw=i.coreModel.getModel();return {group:i.motionManager.state.currentGroup,parameters:h.parameters,drawableOpacities:Object.fromEntries(raw.drawables.ids.map((id,n)=>[id,raw.drawables.opacities[n]]))};};
`, resolveDir: root, loader: 'tsx' }, bundle: true, outfile: join(output, 'component.js'), platform: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': '"production"' }, alias: { '@shared': join(root, 'src/shared') }, jsx: 'automatic' })
writeFileSync(join(output, 'index.html'), '<!doctype html><meta charset="utf-8"><base href="/src/renderer/public/"><style>html,body{margin:0;background:#ece8e1;color:#343b44;font-family:Arial,sans-serif}#pet,.live2d-pet-host{width:640px;height:640px}.live2d-canvas{width:100%;height:100%;display:block}#caption{position:absolute;top:10px;left:18px;font-size:15px;pointer-events:none}</style><div id="caption">Original native whale model · production component</div><div id="pet"></div><script src="live2d/core/live2dcubismcore.min.js"></script><script src="/' + relative(root, join(output, 'component.js')).replaceAll('\\', '/') + '"></script>')
writeFileSync(join(output, 'main.cjs'), "const {app,BrowserWindow}=require('electron');app.commandLine.appendSwitch('force-device-scale-factor','1');app.setPath('userData',process.env.FIFTH_WHALE_PROFILE);app.whenReady().then(()=>{const w=new BrowserWindow({width:640,height:640,useContentSize:true,show:false,webPreferences:{backgroundThrottling:false}});w.loadURL(process.env.FIFTH_WHALE_URL)});")
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' }
const server = createServer((request, response) => {
  try {
    const path = resolve(root, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname))
    const rel = relative(root, path)
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Outside workspace')
    response.setHeader('Content-Type', mime[extname(path)] ?? 'application/octet-stream')
    response.end(path === join(root, modelPath) ? modelSource : readFileSync(path))
  } catch { response.writeHead(404); response.end('Not found') }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const url = `http://127.0.0.1:${server.address().port}/` + relative(root, join(output, 'index.html')).replaceAll('\\', '/')
const app = await electron.launch({ args: [join(output, 'main.cjs')], cwd: root, env: { ...process.env, TEMP: temp, TMP: temp, FIFTH_WHALE_PROFILE: join(temp, `profile-${label}-${Date.now()}`), FIFTH_WHALE_URL: url } })
const errors = []
const checks = []
const poses = []
const record = (name, passed, evidence) => checks.push({ name, passed, ...evidence })
try {
  const page = await app.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  const ready = async () => {
    await page.goto(url)
    await page.locator('[data-live2d-state="ready"]').waitFor({ timeout: 30000 })
    await page.evaluate(() => window.harness.app.ticker.stop())
  }
  const capture = async name => {
    await page.evaluate(name => { document.querySelector('#caption').textContent = name }, name)
    await page.screenshot({ path: join(output, name + '.png') })
    const pose = await page.evaluate(() => window.harness.snapshot())
    poses.push({ name, ...pose })
    return pose
  }
  const expression = async name => {
    await page.evaluate(name => window.harness.ref.playNamedMotion('idle', name), name)
    const registered = await page.evaluate(name => window.harness.model.internalModel.motionManager.expressionManager?.definitions.some(def => def.Name === name) ?? false, name)
    if (registered) await page.waitForFunction(name => {
      const m = window.harness.model.internalModel.motionManager.expressionManager
      return m.currentExpression === m.expressions[m.definitions.findIndex(def => def.Name === name)]
    }, name)
    await page.evaluate(() => window.harness.step(120))
  }
  await ready()
  const loading = await page.evaluate(async names => {
    const manager = window.harness.model.internalModel.motionManager.expressionManager
    const p = window.harness.model.internalModel.coreModel.getModel().parameters
    return Promise.all(names.map(async name => {
      const index = manager?.definitions.findIndex(def => def.Name === name) ?? -1
      const expression = index >= 0 ? await manager.loadExpression(index) : null
      return { name, registered: index >= 0, loaded: Boolean(expression), nativeParameterCount: p.ids.length }
    }))
  }, names)
  record('all 44 authored expression files are registered and parsed by Cubism', loading.length === 44 && loading.every(item => item.registered && item.loaded), { expressions: loading })
  await page.evaluate(() => window.harness.step(120))
  const neutral = await capture('01-neutral')
  await expression('问号')
  const question = await capture('02-question')
  const questionDrawables = Object.entries(question.drawableOpacities).filter(([id, value]) => value - neutral.drawableOpacities[id] > 0.9).map(([id]) => id)
  record('question mark reaches its authored parameter and exposes native drawables', question.parameters.ParamCheek74 > 0.99 && questionDrawables.length > 0, { parameter: question.parameters.ParamCheek74, newlyVisibleDrawables: questionDrawables })
  await page.evaluate(() => window.harness.ref.playMotion('tap'))
  await page.waitForTimeout(100)
  await page.evaluate(() => window.harness.step(30))
  const protectedQuestion = await capture('03-question-after-tap')
  record('tap preserves the displayed semantic question mark', protectedQuestion.group === 'idle' && protectedQuestion.parameters.ParamCheek74 > 0.99, { group: protectedQuestion.group, parameter: protectedQuestion.parameters.ParamCheek74 })
  await expression('悲伤')
  const sad = await capture('04-sad-question-cleared')
  record('switching to sadness fades away the previous question mark', sad.parameters.ParamCheek74 < 0.01 && sad.parameters.ParamCheek15 > 0.99 && questionDrawables.every(id => sad.drawableOpacities[id] < 0.01), { question: sad.parameters.ParamCheek74, sadness: sad.parameters.ParamCheek15, questionDrawables: questionDrawables.map(id => ({ id, opacity: sad.drawableOpacities[id] })) })
  await expression('问号')
  const restored = await capture('05-question-restored')
  record('switching back restores the question mark and releases sadness', restored.parameters.ParamCheek74 > 0.99 && restored.parameters.ParamCheek15 < 0.01 && questionDrawables.every(id => restored.drawableOpacities[id] > 0.99), { question: restored.parameters.ParamCheek74, sadness: restored.parameters.ParamCheek15 })
  await ready()
  await page.evaluate(() => window.harness.step(120))
  const reloaded = await capture('06-reloaded-neutral')
  record('reloading the avatar restores neutral expression state', reloaded.parameters.ParamCheek74 < 0.01 && reloaded.parameters.ParamCheek15 < 0.01, { question: reloaded.parameters.ParamCheek74, sadness: reloaded.parameters.ParamCheek15 })
  record('native expression render has no runtime errors', errors.length === 0, { errors })
  const report = { generatedAt: new Date().toISOString(), label, baseline, model3Sha256: createHash('sha256').update(modelSource).digest('hex'), componentSha256: createHash('sha256').update(readFileSync(join(root, 'src/renderer/src/components/Live2DPet.tsx'))).digest('hex'), runtime: 'Actual production Live2DPet, original Cubism moc3/textures/physics/motions. No mocked model. Original expression JSON is loaded through the registered model3 references.', checks, passed: checks.every(check => check.passed) }
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  writeFileSync(join(output, 'poses.json'), JSON.stringify(poses, null, 2) + '\n')
  console.log(JSON.stringify({ label, passed: report.passed, checks: checks.length, failed: checks.filter(check => !check.passed) }, null, 2))
  assert.ok(report.passed, checks.filter(check => !check.passed).map(check => check.name).join('; '))
} finally {
  await app.close()
  await new Promise(resolve => server.close(resolve))
}
