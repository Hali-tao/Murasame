/* global window, document */
import { _electron as electron } from '@playwright/test'
import { createServer } from 'node:http'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve, extname } from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createHash } from 'node:crypto'

const root = resolve(import.meta.dirname, '..')
const output = join(root, 'previews/overnight-2026-10-29/nailong')
const temp = join(root, 'previews/tmp/nailong-motion-render')
mkdirSync(output, { recursive: true })
mkdirSync(temp, { recursive: true })
const mode = process.argv[2] ?? 'probe'
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' }
const server = createServer((request, response) => {
  try {
    const path = resolve(root, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname))
    if (!path.startsWith(root + '\\') && !path.startsWith(root + '/')) throw new Error('Invalid path')
    response.setHeader('Content-Type', mime[extname(path)] ?? 'application/octet-stream')
    response.end(readFileSync(path))
  } catch { response.writeHead(404); response.end('Not found') }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = `http://127.0.0.1:${server.address().port}`
writeFileSync(join(output, 'render-main.cjs'), `const {app,BrowserWindow}=require('electron'); app.commandLine.appendSwitch('force-device-scale-factor','1');app.setPath('userData',process.env.MURASAME_MOTION_USER_DATA); app.whenReady().then(()=>{const w=new BrowserWindow({width:900,height:900,useContentSize:true,show:false,webPreferences:{backgroundThrottling:false}});w.loadURL(process.env.MURASAME_MOTION_URL);});`)
writeFileSync(join(output, 'render.html'), `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;overflow:hidden;background:#ece8e1;color:#343b44;font-family:Arial,sans-serif}h1{font-size:20px;position:absolute;left:28px;top:12px}p{font-size:13px;position:absolute;left:28px;bottom:8px}canvas{display:block}</style><h1 id="label">Original 奶蛙.moc3 · native Cubism render</h1><p>No texture changes · original physics · deterministic 60 Hz sampling</p><script src="/src/renderer/public/live2d/core/live2dcubismcore.min.js"></script><script src="/node_modules/pixi.js/dist/browser/pixi.min.js"></script><script src="/node_modules/pixi-live2d-display/dist/cubism4.min.js"></script><script>
window.ready=(async()=>{
const app = window.pixiApp = new PIXI.Application({width:900,height:900,backgroundAlpha:0,preserveDrawingBuffer:true,antialias:true,autoStart:false});document.body.appendChild(app.view);app.stop();
const model = window.pet = await PIXI.live2d.Live2DModel.from('/src/renderer/public/live2d/naiwa/奶蛙.model3.json',{autoInteract:false,autoUpdate:false,idleMotionGroup:'__NoAutomaticIdle'});app.stage.addChild(model);model.scale.set(Math.min(800/model.width,780/model.height));model.anchor.set(.5,1);model.position.set(450,830);
model.internalModel.breath=undefined;model.internalModel.eyeBlink=undefined;
model.internalModel.on('beforeModelUpdate',()=>{const p=model.internalModel.coreModel.getModel().parameters;window.appliedParams=Object.fromEntries(p.ids.map((id,i)=>[id,p.values[i]]))});
window.advance=(seconds)=>{for(let i=0;i<Math.round(seconds*60);i++){model.update(1000/60);app.renderer.render(app.stage)}};
window.reset=()=>{const internal=model.internalModel;internal.motionManager.stopAllMotions();const core=internal.coreModel;core.getModel().parameters.values.set(core.getModel().parameters.defaultValues);core.saveParameters();window.advance(3)};
window.pose=(values)=>{window.reset();const internal=model.internalModel;const apply=()=>{for(const [id,value] of Object.entries(values))internal.coreModel.setParameterValueById(id,value)};internal.on('beforeModelUpdate',apply);window.advance(1/60);internal.off('beforeModelUpdate',apply);};
window.snapshot=()=>{const raw=model.internalModel.coreModel.getModel();return {parameters:window.appliedParams,vertices:raw.drawables.vertexPositions.map(v=>Array.from(v)),opacities:Array.from(raw.drawables.opacities)}};
window.reset();return true;})();</script>`)
const app = await electron.launch({args:[join(output, 'render-main.cjs')],cwd:root,env:{...process.env,TEMP:temp,TMP:temp,MURASAME_MOTION_USER_DATA:join(temp,`profile-${Date.now()}`),MURASAME_MOTION_URL:address+'/previews/overnight-2026-10-29/nailong/render.html'}})
const errors=[]
try {
  const page=await app.firstWindow()
  page.on('pageerror',(error)=>errors.push(error.message))
  await page.waitForFunction(()=>Boolean(window.ready))
  await page.evaluate(()=>window.ready)
  if(mode==='probe'){
    const poses=[['neutral',{}],['head-right',{ParamAngleX:16}],['lean',{ParamAngleZ:12}],['body-lean',{ParamBodyAngleZ2:4}],['arms',{Paramyt5:8,Paramyt6:-5,Paramyt7:-8,Paramyt8:5}],['belly-hands',{Paramyt13:1}],['think-overlay',{Paramyt14:1}],['breath',{ParamBreath:.65}]]
    for(const [name,values] of poses){await page.evaluate(({name,values})=>{window.pose(values);document.querySelector('#label').textContent=name},{name,values});await page.screenshot({path:join(output,`probe-${name}.png`)})}
    console.log(JSON.stringify({mode,poses:poses.length,errors}))
  } else if (mode === 'contact') {
    const selected=[['Idle',192],['Greet',67],['Think',115],['Agree',58],['Confused',77],['DragLeft',43],['DragRight',43],['Working',144],['Comfort',101]]
    const cards=selected.map(([group,frame])=>`<figure><img src="data:image/png;base64,${readFileSync(join(output,`${group}-${String(frame).padStart(3,'0')}.png`)).toString('base64')}"><figcaption>${group}</figcaption></figure>`).join('')
    await page.setContent(`<!doctype html><style>html,body{margin:0;background:#e7e2d9;font-family:Arial,sans-serif;color:#343b44}body{padding:20px}h1{font-size:23px;margin:0 0 8px}p{font-size:12px;margin:0 0 14px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}figure{margin:0;background:#f5f2ed;border-radius:10px;overflow:hidden}img{display:block;width:100%}figcaption{padding:6px 12px 10px;font-weight:600}</style><h1>Native Nailong · 9 motion groups</h1><p>Original moc3, textures and physics. Actual Cubism runtime frames; no composited character parts.</p><div class="grid">${cards}</div>`)
    await page.screenshot({path:join(output,'native-motion-contact-sheet.png'),fullPage:true})
    console.log(JSON.stringify({mode,cards:selected.length,errors}))
  } else if (mode === 'interrupt') {
    const result=await page.evaluate(async()=>{
      window.reset();let previousSample=window.snapshot();let previous=previousSample.vertices.flat();const switches=[];let maxStep=0;
      for(const [group,seconds] of [['Think',1.6],['Working',1.4],['Greet',.8],['DragRight',.45],['Idle',1.2]]){
        await window.pet.motion(group,0,3);const frames=[];let peakDetail;
        for(let i=0;i<Math.round(seconds*60);i++){
          window.advance(1/60);const sample=window.snapshot();const current=sample.vertices.flat();let step=0;let peakVertex=0;for(let j=0;j<current.length;j++){const delta=Math.abs(current[j]-previous[j]);if(delta>step){step=delta;peakVertex=j}}
          if(!peakDetail||step>peakDetail.step){let offset=0;const drawableIndex=sample.vertices.findIndex(v=>{offset+=v.length;return offset>peakVertex});peakDetail={t:i/60,step,drawable:window.pet.internalModel.coreModel.getModel().drawables.ids[drawableIndex],parameterSteps:Object.entries(sample.parameters).map(([id,value])=>({id,from:previousSample.parameters[id],to:value,delta:value-previousSample.parameters[id]})).sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta)).slice(0,8)}}
          previous=current;previousSample=sample;maxStep=Math.max(maxStep,step);frames.push(step);
        }
        switches.push({group,playedSeconds:seconds,firstFrameStep:frames[0],first200msPeak:Math.max(...frames.slice(0,12)),maxFrameStep:Math.max(...frames),peakDetail});
      }
      return {maxStep,switches};
    })
    const limit=.015
    writeFileSync(join(output,'interrupt-report.json'),JSON.stringify({generatedAt:new Date().toISOString(),sampleRate:60,sequence:'Think → Working → Greet → DragRight → Idle, interrupting before completion',...result,limit,passed:result.maxStep<limit,errors},null,2))
    if(result.maxStep>=limit)throw new Error(`Interruption displacement ${result.maxStep} exceeds ${limit}`)
    console.log(JSON.stringify({mode,...result,errors}))
  } else if (mode === 'video') {
    const settings=JSON.parse(readFileSync(join(root,'src/renderer/public/live2d/naiwa/奶蛙.model3.json'),'utf8'))
    const playlist=Object.entries(settings.FileReferences.Motions).filter(([group])=>group!=='LegacyIdle').map(([group,refs])=>({group,duration:JSON.parse(readFileSync(join(root,'src/renderer/public/live2d/naiwa',refs[0].File),'utf8')).Meta.Duration}))
    await page.evaluate(()=>{
      const canvas=window.recordCanvas=document.createElement('canvas');canvas.width=900;canvas.height=900;
      window.videoFrame=(group,progress)=>{window.advance(1/30);const context=canvas.getContext('2d');context.fillStyle='#ece8e1';context.fillRect(0,0,900,900);context.drawImage(window.pixiApp.view,0,0);context.fillStyle='#343b44';context.font='600 23px Arial';context.fillText('Nailong · '+group,28,42);context.font='14px Arial';context.fillText('Original moc3 + original physics · native motion3 animation',28,866);context.fillStyle='#c7bba8';context.fillRect(28,880,844,3);context.fillStyle='#606d64';context.fillRect(28,880,844*progress,3);return canvas.toDataURL('image/png').split(',')[1]};
    })
    const encoder=spawn('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','image2pipe','-framerate','30','-vcodec','png','-i','pipe:0','-c:v','libx264','-crf','20','-pix_fmt','yuv420p','-movflags','+faststart','-an',join(output,'native-motion-showcase.mp4')],{windowsHide:true})
    let encoderErrors='';encoder.stderr.on('data',data=>{encoderErrors+=data.toString()})
    const encoded=once(encoder,'close');let frameCount=0
    try {
      for(const {group,duration} of playlist){
        await page.evaluate(async(group)=>{window.reset();await window.pet.motion(group,0,3)},group)
        for(let i=0;i<Math.ceil(duration*30);i++){
          const frame=await page.evaluate(({group,progress})=>window.videoFrame(group,progress),{group,progress:Math.min(1,i/(duration*30))})
          if(!encoder.stdin.write(Buffer.from(frame,'base64')))await once(encoder.stdin,'drain')
          frameCount++
        }
      }
      encoder.stdin.end();const [code]=await encoded;if(code!==0)throw new Error(encoderErrors)
    }catch(error){encoder.kill();throw error}
    writeFileSync(join(output,'video-metadata.json'),JSON.stringify({groups:playlist,frameCount,fps:30,duration:frameCount/30,source:'Original native Cubism render, advanced in 1/60s physics steps and captured at 30fps',errors},null,2))
    console.log(JSON.stringify({mode,groups:playlist.length,frameCount,fps:30,duration:frameCount/30,errors}))
  } else {
    const settings=JSON.parse(readFileSync(join(root,'src/renderer/public/live2d/naiwa/奶蛙.model3.json'),'utf8'))
    const groups=mode==='all'?Object.keys(settings.FileReferences.Motions).filter(g=>g!=='LegacyIdle'):[mode]
    const metrics=[]
    for(const group of groups){
      const motionPath=settings.FileReferences.Motions[group]?.[0]?.File
      if(!motionPath)throw new Error(`Unknown motion group ${group}`)
      const motion=JSON.parse(readFileSync(join(root,'src/renderer/public/live2d/naiwa',motionPath),'utf8'))
      await page.evaluate(async(group)=>{window.reset();await window.pet.motion(group,0,3);document.querySelector('#label').textContent=group},group)
      const frames=[]
      const count=Math.ceil(motion.Meta.Duration*60)
      const screenshotFrames=new Set([0,Math.round(count*.2),Math.round(count*.4),Math.round(count*.6),Math.round(count*.8),count])
      const capture=await page.evaluate((count)=>{
        const frames=[];let previous;let maxStep=0;let maximumDisplacement=0;let first;
        for(let i=0;i<=count;i++){window.advance(1/60);const s=window.snapshot();const flat=s.vertices.flat();if(!first)first=flat;let step=0;for(let j=0;j<flat.length;j++){maximumDisplacement=Math.max(maximumDisplacement,Math.abs(flat[j]-first[j]));if(previous)step=Math.max(step,Math.abs(flat[j]-previous[j]))}maxStep=Math.max(maxStep,step);previous=flat;frames.push({t:i/60,parameters:s.parameters,maxVertexStep:step});}
        return {maxStep,maximumDisplacement,frames};
      },count)
      await page.evaluate(async(group)=>{window.reset();await window.pet.motion(group,0,3)},group)
      for(let i=0;i<=count;i++){
        await page.evaluate(()=>window.advance(1/60))
        if(screenshotFrames.has(i)){const path=join(output,`${group}-${String(i).padStart(3,'0')}.png`);await page.screenshot({path});frames.push({frame:i,path})}
      }
      writeFileSync(join(output,`${group}-samples.json`),JSON.stringify({...capture,sampleRate:60,sourceMotionSha256:createHash('sha256').update(readFileSync(join(root,'src/renderer/public/live2d/naiwa',motionPath))).digest('hex')}))
      metrics.push({group,duration:motion.Meta.Duration,maxVertexStep: capture.maxStep,maxVertexDisplacement:capture.maximumDisplacement,frames})
    }
    writeFileSync(join(output,`${mode}-render-metrics.json`),JSON.stringify({generatedAt:new Date().toISOString(),runtime:'Bundled Cubism Core + pixi-live2d-display; original physics on; library automatic breath/blink disabled; 60 Hz',metrics,errors},null,2))
    console.log(JSON.stringify({groups:metrics.map(({group,maxVertexStep,maxVertexDisplacement})=>({group,maxVertexStep,maxVertexDisplacement})),errors}))
  }
}finally{await app.close();await new Promise(resolve=>server.close(resolve))}
