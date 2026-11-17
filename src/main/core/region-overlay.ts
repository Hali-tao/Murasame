/** Static, isolated selection UI. No external resources and no general application bridge. */
export function regionOverlay(image: string, nonce: string): string {
  return `<!doctype html><html lang="zh-CN"><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'none'">
<style>
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;font:14px system-ui;user-select:none;cursor:crosshair;background:#101217}
#background{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}#shade{position:absolute;inset:0;background:#0005;pointer-events:none}
#box{display:none;position:absolute;border:2px solid #ff7969;box-shadow:0 0 0 99999px #0006;pointer-events:none}
#help{position:absolute;top:20px;left:50%;transform:translateX(-50%);background:#20232deb;color:white;padding:12px 18px;border-radius:10px;pointer-events:none;white-space:nowrap}
#actions{position:absolute;bottom:24px;left:50%;transform:translateX(-50%);display:flex;gap:10px;padding:10px;background:#20232d;border-radius:12px;color:white;align-items:center;cursor:default}
button{padding:10px 16px;border:0;border-radius:8px;cursor:pointer}#confirm{background:#ed7968;color:white}button:disabled{opacity:.4;cursor:default}
</style><img id="background" src="${image}" alt="待框选的屏幕"><div id="shade"></div><div id="box"></div>
<div id="help">拖动框选区域 · 仅限当前显示器 · Enter 确认 · Esc 取消</div>
<div id="actions"><span id="size">尚未选择</span><button id="cancel">取消</button><button id="confirm" disabled>分析选中区域</button></div>
<script nonce="${nonce}">
const box=document.getElementById('box'),confirmButton=document.getElementById('confirm'),size=document.getElementById('size');
let start=null,rect=null;
const point=e=>({x:Math.max(0,Math.min(innerWidth,e.clientX)),y:Math.max(0,Math.min(innerHeight,e.clientY))});
document.addEventListener('pointerdown',e=>{if(e.target.closest('#actions')||e.button!==0)return;start=point(e);rect=null;confirmButton.disabled=true;document.body.setPointerCapture(e.pointerId)});
document.addEventListener('pointermove',e=>{if(!start)return;const p=point(e);rect={x:Math.min(p.x,start.x),y:Math.min(p.y,start.y),width:Math.abs(p.x-start.x),height:Math.abs(p.y-start.y)};box.style.display='block';Object.assign(box.style,{left:rect.x+'px',top:rect.y+'px',width:rect.width+'px',height:rect.height+'px'});size.textContent=Math.round(rect.width)+' × '+Math.round(rect.height);document.getElementById('shade').style.display='none'});
document.addEventListener('pointerup',()=>{if(!start)return;start=null;confirmButton.disabled=!rect||rect.width<8||rect.height<8});
function confirm(){if(rect&&!confirmButton.disabled)window.regionSelection.complete(rect)}
confirmButton.onclick=confirm;document.getElementById('cancel').onclick=()=>window.regionSelection.complete(null);
document.addEventListener('keydown',e=>{if(e.key==='Escape')window.regionSelection.complete(null);if(e.key==='Enter')confirm()});
</script></html>`
}
