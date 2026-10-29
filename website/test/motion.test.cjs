const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
test('idle and confused stay alive, settle after 1.5s, and respect reduced motion',()=>{
 const events={},attrs={},eyes={style:{},appendChild(){}},brows=[{setAttribute(){}},{setAttribute(){}}];
 const expression={style:{}},smile={style:{},setAttribute(k,v){this[k]=v;}};
 const caption={},lids={setAttribute(k,v){this[k]=v;}},media={matches:false,addEventListener(k,f){this.change=f;}};
 const face={style:{},querySelector:q=>q==='.idle-eyes'?eyes:q==='.confused-expression'?expression:smile,querySelectorAll:()=>brows,setAttribute(k,v){attrs[k]=v;},getAttribute:k=>attrs[k],addEventListener(k,f){events[k]=f;}};
 let now=0,id=0;const frames=new Map(),timers=new Map();
 const doc={hidden:false,querySelector:q=>q==='.idle-face'?face:q==='#watch-caption'?caption:null,createElementNS:()=>lids,addEventListener(k,f){events[k]=f;}};
 vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../dist/mouse-gaze.js'),'utf8'),{
  document:doc,window:{addEventListener(){}},matchMedia:()=>media,performance:{now:()=>now},
  requestAnimationFrame:f=>(frames.set(++id,f),id),cancelAnimationFrame:i=>frames.delete(i),
  setTimeout:(f,delay)=>(timers.set(++id,{f,at:now+delay}),id),clearTimeout:i=>timers.delete(i),
 });
 function step(ms){for(let t=0;t<ms;t+=16){now+=16;for(const [i,v]of timers)if(now>=v.at){timers.delete(i);v.f();}const pending=[...frames];frames.clear();for(const [,f]of pending)f(now);}}
 step(500);const idle=face.style.transform;step(500);assert.notEqual(face.style.transform,idle);
 events.click();step(16);assert.equal(smile.style.opacity,'1');assert.notEqual(smile.d,'M439 548 C463 582, 537 582, 561 548','mouth starts morphing');const enteringMouth=smile.d;step(144);const confused=eyes.style.transform;step(176);assert.notEqual(eyes.style.transform,confused);
 assert.notEqual(lids.transform,'translate(0 487) scale(1 1) translate(0 -487)','confused blinks');
 assert.equal(attrs['aria-pressed'],'true');step(1200);assert.equal(attrs['aria-pressed'],'false');
 assert.equal(caption.textContent,'tap to talk');assert.equal(expression.style.opacity,'1');assert.equal(smile.style.opacity,'1');assert.notEqual(smile.d,enteringMouth,'mouth geometry changes without fading');
 const returned=face.style.transform;step(600);assert.notEqual(face.style.transform,returned,'idle keeps moving');
 events.click();step(900);events.click();step(900);assert.equal(attrs['aria-pressed'],'true','latest tap owns timer');step(700);assert.equal(attrs['aria-pressed'],'false');
 media.matches=true;media.change();step(3000);assert.equal(frames.size,0,'reduced motion settles');
 media.matches=false;media.change();step(50);assert.equal(frames.size,1);
 doc.hidden=true;events.visibilitychange();assert.equal(frames.size,0,'hidden page pauses');
 doc.hidden=false;events.visibilitychange();step(50);assert.equal(frames.size,1,'visible page resumes');
});
