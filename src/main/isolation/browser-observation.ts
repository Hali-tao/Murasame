import { runInContainerAsync, type DockerRunner } from './docker-runtime'
import type { ActionFacts } from './input-injector'

export interface CaptionCue { start: number; end: number; text: string }
export interface MediaAudioSegment { start: number; end: number; sampleRate: 16000; pcm: string; error?: string }
export interface BrowserObserveOptions { signal?: AbortSignal; play?: boolean; recordAudioSeconds?: number; expectedUrl?: string; contextId?: string }
export interface BrowserObservation extends ActionFacts {
  contextId?: string
  audio?: MediaAudioSegment
  media: null | { time: number; duration: number | null; paused: boolean; ended: boolean; ready: number; source: string; captions: CaptionCue[]; captionTracks: number; audioAvailable: boolean | null }
}

// A container-local bridge keeps one BiDi session: Firefox context IDs are session-scoped.
// Neither the debugging endpoint nor this loopback bridge is published to the host.
const probe = String.raw`
import socket, json, struct, base64, hashlib, os, sys, time
s = socket.create_connection(('127.0.0.1',9222),5)
s.settimeout(8)
key=base64.b64encode(os.urandom(16)).decode()
s.sendall(('GET /session HTTP/1.1\r\nHost: 127.0.0.1:9222\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: '+key+'\r\nSec-WebSocket-Version: 13\r\n\r\n').encode())
buf=b''
while b'\r\n\r\n' not in buf:
  more=s.recv(4096)
  if not more: raise Exception('WebSocket closed before handshake')
  buf+=more
headers, pending=buf.split(b'\r\n\r\n',1)
accept=base64.b64encode(hashlib.sha1((key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest())
if b' 101 ' not in headers.split(b'\r\n')[0] or accept not in headers: raise Exception('Invalid BiDi handshake')
def read(n):
  global pending
  while len(pending)<n:
    more=s.recv(max(4096,n-len(pending)))
    if not more: raise Exception('WebSocket closed')
    pending+=more
  out=pending[:n];pending=pending[n:];return out
def send(payload,opcode=1):
  b=payload if isinstance(payload,bytes) else json.dumps(payload).encode()
  mask=os.urandom(4); n=len(b)
  size=bytes([0x80|n]) if n<126 else (bytes([0xfe])+struct.pack('!H',n) if n<65536 else bytes([0xff])+struct.pack('!Q',n))
  s.sendall(bytes([0x80|opcode])+size+mask+bytes(v^mask[i%4] for i,v in enumerate(b)))
def receive():
  parts=b''
  while True:
    a,b=read(2); n=b&127
    if n==126:n=struct.unpack('!H',read(2))[0]
    if n==127:n=struct.unpack('!Q',read(8))[0]
    if n>2000000:raise Exception('BiDi output too large')
    mask=read(4) if b&128 else None
    data=read(n)
    if mask:data=bytes(v^mask[i%4] for i,v in enumerate(data))
    opcode=a&15
    if opcode==8:raise Exception('BiDi closed')
    if opcode==9:send(data,10);continue
    if opcode not in (0,1):continue
    parts+=data
    if len(parts)>2000000:raise Exception('BiDi output too large')
    if a&128:return json.loads(parts)
seq=0
def command(method,params):
  global seq
  seq+=1;send({'id':seq,'method':method,'params':params})
  while True:
    response=receive()
    if response.get('id')!=seq:continue
    if response.get('type')=='error':raise Exception(response.get('message','BiDi failed'))
    return response['result']
command('session.new',{'capabilities':{}})
def evaluate(request):
  target=request['target']
  selected=None
  for attempt in range(20):
    contexts=command('browsingContext.getTree',{})['contexts']
    if target.get('contextId'):
      candidates=[c for c in contexts if c['context']==target['contextId']]
    else:
      candidates=[c for c in contexts if target.get('expectedUrl') and c.get('url')==target['expectedUrl']]
      if len(candidates)!=1:candidates=[c for c in contexts if c.get('url') and not c['url'].startswith('about:')]
    if len(candidates)==1:selected=candidates[0];break
    time.sleep(0.1)
  if not selected:raise Exception('Cannot uniquely identify the activity browser context: '+json.dumps([{'context':c['context'],'url':c.get('url')} for c in contexts]))
  context=selected['context']
  result=command('script.evaluate',{'expression':request['expression'],'target':{'context':context},'awaitPromise':True,'userActivation':bool(target.get('activate'))})
  if result.get('type')!='success':raise Exception(result.get('exceptionDetails',{}).get('text','Browser evaluation unavailable'))
  value=result['result'].get('value')
  if not isinstance(value,str):raise Exception('Invalid browser facts')
  parsed=json.loads(value);parsed['contextId']=context;return parsed
listener=socket.socket(socket.AF_INET,socket.SOCK_STREAM)
listener.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
listener.bind(('127.0.0.1',9223));listener.listen(4)
while True:
  client,_=listener.accept();client.settimeout(15)
  try:
    wire=client.makefile('rwb')
    line=wire.readline(2000001)
    if not line:continue
    if len(line)>2000000:raise Exception('Browser request too large')
    request=json.loads(line)
    try:response={'ok':True,'result':evaluate(request)}
    except Exception as error:response={'ok':False,'error':str(error)}
    wire.write((json.dumps(response)+'\n').encode());wire.flush()
  except Exception:pass
  finally:client.close()

`

