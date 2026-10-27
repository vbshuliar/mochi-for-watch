// Headless behavioural checks for the local demo; no browser/service dependencies.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
let now=0,frame,timerId=0;const timers=new Map(),nodes=new Map();
const gradient={addColorStop(){}};
const context2d=new Proxy({createRadialGradient:()=>gradient,createLinearGradient:()=>gradient,measureText:text=>({width:text.length*11})},{get:(o,k)=>o[k]||(()=>{})});
function element(){return {style:{},attrs:{},children:[],dataset:{},textContent:'',setAttribute(k,v){assert(!/NaN|Infinity/.test(v));this.attrs[k]=v;},getAttribute(k){return this.attrs[k];},getContext:()=>context2d,prepend(row){this.children.unshift(row);row.remove=()=>this.children.pop();},replaceChildren(){this.children=[];},get lastElementChild(){return this.children.at(-1);}};}
function node(k){if(!nodes.has(k)){const n=element();n.value=k==='#pixel-zoom'?'2':k==='#state-filter'?'conversation':k==='#scenario'?'calendar':'';nodes.set(k,n);}return nodes.get(k);}
const reduced={matches:false};
const ctx=vm.createContext({document:{querySelector:node,querySelectorAll:()=>[],createElement:element,addEventListener(){}},window:{devicePixelRatio:2,addEventListener(){}},matchMedia:()=>reduced,performance:{now:()=>now},requestAnimationFrame:f=>(frame=f,1),cancelAnimationFrame(){},setTimeout:(f,t)=>(timers.set(++timerId,{f,at:now+t}),timerId),clearTimeout:id=>timers.delete(id),Math,Date,Path2D:class{constructor(path){assert(!/NaN|Infinity|undefined/.test(path));}}});
for(const file of ['workflow.js','microphone.js','lab.js'])vm.runInContext(fs.readFileSync(__dirname+'/'+file,'utf8'),ctx);
function step(ms){for(let i=0;i<ms/16;i++){now+=16;for(const [id,t]of timers){if(t.at<=now){timers.delete(id);t.f();}}frame(now);}}
// Captions remain readable for one second and never queue obsolete intermediate text.
assert.equal(vm.runInContext("captionAt('listening…',0)",ctx),'listening…');
assert.equal(vm.runInContext("captionAt('thinking…',400)",ctx),'listening…');
assert.equal(vm.runInContext("captionAt('speaking…',999)",ctx),'listening…');
assert.equal(vm.runInContext("captionAt('speaking…',1000)",ctx),'speaking…');
assert.equal(vm.runInContext("captionAt('tap to talk',1999)",ctx),'speaking…');
assert.equal(vm.runInContext("captionAt('tap to talk',2000)",ctx),'tap to talk');
vm.runInContext("visibleCaption='';captionShownAt=-Infinity",ctx);
node('#story').onclick();step(6000);assert.equal(node('#message').textContent,'add lunch at 1? tap yes');step(20000);assert.equal(node('#message').textContent,'add lunch at 1? tap yes','must not auto-approve');
node('#mascot').onclick();step(3000);assert.equal(node('#message').textContent,'lunch added · 1 pm');
assert.equal(vm.runInContext('state',ctx),'happy');step(2200);assert.equal(vm.runInContext('state',ctx),'idle');assert.equal(node('#message').textContent,'tap to talk');
vm.runInContext("setState('happy')",ctx);step(1000);node('#mascot').onclick();step(2000);assert.equal(vm.runInContext('state',ctx),'listen','old celebration must not interrupt listening');
node('#story').onclick();step(6000);node('#cancel-action').onclick();step(20000);assert.equal(node('#message').textContent,'cancelled · nothing changed');
node('#scenario').value='recovery';node('#story').onclick();step(6000);node('#mascot').onclick();step(3000);assert.equal(node('#message').textContent,'couldn’t save. tap to retry');node('#mascot').onclick();step(4000);assert.equal(node('#message').textContent,'lunch added · 1 pm');
node('#scenario').value='clarification';node('#story').onclick();step(4000);assert.equal(node('#message').textContent,'which day did you mean?');node('#mascot').onclick();step(2000);assert.equal(node('#message').textContent,'add lunch at 1? tap yes');
// Every emotion must release its full pose, and stale timers must not interrupt work.
for(const emotion of vm.runInContext('stateGroups.emotions',ctx)){
 vm.runInContext(`setState('${emotion}')`,ctx);step(600);
 assert.equal(vm.runInContext('state',ctx),emotion);
 step(6000);assert.equal(vm.runInContext('state',ctx),'idle',emotion+' returns to neutral');
 assert.equal(node('#message').textContent,'tap to talk');
 // Disable decorative blinking/breathing to inspect the settled neutral pose.
 reduced.matches=true;step(2000);
 const settled=vm.runInContext('({...pose})',ctx);
 const neutral={x:0,y:0,angle:0,scale:1,eye:1,gx:0,gy:0,smile:24,open:0,width:49,skew:0,brow:0,asym:0,joy:0,round:0};
 for(const [key,value] of Object.entries(neutral))assert(Math.abs(settled[key]-value)<.01,emotion+' resets '+key);
 reduced.matches=false;
 vm.runInContext(`setState('${emotion}')`,ctx);step(400);vm.runInContext("setState('think')",ctx);step(5000);
 assert.equal(vm.runInContext('state',ctx),'think',emotion+' cannot interrupt a newer task');
}
// Idle stays available while its gaze/head vary, and reduced motion settles fully.
vm.runInContext("setState('idle')",ctx);
const idleSamples=[];for(let i=0;i<160;i++){step(250);idleSamples.push(vm.runInContext('({...pose})',ctx));}
assert(idleSamples.some(p=>p.gx < -8)&&idleSamples.some(p=>p.gx > 8),'idle looks both ways');
assert(idleSamples.some(p=>Math.abs(p.angle)>2),'idle moves its head');
assert(idleSamples.some(p=>p.eye<.9),'idle blinks');
assert.equal(vm.runInContext('state',ctx),'idle');assert.equal(node('#message').textContent,'tap to talk');
reduced.matches=true;step(2000);
assert(Math.abs(vm.runInContext('pose.gx+pose.gy+pose.angle',ctx))<.01,'reduced motion settles idle');
reduced.matches=false;
// Rapid changes keep the current head pose; the spring carries it smoothly forward.
vm.runInContext("setState('curious')",ctx);step(700);
const beforeTransition=vm.runInContext('({...pose})',ctx);
vm.runInContext("setState('idle')",ctx);
assert.equal(vm.runInContext('pose.angle',ctx),beforeTransition.angle,'state changes do not teleport the head');
step(16);assert(Math.abs(vm.runInContext('pose.angle',ctx)-beforeTransition.angle)<1,'head eases out of a tilt');
vm.runInContext("setState('listen'); microphone.level=0",ctx);step(1800);
const quietScale=vm.runInContext('pose.scale',ctx);
vm.runInContext('microphone.level=1',ctx);step(1800);
const loudScale=vm.runInContext('pose.scale',ctx);
assert(loudScale>quietScale+.1&&loudScale<=1.121,'head grows with measured voice level, within bounds');
vm.runInContext('microphone.level=0',ctx);step(1800);
assert(Math.abs(vm.runInContext('pose.scale',ctx)-quietScale)<.001,'head settles back in silence');
const ids=vm.runInContext('Object.keys(definitions)',ctx);for(const id of ids){vm.runInContext(`setState('${id}')`,ctx);step(9000);}
// Thinking visibly looks both ways and has no discontinuity at beat/loop boundaries.
vm.runInContext("setState('think')",ctx);
const thoughts=[];for(let i=0;i<90;i++){step(100);thoughts.push(vm.runInContext('({...pose})',ctx));}
assert(thoughts.some(p=>p.gx<-20)&&thoughts.some(p=>p.gx>20),'thinking looks left and right');
const thinkingPose=vm.runInContext('({...pose})',ctx);
vm.runInContext("setState('speak')",ctx);step(16);
const speechPose=vm.runInContext('({...pose})',ctx);
assert(Math.abs(speechPose.gx-thinkingPose.gx)<1,'speaking keeps the current gaze on its first frame');
assert(Math.abs(speechPose.angle-thinkingPose.angle)<1,'speaking does not snap head rotation');
for(const at of [2.1,4.5,6.4,8.6]){
 const a=vm.runInContext(`thinkingAt(${at-.001})`,ctx),b=vm.runInContext(`thinkingAt(${at+.001})`,ctx);
 assert(Math.abs(a.gx-b.gx)<.01&&Math.abs(a.angle-b.angle)<.01,'thinking loop stays continuous');
}
for(let i=0;i<80;i++)vm.runInContext("setState('idle')",ctx);assert.equal(node('#event-log').children.length,60);node('#clear-log').onclick();assert.equal(node('#event-log').children.length,0);
assert.equal(node('#watch-pixels').width,368);assert.equal(node('#watch-pixels').height,448);
reduced.matches=true;vm.runInContext("setState('speak')",ctx);step(4000);const before=node('#mouth').attrs.d;step(4000);const pathNumbers=s=>s.match(/-?\d+(?:\.\d+)?/g).map(Number);const settledMouth=pathNumbers(before),laterMouth=pathNumbers(node('#mouth').attrs.d);assert(settledMouth.every((value,i)=>Math.abs(value-laterMouth[i])<1e-8),'reduced motion mouth stays settled');
console.log(`PASS: ${ids.length} states, explicit approval, cancellation, recovery, clarification, bounded/clearable log, fixed pixel buffer and reduced motion.`);
