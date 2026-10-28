import { buildSync } from 'esbuild'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir, writeFile } from 'node:fs/promises'
import { randomUUID, createHash } from 'node:crypto'
const root=fileURLToPath(new URL('..',import.meta.url));const dir=join(root,'previews','isolation-live');const fixtures=join(dir,'fixtures');const image=process.env.VERIFY_ISOLATION_IMAGE || 'murasame-isolation:local';await mkdir(fixtures,{recursive:true})
buildSync({stdin:{contents:`export * from './src/main/isolation/docker-runtime'; export * from './src/main/isolation/browser-observation'; export * from './src/main/isolation/frame-evidence'; export * from './src/main/core/services/autonomy-service'; export * from './src/main/local/stt'; export * from './src/main/local/model-env';`,resolveDir:root,loader:'ts'},absWorkingDir:root,bundle:true,platform:'node',format:'cjs',external:['electron','@huggingface/transformers'],outfile:join(dir,'runtime.cjs')})
const api=createRequire(import.meta.url)(join(dir,'runtime.cjs'));const profile='verify-'+createHash('sha256').update(randomUUID()).digest('hex').slice(0,32);api.configureContainerOwner(profile)
const results={profile,image,startedAt:new Date().toISOString(),cases:[],containers:[],cleanup:[]};let id
const record=async(name,fn)=>{try{const data=await fn();results.cases.push({name,ok:true,data});process.stdout.write(JSON.stringify({name,ok:true,data})+'\n');return data}catch(error){const detail=error instanceof Error?error.message:String(error);results.cases.push({name,ok:false,error:detail});process.stdout.write(JSON.stringify({name,ok:false,error:detail})+'\n');return null}}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const run=api.runCommandAsync
try {
  if(process.platform!=='win32')throw new Error('This synthetic speech fixture requires Windows System.Speech. No container was created.')
  const wave=join(fixtures,'speech.wav');const q=s=>"'"+s.replaceAll("'","''")+"'"
  await run(join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-Command',`Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $v = $s.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -like 'zh-*' } | Select-Object -First 1; if ($v) { $s.SelectVoice($v.VoiceInfo.Name) }; $s.SetOutputToWaveFile(${q(wave)}); $s.Speak('这是合成验收音频。屏幕的颜色是红色。'); $s.Dispose()`],{timeoutMs:20000})
  await run(process.env.VERIFY_FFMPEG ?? 'ffmpeg.exe',['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','testsrc=size=320x180:rate=10','-i',wave,'-t','8','-c:v','libvpx','-b:v','160k','-c:a','libopus',join(fixtures,'clip.webm')],{timeoutMs:30000})
  await writeFile(join(fixtures,'captions.vtt'),'WEBVTT\n\n00:00.000 --> 00:04.000\nSynthetic caption: red start.\n\n00:04.000 --> 00:08.000\nSynthetic caption: blue ending.\n')
  await writeFile(join(fixtures,'video.html'),'<!doctype html><html><head><meta charset="utf-8"><title>Murasame synthetic video fixture</title></head><body style="background:white"><h1>Synthetic receipt 123</h1><video id="video" controls width="640" src="clip.webm" preload="auto"><track kind="captions" src="captions.vtt" srclang="en" default></video></body></html>')
  const plan=api.containerPlan({hostPath:'',readOnly:true,network:'none'});plan.image=image;plan.sessionId='synthetic-'+randomUUID()
  const started=await api.startContainerAsync(plan,0,undefined,{readinessAttempts:60})
  if('failed' in started){if(started.id){id=started.id;results.containers.push(id)}throw new Error(JSON.stringify(started))}id=started.id;results.containers.push(id)
  await record('owned-ready-container',async()=>({id,labels:JSON.parse(await run('docker',['inspect','-f','{{json .Config.Labels}}',id]))}))
  await run('docker',['cp',fixtures,id+':/tmp/murasame-fixture'])
  await api.runInContainerAsync(id,['python3','-m','http.server','8765','--bind','127.0.0.1','--directory','/tmp/murasame-fixture'],undefined,{detach:true,desktop:true})
  await record('desktop-home',async()=>await api.runInContainerAsync(id,['printenv','HOME'],undefined,{desktop:true}))
  await api.runInContainerAsync(id,['firefox-esr','--new-tab','http://127.0.0.1:8765/video.html'],undefined,{desktop:true,detach:false,timeoutMs:8000});await sleep(2500)
  await record('pids-before-probes',async()=>await run('docker',['stats','--no-stream','--format','{{.PIDs}}',id]))
  await record('supervisor-diagnostics',async()=>({logs:await run('docker',['logs','--tail','100',id]),firefox:await api.runInContainerAsync(id,['python3','-c',"import glob;print(''.join(open(p).read()[-8000:] for p in glob.glob('/var/log/supervisor/*firefox*')))"]),processes:await api.runInContainerAsync(id,['ps','-ef'])}))
  const played=await record('production-bidi-playback',async()=>{const f=await api.observeBrowser(id,undefined,{play:true,expectedUrl:'http://127.0.0.1:8765/video.html'});if(!f.media||f.media.paused)throw new Error('playback not confirmed: '+JSON.stringify(f));return {url:f.url,media:f.media,contextId:f.contextId}})
  if(played?.contextId)await record('bidi-context-stability',async()=>{const f=await api.observeBrowser(id,undefined,{contextId:played.contextId});return {contextId:f.contextId,url:f.url}})
  await record('production-png-decode',async()=>{await api.runInContainerAsync(id,['scrot','-o','/tmp/synthetic.png'],undefined,{desktop:true});const raw=await api.runInContainerAsync(id,['base64','-w','0','/tmp/synthetic.png']);const frame=api.decodeFrame(raw.trim());if(!frame)throw new Error('invalid PNG');await writeFile(join(dir,'synthetic-desktop.png'),Buffer.from(raw.trim(),'base64'));return {width:frame.width,height:frame.height,digest:frame.digest}})
  await api.runInContainerAsync(id,['firefox-esr','--new-tab','http://127.0.0.1:8765/video.html?audio=1'],undefined,{desktop:true,timeoutMs:15000});await sleep(500)
  await record('production-media-audio-and-local-stt',async()=>{const f=await api.observeBrowser(id,undefined,{play:true,recordAudioSeconds:3,expectedUrl:'http://127.0.0.1:8765/video.html?audio=1'});if(!f.audio?.pcm)throw new Error(f.audio?.error||'no PCM');const bytes=Buffer.from(f.audio.pcm,'base64');const samples=new Float32Array(bytes.length/4);for(let i=0;i<samples.length;i++)samples[i]=bytes.readFloatLE(i*4);const peak=Math.max(...samples.map(Math.abs));if(peak<0.001)throw new Error('captured audio is silent');const userData=process.env.VERIFY_MODEL_DIR?join(dir,'model-context'):process.env.MURASAME_USER_DATA || join(process.env.APPDATA,'murasame-desktop');if(process.env.VERIFY_MODEL_DIR)api.setBundledModelsRoot(resolve(process.env.VERIFY_MODEL_DIR));const missing=api.missingWhisperFiles(userData);let transcript;if(missing.length)throw new Error('Existing local Whisper is incomplete: '+missing.join(', '));if(!missing.length){transcript=await api.transcribeAudio(userData,samples);if(!transcript.accepted)throw new Error(transcript.message)}return {start:f.audio.start,end:f.audio.end,samples:samples.length,peak,missingWhisper:missing,transcript}})
  await record('real-media-time-and-captions',async()=>{const first=await api.observeBrowser(id,undefined,{play:true,expectedUrl:'http://127.0.0.1:8765/video.html'});await sleep(700);const next=await api.observeBrowser(id,undefined,{expectedUrl:'http://127.0.0.1:8765/video.html'});if(!first.media||!next.media||next.media.time<=first.media.time)throw new Error('media clock did not advance');if(!next.media.captions.some(c=>c.text.includes('Synthetic caption')))throw new Error('synthetic timed cue absent');return {from:first.media.time,to:next.media.time,captions:next.media.captions}})
  await record('pids-after-probes',async()=>await run('docker',['stats','--no-stream','--format','{{.PIDs}}',id]))
  const firstRemoved=await api.stopContainerAsync(id);results.cleanup.push({id,removed:firstRemoved});if(!firstRemoved)throw new Error('first test container cleanup failed');id=undefined
  let serviceId;const completions=[]
  const serviceRun=async(command,args,options)=>{
    const actual=args.map(v=>v==='murasame-isolation:local'?image:v)
    if(actual[0]==='run'){const p=actual.indexOf('-p');if(p>=0)actual.splice(p,2);actual[actual.indexOf('--network')+1]='none'}
    let output;try{output=await run(command,actual,options)}catch(error){if(serviceId){try{results.serviceBridgeLog=await run('docker',['exec',serviceId,'cat','/tmp/murasame-bidi.log'])}catch{ /* Diagnostic is best effort if the child has already exited. */ }}throw error}
    if(actual[0]==='run'){serviceId=output.trim();results.containers.push(serviceId)}
    return output
  }
  const service=new api.AutonomyService(serviceRun,undefined,{guard:()=>true,onComplete:r=>{completions.push(r.status)}})
  try {
    await record('real-autonomy-video-lifecycle',async()=>{
      const started=await service.start({dockerAvailable:true,approved:true,needsPermission:false,share:null,allowNetwork:true})
      if(!started.ok)throw new Error(started.error)
      await run('docker',['cp',fixtures,serviceId+':/tmp/murasame-fixture'])
      await api.runInContainerAsync(serviceId,['python3','-m','http.server','8765','--bind','127.0.0.1','--directory','/tmp/murasame-fixture'],undefined,{detach:true,desktop:true})
      const watched=await service.watchVideo('http://127.0.0.1:8765/video.html',async image=>{const f=api.decodeFrame(image);if(!f||f.width!==1280)throw new Error('bad actual frame');return 'Synthetic clip frame, verified PNG'},2,1000)
      const state=service.status()
      if(!watched.ok)throw new Error(watched.error)
      if(state.phase!=='stopped'||state.result.status!=='partial'||!state.result.cleanupSucceeded)throw new Error('wrong final lifecycle '+JSON.stringify(state))
      const times=state.result.observations.map(o=>o.mediaTime)
      if(times.length<2||times.at(-1)<=times[0])throw new Error('no real service timeline progression')
      const alive=await api.containerRunningAsync(serviceId)
      results.cleanup.push({id:serviceId,removed:!alive&&state.result.cleanupSucceeded})
      if(alive)throw new Error('service-owned container still running')
      return {phase:state.phase,status:state.result.status,times,captions:state.result.observations.flatMap(o=>o.captions||[]),cleanupSucceeded:state.result.cleanupSucceeded,completions}
    })
  } finally {await service.stop({containerGone:false})}
  await record('no-profile-container-residue',async()=>{const leftover=await run('docker',['ps','-aq','--filter','label=io.murasame.owner=desktop','--filter','label=io.murasame.profile='+profile]);if(leftover.trim())throw new Error(leftover);return {remaining:0}})

} catch(error){results.fatal=error instanceof Error?error.message:String(error);process.stderr.write(results.fatal+'\n')}
finally {if(id){const removed=await api.stopContainerAsync(id);results.cleanup.push({id,removed});if(removed)results.containerStillRunning=await api.containerRunningAsync(id)}results.finishedAt=new Date().toISOString();await writeFile(join(dir,'results.json'),JSON.stringify(results,null,2))}
if(results.fatal||results.cases.some(c=>!c.ok)||results.cleanup.some(c=>!c.removed))process.exitCode=1