const bridgeClient = String.raw`
import socket, subprocess, sys, json, time, os
request={'expression':sys.argv[2],'target':json.loads(sys.argv[3])}
def connect():return socket.create_connection(('127.0.0.1',9223),0.5)
try:client=connect()
except OSError:
  subprocess.Popen([sys.executable,'-c',sys.argv[1]],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=open('/tmp/murasame-bidi.log','a'),start_new_session=True)
  client=None
  for attempt in range(120):
    try:client=connect();break
    except OSError:time.sleep(0.1)
  if client is None:raise Exception('Browser observation bridge did not start: '+open('/tmp/murasame-bidi.log').read()[-2000:])
client.settimeout(15)
try:
  wire=client.makefile('rwb')
  wire.write((json.dumps(request)+'\n').encode());wire.flush()
  response=json.loads(wire.readline(2000001))
  if not response.get('ok'):raise Exception(response.get('error','Browser observation failed'))
  print(json.dumps(response['result']))
finally:client.close()
`

export async function observeBrowser(id: string, run?: DockerRunner, options: BrowserObserveOptions = {}): Promise<BrowserObservation> {
  const audioSeconds = Math.max(0, Math.min(options.recordAudioSeconds ?? 0, 3))
  const expression = `(async () => {
    const videos = [...document.querySelectorAll('video')].filter(v => v.getBoundingClientRect().width > 0 && v.getBoundingClientRect().height > 0);
    const v = videos.sort((a,b) => b.clientWidth*b.clientHeight-a.clientWidth*a.clientHeight)[0];
    if (v && ${options.play === true}) { for (const t of v.textTracks) if (t.kind === 'captions' || t.kind === 'subtitles') t.mode = 'hidden'; await v.play(); }
    let audio;
    if (v && ${audioSeconds} > 0) {
      const start=v.currentTime; let context; let source; let processor; let audioStream;
      try {
        const capture=v.captureStream || v.mozCaptureStream;
        if (!capture) throw new Error('播放器不支持读取媒体音轨');
        const stream=capture.call(v); audioStream=stream;
        if (!stream.getAudioTracks().length) throw new Error('没有可读取的媒体音轨，可能被内容保护限制');
        context=new AudioContext({sampleRate:16000}); await Promise.race([context.resume(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('容器媒体音频后端未就绪')),2000))]);
        if (context.state!=='running') throw new Error('媒体音轨采集没有启动');
        const samples=[]; const count=Math.round(context.sampleRate*${audioSeconds});
        source=context.createMediaStreamSource(stream); processor=context.createScriptProcessor(1024,1,1);
        await new Promise((resolve,reject)=>{
          const timer=setTimeout(()=>reject(new Error('媒体音轨读取超时')),${audioSeconds}*1000+2000);
          processor.onaudioprocess=e=>{const channel=e.inputBuffer.getChannelData(0);for(let i=0;i<channel.length && samples.length<count;i++)samples.push(channel[i]);if(samples.length>=count){clearTimeout(timer);resolve();}};
          source.connect(processor);processor.connect(context.destination);
        });
        const ratio=context.sampleRate/16000;const pcm=new Float32Array(Math.floor(samples.length/ratio));
        for(let i=0;i<pcm.length;i++){const pos=i*ratio;const j=Math.floor(pos);pcm[i]=samples[j]+((samples[j+1]??samples[j])-samples[j])*(pos-j);}
        let binary='';for(const byte of new Uint8Array(pcm.buffer))binary+=String.fromCharCode(byte);
        audio={start,end:v.currentTime,sampleRate:16000,pcm:btoa(binary)};
      } catch(error) {audio={start,end:v.currentTime,sampleRate:16000,pcm:'',error:String(error?.message||error)};}
      finally {if(processor)processor.disconnect();if(source)source.disconnect();if(context)await context.close();if(audioStream)for(const t of audioStream.getTracks())t.stop();}
    }
    const cues = v ? [...v.textTracks].filter(t => t.kind === 'captions' || t.kind === 'subtitles').flatMap(t => [...(t.cues || [])].slice(0,1000).map(c => ({start:c.startTime,end:c.endTime,text:c.text || ''}))) : [];
    return JSON.stringify({ audio, url: location.href, text: (document.body?.innerText || '').slice(0,30000), media: v ? { time:v.currentTime, duration:Number.isFinite(v.duration)?v.duration:null, paused:v.paused, ended:v.ended, ready:v.readyState, source:v.currentSrc, captions:cues, captionTracks:[...v.textTracks].filter(t => t.kind === 'captions' || t.kind === 'subtitles').length, audioAvailable:typeof v.mozHasAudio === 'boolean'?v.mozHasAudio:null } : null });
  })()`
  const raw = await runInContainerAsync(id, ['python3', '-c', bridgeClient, probe, expression, JSON.stringify({ expectedUrl: options.expectedUrl, contextId: options.contextId, activate: options.play === true || audioSeconds > 0 })], run, { signal: options.signal, timeoutMs: 20000 })
  const parsed = JSON.parse(raw) as BrowserObservation
  if (typeof parsed.url !== 'string' || typeof parsed.text !== 'string') throw new Error('浏览器没有返回可验证的页面事实')
  if (parsed.media && (!Number.isFinite(parsed.media.time) || !Array.isArray(parsed.media.captions) || typeof parsed.media.paused !== 'boolean')) throw new Error('播放器状态无效')
  if (parsed.audio && (!Number.isFinite(parsed.audio.start) || !Number.isFinite(parsed.audio.end) || parsed.audio.end < parsed.audio.start || parsed.audio.sampleRate !== 16000 || typeof parsed.audio.pcm !== 'string')) throw new Error('媒体音轨数据无效')
  return parsed
}
