import { chromium } from '/home/user/ChainTrace/frontend/node_modules/playwright/index.mjs';
import fs from 'fs';
const D='/tmp/claude-0/-home-user-ChainTrace/90241886-fc26-53e4-b44f-427ab377937d/scratchpad/rec/';
const W='bc1qc662a6c4236057c60aec7ac74786', T='bc1q8f00fe31c79c296b85dcd39e01ae';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const ctx=await b.newContext({viewport:{width:1600,height:900},recordVideo:{dir:D,size:{width:1600,height:900}}});
const ctxStart=Date.now();
await ctx.addInitScript(()=>{
  const mk=()=>{ if(document.getElementById('__cur'))return;
    const c=document.createElement('div');c.id='__cur';
    c.style.cssText='position:fixed;z-index:2147483647;width:22px;height:22px;border-radius:50%;background:rgba(255,200,40,.35);border:2px solid #ffc828;pointer-events:none;left:-50px;top:-50px;transform:translate(-50%,-50%);transition:transform .08s';
    document.documentElement.appendChild(c);};
  addEventListener('mousemove',e=>{mk();const c=document.getElementById('__cur');c.style.left=e.clientX+'px';c.style.top=e.clientY+'px';},true);
  addEventListener('mousedown',()=>{const c=document.getElementById('__cur');if(c)c.style.transform='translate(-50%,-50%) scale(.6)'},true);
  addEventListener('mouseup',()=>{const c=document.getElementById('__cur');if(c)c.style.transform='translate(-50%,-50%) scale(1)'},true);
});
let p=await ctx.newPage();p.on('console',m=>{if(/expand|graph|error|sigma/i.test(m.text()))console.log('C:',m.text().slice(0,200))});
await p.goto('http://localhost:5173/',{waitUntil:'networkidle'});
await p.waitForTimeout(2500);
await p.mouse.move(800,450);
let T0=Date.now();           // narration "localhost" t=0 (video 0:30)
const at=async s=>{const w=s*1000-(Date.now()-T0); if(w>0) await p.waitForTimeout(w); else console.log('LATE',s,-w)};
const go=async (loc,steps=16)=>{const bb=await loc.boundingBox();await p.mouse.move(bb.x+bb.width/2,bb.y+bb.height/2,{steps});};
const click=async loc=>{await go(loc);await p.waitForTimeout(250);await p.mouse.down();await p.mouse.up();};
const MARKS={};const mark=s=>{MARKS[s]=(Date.now()-T0)/1000;console.log('t',s,MARKS[s].toFixed(1));};

