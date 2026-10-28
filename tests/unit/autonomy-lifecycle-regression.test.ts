import { deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { AutonomyService } from '../../src/main/core/services/autonomy-service'
import { containerPlan, createArgs, startContainer } from '../../src/main/isolation/docker-runtime'
import { verifyAfterAction } from '../../src/main/isolation/input-injector'
import { buildScreenAnalysis } from '../../src/main/core/services/screen-service'

function png(red: number): string {
  const crc = (b: Buffer): number => { let n = 0xffffffff; for (const byte of b) { n ^= byte; for (let j = 0; j < 8; j++) n = (n >>> 1) ^ ((n & 1) ? 0xedb88320 : 0) } return (n ^ 0xffffffff) >>> 0 }
  const chunk = (name: string, data: Buffer): Buffer => { const b = Buffer.alloc(data.length + 12); b.writeUInt32BE(data.length); b.write(name, 4); data.copy(b, 8); b.writeUInt32BE(crc(b.subarray(4, -4)), b.length - 4); return b }
  const header = Buffer.alloc(13); header.writeUInt32BE(2); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 2
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'), chunk('IHDR',header), chunk('IDAT',deflateSync(Buffer.from([0,red,0,0,red,0,0]))), chunk('IEND',Buffer.alloc(0))]).toString('base64')
}
const image = png(10)
const start = { dockerAvailable: true, approved: true, needsPermission: false, share: null }
const fake = (calls: string[][], failRemove = () => false) => (_command: string, args: string[]): string => {
  calls.push(args)
  if (args[0] === 'image' && args[1] === 'inspect') return '3'
  if (args[0] === 'ps') return ''
  if (args[0] === 'run') return `container-${calls.filter(a => a[0] === 'run').length}`
  if (args[0] === 'inspect') return 'true'
  if (args[0] === 'rm' && failRemove()) throw new Error('cleanup unavailable')
  if (args.includes('base64')) return image
  return ''
}

it('[FR-28] 离线桌面显示真实PNG，不提供无法连接的VNC且预览不消耗动作预算', async () => {
  const calls: string[][] = []; const service = new AutonomyService(fake(calls), async () => {})
  const started = await service.start({ ...start, allowNetwork: false })
  expect(started.ok).toBe(true); expect(service.status().viewUrl).toBe('')
  for (let i = 0; i < 16; i++) expect((await service.preview()).ok).toBe(true)
  expect(service.status().running).toBe(true)
  await service.stop({ containerGone: false })
  expect((await service.preview()).ok).toBe(false)
})

it('[FR-30] 预览采集前与返回前都检查许可，撤回后不返回画面', async () => {
  const calls: string[][] = []; let allowed = true
  const service = new AutonomyService((_command, args) => {
    const response = fake(calls)(_command, args)
    if (args.includes('base64')) allowed = false
    return response
  }, async () => {}, { guard: () => allowed })
  await service.start({ ...start, allowNetwork: false })
  expect((await service.preview()).ok).toBe(false)
  const captures = calls.filter(args => args.includes('scrot')).length
  expect((await service.preview()).ok).toBe(false)
  expect(calls.filter(args => args.includes('scrot'))).toHaveLength(captures)
  await service.stop({ containerGone: false })
})

describe('autonomy lifecycle regressions', () => {
  it('late decisions cannot act on a replacement activity', async () => {
    const calls: string[][] = []; const service = new AutonomyService(fake(calls), async () => {})
    await service.start(start)
    let resolve!: (v: {kind:'click'; x:number; y:number; note:string}) => void
    const decision = new Promise<{kind:'click'; x:number; y:number; note:string}>(r => { resolve = r })
    let entered!: () => void; const ready = new Promise<void>(r => { entered = r })
    const browse = service.browse('synthetic', async () => { entered(); return decision })
    await ready; await service.stop({ containerGone: false }); await service.start(start)
    resolve({kind:'click',x:1,y:1,note:'old'})
    await browse
    expect(calls.filter(a => a.includes('xdotool'))).toEqual([])
    expect(service.status().notes.some(n => n.includes('old'))).toBe(false)
    await service.stop({ containerGone: false })
  })
  it('activity step limit removes the owned container', async () => {
    const calls: string[][] = []; const service = new AutonomyService(fake(calls), async () => {})
    await service.start(start)
    for (let i = 0; i < 13; i++) await service.look()
    expect(service.status().running).toBe(false)
    expect(calls.some(a => a[0] === 'rm' && a.includes('container-1'))).toBe(true)
  })
  it('failed cleanup stays failed and can be retried against the same container', async () => {
    const calls: string[][] = []; let failed = true
    const service = new AutonomyService(fake(calls, () => failed), async () => {})
    await service.start(start)
    expect((await service.stop({containerGone:false})).ok).toBe(false)
    expect(service.status().reason).toContain('退出')
    failed = false
    expect((await service.stop({containerGone:false})).ok).toBe(true)
    expect(calls.filter(a => a[0] === 'rm' && a.includes('container-1'))).toHaveLength(2)
  })
  it('different valid pictures do not establish the intended action result', () => {
    expect(verifyAfterAction(image, png(220)).verified).toBe(false)
  })
  it('malformed screenshots cannot count as action evidence', () => {
    expect(verifyAfterAction('not an image', 'also not an image').verified).toBe(false)
  })
  it('Windows drive letters survive Docker bind mount construction', () => {
    expect(createArgs(containerPlan({hostPath:'D:/synthetic/share',readOnly:true}))).toContain('type=bind,readonly,source=D:/synthetic/share,target=/shared')
  })
  it('startup cleanup never selects arbitrary same-image containers', () => {
    const queries: string[][] = []; startContainer(containerPlan(), 6901, (_c,a) => { if(a[0] === 'ps') queries.push(a); return a[0] === 'run' ? 'owned' : '' })
    expect(queries.length).toBeGreaterThan(0)
    expect(queries.every(a => a.some(v => v.startsWith('label=')))).toBe(true)
  })
  it('textless visual summary survives when the model understood a captured chart', () => {
    const result = buildScreenAnalysis({ authorized:true, revoked:false, window:{title:'Synthetic chart',processName:'test',passwordField:false,displayAffinity:0,tree:'',selectedText:''}, elements:[],ocrText:'',imageCaptured:true,visionAvailable:true,visionError:'',captureError:'',supplemented:false,watch:{enabled:false,intervalSeconds:15,hidden:false,locked:false,doNotDisturb:false,authorized:true,failures:0},modelSummary:'Chart rises from 10 to 20' })
    expect(result.summary).toBe('Chart rises from 10 to 20')
    expect(result.confidence).toBe('模型')
  })
})

// A regression here would let an old observation mutate replacement state or reissue an ambiguous click.
describe('autonomy boundary and evidence regressions', () => {
  it('late look results cannot overwrite the new activity', async () => {
    const calls: string[][] = []; const service = new AutonomyService(fake(calls), async () => {})
    await service.start(start)
    let finish!: (s:string)=>void; let entered!:()=>void
    const ready = new Promise<void>(r => {entered=r}); const response = new Promise<string>(r => {finish=r})
    const looking=service.look(async()=>{entered();return response})
    await ready; await service.stop({containerGone:false}); await service.start(start)
    finish('old visual observation'); await looking
    expect(service.status().notes).toEqual([])
    expect(service.status().running).toBe(true)
    await service.stop({containerGone:false})
  })
  it('revoked permission after a delayed decision prevents action and further frames', async () => {
    const calls:string[][]=[];let allowed=true
    const service=new AutonomyService(fake(calls),async()=>{}, {guard:()=>allowed})
    await service.start(start)
    let finish!:(s:{kind:'key';key:string;note:string})=>void; let entered!:()=>void
    const ready=new Promise<void>(r=>{entered=r});const response=new Promise<{kind:'key';key:string;note:string}>(r=>{finish=r})
    const browsing=service.browse('synthetic',async()=>{entered();return response})
    await ready;const captures=calls.filter(a=>a.includes('scrot')).length;allowed=false
    finish({kind:'key',key:'Return',note:'late'});const result=await browsing
    expect(result.ok).toBe(false)
    expect(calls.filter(a=>a.includes('xdotool'))).toEqual([])
    expect(calls.filter(a=>a.includes('scrot'))).toHaveLength(captures)
    expect(service.status().running).toBe(false)
    expect(calls.some(a=>a[0]==='rm')).toBe(true)
  })
  it('an ambiguous input is sent once and the activity stops with partial evidence', async () => {
    const calls:string[][]=[]; const service=new AutonomyService(fake(calls),async()=>{})
    await service.start(start)
    await service.browse('synthetic',async()=>({kind:'type',text:'one submission',note:'submit'}),6)
    expect(calls.filter(a=>a.includes('xdotool'))).toHaveLength(1)
    expect(service.status().result?.status).toBe('partial')
    expect(service.status().result?.cleanupSucceeded).toBe(true)
    expect(service.status().running).toBe(false)
  })
  it('independent page facts verify the requested result and completion is emitted once', async () => {
    const calls:string[][]=[]; const results:string[]=[]
    const service=new AutonomyService(fake(calls),async()=>{}, {observe:async()=>({url:'https://synthetic.test/done',text:'Receipt 123',media:null}),onComplete:r=>{results.push(r.status)}})
    await service.start(start)
    await service.browse('read receipt',async()=>({kind:'done',note:'Receipt 123',expected:{url:'https://synthetic.test/done',text:'Receipt 123'}}))
    await service.stop({containerGone:false})
    expect(results).toEqual(['completed'])
    expect(service.status().result?.observations[0]?.source).toBe('https://synthetic.test/done')
    expect(calls.filter(a=>a[0]==='rm')).toHaveLength(1)
  })
  it('a second concurrent start cannot create a second container', async () => {
    const calls:string[][]=[];let release!:()=>void
    const gate=new Promise<void>(r=>{release=r});const run=fake(calls)
    const service=new AutonomyService(async(c,a)=>{if(a[0]==='run')await gate;return run(c,a)},async()=>{})
    const first=service.start(start);const second=await service.start(start)
    expect(second.ok).toBe(false)
    release();expect((await first).ok).toBe(true)
    expect(calls.filter(a=>a[0]==='run')).toHaveLength(1)
    await service.stop({containerGone:false})
  })
  it('stop during delayed container start reclaims the late container', async () => {
    const calls:string[][]=[];let release!:()=>void;let entered!:()=>void
    const gate=new Promise<void>(r=>{release=r});const ready=new Promise<void>(r=>{entered=r});const run=fake(calls)
    const service=new AutonomyService(async(c,a)=>{if(a[0]==='run'){entered();await gate}return run(c,a)},async()=>{})
    const beginning=service.start(start);await ready
    const stopping=service.stop({containerGone:false});release()
    expect((await beginning).ok).toBe(false)
    await stopping
    expect(service.status().running).toBe(false)
    expect(calls.some(a=>a[0]==='rm' && a.includes('container-1'))).toBe(true)
  })
  it('corrupt screenshot fails and cleans up before a model sees it', async () => {
    const calls:string[][]=[]; const run=fake(calls);let modelCalls=0
    const service=new AutonomyService((c,a)=>a.includes('base64')?'not-a-png':run(c,a),async()=>{})
    await service.start(start)
    expect((await service.look(async()=>{modelCalls++;return 'invalid observation'})).ok).toBe(false)
    expect(modelCalls).toBe(0)
    expect(service.status().phase).toBe('failed')
    expect(calls.some(a=>a[0]==='rm')).toBe(true)
  })
  it('video requires confirmed playback instead of accepting page screenshots', async () => {
    const calls:string[][]=[];let described=0
    const service=new AutonomyService(fake(calls),async()=>{}, {observe:async()=>({url:'https://synthetic.test/video',text:'login',media:null})})
    await service.start(start)
    expect((await service.watchVideo('https://synthetic.test/video',async()=>{described++;return 'page'})).ok).toBe(false)
    expect(described).toBe(0)
    expect(service.status().result?.status).toBe('failed')
    expect(calls.some(a=>a[0]==='rm')).toBe(true)
  })
  it('video records advancing media timestamps, available captions and honest audio limits', async () => {
    const calls:string[][]=[];let time=0
    const service=new AutonomyService(fake(calls),async()=>{}, {observe:async()=>({url:'https://synthetic.test/video',text:'video',media:{time:time++,duration:30,paused:false,ended:false,ready:4,source:'clip.webm',captions:[{start:0,end:10,text:'Known synthetic caption'}],captionTracks:1,audioAvailable:true}})})
    await service.start(start)
    expect((await service.watchVideo('https://synthetic.test/video',async()=> 'red synthetic frame',2,1000)).ok).toBe(true)
    const result=service.status().result!
    expect(result.status).toBe('partial')
    expect(result.observations.map(o=>o.mediaTime)).toEqual([0,1])
    expect(result.observations[1].captions).toEqual(['Known synthetic caption'])
    expect(result.limitations.some(s=>s.includes('未转写音轨'))).toBe(true)
    expect(result.cleanupSucceeded).toBe(true)
  })
})
import { readForegroundAsync } from '../../src/main/local/uia'
import { recognizeImageAsync } from '../../src/main/local/ocr'
import { cropDisplayRect, cropRect } from '../../src/main/local/screen-policy'
import { runCommandAsync, startContainerAsync } from '../../src/main/isolation/docker-runtime'

describe('native runtime and physical capture regressions', () => {
  it('a negative-origin physical display maps to exactly the authorized window pixels', () => {
    expect(cropDisplayRect({x:-1800,y:100,width:800,height:600},{x:-1920,y:0,width:1920,height:1080},{width:960,height:540})).toEqual({x:60,y:50,width:400,height:300})
    expect(cropRect({x:-1,y:0,width:100,height:100},{width:1920,height:1080})).toBeNull()
    expect(cropDisplayRect({x:-50,y:100,width:800,height:600},{x:-1920,y:0,width:1920,height:1080},{width:1920,height:1080})).toBeNull()
    expect(cropRect(undefined,{width:1920,height:1080})).toBeNull()
  })
  it('delayed UIA and OCR leave the event loop responsive and preserve injection options', async () => {
    let release!:()=>void;const gate=new Promise<void>(r=>{release=r});let imagePath=''
    const uia=readForegroundAsync(async()=>{await gate;return JSON.stringify({title:'Synthetic',processName:'test',sensitiveScanComplete:true})})
    const ocr=recognizeImageAsync('C:/synthetic.png',async(_c,_a,o)=>{imagePath=o?.env?.MURASAME_OCR_IMAGE??'';await gate;return ' Synthetic text '})
    let ticked=false;await new Promise<void>(r=>setImmediate(()=>{ticked=true;r()}));expect(ticked).toBe(true)
    release();expect((await uia).title).toBe('Synthetic');expect(await ocr).toBe('Synthetic text');expect(imagePath).toBe('C:/synthetic.png')
  })
  it('the real async command runner is responsive and aborts a pending child', async () => {
    const abort=new AbortController()
    const running=runCommandAsync(process.execPath,['-e','setTimeout(()=>process.stdout.write("late"),10000)'],{signal:abort.signal})
    await new Promise<void>(r=>setImmediate(r));abort.abort()
    await expect(running).rejects.toThrow('取消')
  })
  it('desktop readiness failure removes its container rather than announcing running', async () => {
    const calls:string[][]=[]
    const run=fake(calls)
    const result=await startContainerAsync(containerPlan(),6901,(c,a)=>{if(a.includes('getdisplaygeometry')||a.some(v=>v.includes('xdotool getdisplaygeometry')))throw new Error('desktop not ready');return run(c,a)}, {wait:async()=>{},readinessAttempts:2})
    expect('failed' in result).toBe(true)
    expect(calls.some(a=>a[0]==='rm'&&a.includes('container-1'))).toBe(true)
  })
})

it('repeated stop after completion preserves the terminal stopped state', async () => {
  const calls:string[][]=[];const service=new AutonomyService(fake(calls),async()=>{})
  await service.start(start)
  await service.stop({containerGone:false})
  await service.stop({containerGone:false})
  expect(service.status().phase).toBe('stopped')
  expect(calls.filter(a=>a[0]==='rm')).toHaveLength(1)
})
import { ensureDocker } from '../../src/main/isolation/docker-runtime'

it('cancelled Docker preparation cannot launch the runtime after a delayed availability check', async () => {
  const abort=new AbortController();let launches=0
  const prepared=await ensureDocker({signal:abort.signal,available:async()=>{abort.abort();return false},locate:()=> 'C:/synthetic/Docker.exe',launch:()=>{launches++},wait:async()=>{}})
  expect(launches).toBe(0)
  expect(prepared.ok).toBe(false)
})
import { ProactiveLoop } from '../../src/main/core/proactive-loop'

it('proactive stop invalidates delayed foreground work and concurrent ticks do not duplicate sharing', async () => {
  let finish!:()=>void;const gate=new Promise<void>(r=>{finish=r});const spoken:string[]=[];let reads=0
  const loop=new ProactiveLoop({hidden:()=>false,doNotDisturb:()=>false,taskRunning:()=>false,pace:()=> 'high',stage:()=> '熟悉',reasons:()=>['Synthetic completed activity'],say:text=>spoken.push(text),foreground:async()=>{reads++;await gate;return {title:'Synthetic',idleMs:120000,fullscreen:false}}})
  const first=loop.tick();const concurrent=await loop.tick()
  expect(concurrent.spoke).toBe(false);expect(reads).toBe(1)
  loop.stop();finish();await first
  expect(spoken).toEqual([])
})
import { cleanupOwnedContainersAsync } from '../../src/main/isolation/docker-runtime'

it('startup recovery only queries labeled application containers and preserves explicitly active IDs', async () => {
  const commands:string[][]=[]
  const recovered=await cleanupOwnedContainersAsync((_c,a)=>{commands.push(a);return a[0]==='ps'?'prior-owned active-owned':''},{activeIds:['active-owned']})
  expect(recovered).toEqual({removed:['prior-owned'],failed:[]})
  expect(commands.filter(a=>a[0]==='ps').every(a=>a.includes('label=io.murasame.owner=desktop'))).toBe(true)
  expect(commands.filter(a=>a[0]==='rm')).toEqual([['rm','-f','prior-owned']])
})

it('revoked permission discards a delayed visual model result before publishing observations', async () => {
  const calls:string[][]=[];let allowed=true;let finish!:(s:string)=>void;let entered!:()=>void
  const ready=new Promise<void>(r=>{entered=r});const answer=new Promise<string>(r=>{finish=r})
  const service=new AutonomyService(fake(calls),async()=>{}, {guard:()=>allowed})
  await service.start(start)
  const looking=service.look(async()=>{entered();return answer})
  await ready;allowed=false;finish('late revoked observation')
  expect((await looking).ok).toBe(false)
  expect(service.status().notes.some(n=>n.includes('late revoked'))).toBe(false)
  expect(service.status().running).toBe(false)
})
import { configureContainerOwner } from '../../src/main/isolation/docker-runtime'

it('recovery from one application profile never selects containers belonging to another profile', async () => {
  configureContainerOwner('synthetic-profile-a')
  const queries:string[][]=[];const removed:string[]=[]
  await cleanupOwnedContainersAsync((_c,a)=>{if(a[0]==='ps'){queries.push(a);return a.includes('label=io.murasame.profile=synthetic-profile-a')?'profile-a-container':'profile-b-container'}if(a[0]==='rm')removed.push(a[2]);return ''})
  expect(removed).toEqual(['profile-a-container'])
  expect(queries[0]).toContain('label=io.murasame.profile=synthetic-profile-a')
  expect(createArgs(containerPlan())).toContain('io.murasame.profile=synthetic-profile-a')
})

it('captionless video can capture only its media audio and attach timestamped local transcripts', async () => {
  const calls:string[][]=[];const audio=Buffer.alloc(16000*4);audio.writeFloatLE(0.25,0);let time=0;let transcriptions=0
  const service=new AutonomyService(fake(calls),async()=>{}, {
    observe:async(_id,o)=>{const end=time++;return {url:'https://synthetic.test/audio-video',text:'video',media:{time:end,duration:30,paused:false,ended:false,ready:4,source:'clip.webm',captions:[],captionTracks:0,audioAvailable:true},...(o.recordAudioSeconds?{audio:{start:end-1,end,sampleRate:16000 as const,pcm:audio.toString('base64')}}:{})}},
    transcribeMediaAudio:async(samples)=>{transcriptions++;expect(samples[0]).toBe(0.25);expect(samples.length).toBe(16000);return 'Known synthetic spoken words'}
  })
  await service.start(start)
  await service.watchVideo('https://synthetic.test/audio-video',async()=> 'synthetic frame',2,1000)
  expect(transcriptions).toBe(2)
  expect(service.status().result?.observations.map(o=>o.audio?.transcript)).toEqual(['[不可信:video] Known synthetic spoken words','[不可信:video] Known synthetic spoken words'])
  expect(service.status().result?.observations[0]?.audio?.start).toBe(0)
})

it('a fully played short captioned video can complete while preserving its verified coverage', async () => {
  const calls:string[][]=[];let n=0
  const service=new AutonomyService(fake(calls),async()=>{}, {observe:async()=>{const time=n++===0?0:2;return {url:'https://synthetic.test/short',text:'video',media:{time,duration:2,paused:time===2,ended:time===2,ready:4,source:'short.webm',captions:[{start:0,end:2,text:'Known complete caption'}],captionTracks:1,audioAvailable:true}}}})
  await service.start(start)
  await service.watchVideo('https://synthetic.test/short',async()=> 'known short video frame',3,1000)
  expect(service.status().result?.status).toBe('completed')
  expect(service.status().result?.summary).toContain('0.0–2.0')
  expect(service.status().result?.observations.flatMap(o=>o.captions??[])).toContain('Known complete caption')
})

it('preflight failure does not invent an uncreated container needing cleanup', async () => {
  const calls:string[][]=[]
  const result=await startContainerAsync(containerPlan(),0,(_c,a)=>{calls.push(a);if(a[0]==='image')return '3';throw new Error('preflight query failed')})
  expect('failed' in result).toBe(true)
  expect('id' in result).toBe(false)
  expect(calls.some(a=>a[0]==='run'||a[0]==='rm')).toBe(false)
})
import { isolationEnvironmentAsync } from '../../src/main/isolation/docker-runtime'

it('an old isolation image is reported as needing upgrade and cannot start a container', async () => {
  const calls:string[][]=[]
  const runner=(_c:string,a:string[]):string=>{calls.push(a);if(a[0]==='images')return 'old-image';if(a[0]==='image')return '2';return ''}
  expect((await isolationEnvironmentAsync(runner)).image).toBe(false)
  const result=await startContainerAsync(containerPlan(),0,runner,{readiness:'process'})
  expect('failed' in result && result.failed).toContain('升级')
  expect(calls.some(a=>a[0]==='run')).toBe(false)
})

it('headless process mode launches only an idle process under its smaller PID limit', async () => {
  const calls:string[][]=[];const runner=fake(calls)
  const result=await startContainerAsync(containerPlan(),0,runner,{readiness:'process'})
  expect('id' in result).toBe(true)
  const command=calls.find(a=>a[0]==='run')!
  expect(command.slice(-2)).toEqual(['sleep','infinity'])
  expect(command[command.indexOf('--pids-limit')+1]).toBe('256')
  expect(calls.some(a=>a[0]==='exec')).toBe(false)
})