// ---- Overview 0-15 : ingest -> overview
await p.mouse.move(180,150,{steps:30});               // over TRANSACTIONS tile
await at(5); await p.mouse.move(850,150,{steps:30});   // open alerts tile
await at(8); await p.mouse.move(600,650,{steps:40});   // top-priority alerts
await at(12);await p.mouse.move(400,700,{steps:30});
// ---- Alerts
await at(17);
await click(p.getByRole('link',{name:'Alerts'}).or(p.getByLabel('Alerts').first()).first());
await p.waitForTimeout(1200);
const q=p.getByPlaceholder('Entity id or finding text');
await click(q); await q.pressSequentially(W.slice(0,16),{delay:70});
await p.waitForTimeout(1200);
await click(p.locator('tbody tr').first());           // open the alert
mark('alert open'); 
await at(26);
await click(p.locator('.tabs [role=tab]',{hasText:/^Explanation/})); mark('explanation');   // top features
await at(35.6);
await click(p.locator('.tabs [role=tab]',{hasText:/^Overview$/}));
await p.waitForTimeout(600);
await p.getByText('Disposition',{exact:true}).first().scrollIntoViewIfNeeded().catch(()=>{});
await at(37.9);
await click(p.locator('.chip[title^="Mark this alert"]',{hasText:'investigating'}));  // record a decision
mark('decision');
// ---- Graph (second take, joined in edit)
await at(42);
const vA=await p.video().path(); const offA=(T0-ctxStart)/1000;
const p1=p; 
const ctxStartB=Date.now();
p=await ctx.newPage();
await p.goto('http://localhost:5173/graph',{waitUntil:'networkidle'});
await p.getByText('sample of').waitFor({timeout:60000});await p.waitForTimeout(2000);
await p.mouse.move(300,400);
await p.waitForTimeout(500);
T0=Date.now()-42000; mark('graph'); const offB=(Date.now()-ctxStartB)/1000;
await p1.close();
const f=p.getByLabel('Find in graph');
await click(f); await f.pressSequentially(W,{delay:18});
await p.waitForTimeout(700);
await f.press('Enter');                                 // select + isolate
mark('graph found');
await p.waitForTimeout(1000);
const nodeXY=async prefix=>p.evaluate(pre=>{
  let s=null;
  if(!s){for(const el of document.querySelectorAll('canvas')){let key;for(const k of Object.keys(el.parentElement))if(k.startsWith('__reactFiber'))key=k;
    if(!key)continue;let fib=el.parentElement[key],i=0;
    while(fib&&i++<400){let st=fib.memoizedState,j=0;while(st&&typeof st==='object'&&j++<40){const m=st.memoizedState;if(m&&typeof m==='object'&&typeof m.getGraph==='function'&&typeof m.graphToViewport==='function'){s=m;break;}st=st.next;}if(s)break;fib=fib.return;}
    if(s)break;}
    if(!s)return 'NOSIGMA';window.__sigma=s;}
  const g=s.getGraph();const id=g.nodes().find(n=>n.startsWith(pre));if(!id)return null;
  const v=s.framedGraphToViewport(s.getNodeDisplayData(id));const r=s.getContainer().getBoundingClientRect();
  return {x:v.x+r.left,y:v.y+r.top};},prefix);
const clickNode=async prefix=>{const c=await nodeXY(prefix);if(!c||c==='NOSIGMA'){await p.screenshot({path:D+'fail.png'});}if(!c||c==='NOSIGMA')throw new Error('node '+prefix+' '+c);await p.mouse.move(c.x,c.y,{steps:16});await p.waitForTimeout(150);await p.mouse.down();await p.mouse.up();};
const fit=async()=>{await click(p.getByRole('button',{name:'Fit',exact:true}));await p.waitForTimeout(700);await click(p.getByRole('button',{name:'Zoom out'}).or(p.locator('.tool-btn[title^="Zoom out"]')).first());await p.waitForTimeout(700);};
await p.locator('.isolation-banner',{hasText:'(10 nodes'}).waitFor({timeout:15000});
await p.waitForTimeout(200);
await click(p.getByLabel('Clear search'));
await fit();
await clickNode('bc1qc662a6c4');                        // select the wallet -> connections highlight
mark('wallet selected');
await p.mouse.move(900,700,{steps:15});
await fit();
await clickNode('147.234.127.');                         // step outward
await p.mouse.move(900,720,{steps:10});
await p.keyboard.press('e'); mark('E 1');               // expand
await p.waitForTimeout(1300);
await fit();
await clickNode('bc1qc662a6c4');                        // back on the wallet
await p.waitForTimeout(500); mark('trace start');
await click(p.locator('.tool-btn',{hasText:'Trace'}));
await p.waitForTimeout(600);
const to=p.getByPlaceholder('Paste an address, txid or IP');
await click(to); await to.pressSequentially(T,{delay:12});
await p.waitForTimeout(500);
await click(p.getByRole('button',{name:'Find shortest path'})); mark('trace');
await at(72.5);
await click(p.getByRole('button',{name:'Export'})); await p.waitForTimeout(700);
await click(p.getByText('Export canvas as PNG'));    mark('export');
await p.waitForTimeout(1500);await p.keyboard.press('Escape');await at(78);
const vB=await p.video().path();
await ctx.close(); await b.close();
fs.writeFileSync(D+'meta.json',JSON.stringify({vA,offA,vB,offB,MARKS}));
console.log('saved',vA,offA,vB,offB);
