'use strict';
const $=q=>document.querySelector(q);
const emulatorMode=typeof location!=='undefined'&&new URLSearchParams(location.search).get('emulator')==='1'&&window.parent!==window;
if(emulatorMode)document.documentElement.classList.add('emulator-embed');
const definitions={
 idle:{name:'Awake',icon:'☀',sub:'Relaxed & present',message:'Hello, I’m here.',hint:'Quiet glances, little head tilts and natural blinks. Tap to talk.'},
 sleep:{name:'Sleep',icon:'☾',sub:'Resting',message:'Taking a little rest.',hint:'Tap to wake and start listening. Offline is a separate recovery state.'},
 wake:{name:'Wake up',icon:'✧',sub:'A gentle hello',message:'Oh, hello there.',hint:'A little stretch, then listening.'},
 listen:{name:'Listen',icon:'◖',sub:'All ears',message:'You have my attention.',hint:'Adjust the voice slider to see me respond.'},
 think:{name:'Think',icon:'∴',sub:'Considering',message:'Let me think…',hint:'Eyes glance left and right; the head follows gently, with little pauses to consider.'},
 search:{name:'Search',icon:'⌕',sub:'Looking around',message:'Looking into it.',hint:'Following a thought, from one place to the next.'},
 speak:{name:'Speak',icon:'♫',sub:'A lively reply',message:'I found something for you.',hint:'Vowel shapes, phrase pauses and little moments of emphasis.'},
 confused:{name:'Confused',icon:'≈',sub:'Working it out',message:'Hmm…',hint:'A small double take and an uncertain smile.'},
 curious:{name:'Curious',icon:'?',sub:'Tell me more',message:'Oh? Tell me more.',hint:'One raised brow, a little lean, and a questioning gaze.'},
 surprised:{name:'Surprised',icon:'!',sub:'An unexpected idea',message:'Oh! I see it now.',hint:'A quick intake, wide eyes, then a warm smile.'},
 delighted:{name:'Big smile',icon:'◡',sub:'Reference expression',message:'Hi!',hint:'A wide open smile with a soft tongue.'},
 loved:{name:'Compliment',icon:'♥',sub:'You’re wonderful!',message:'Thank you!',hint:'A warm little reaction to kind words.'},
 happy:{name:'Celebrate',icon:'♡',sub:'A job well done',message:'We did it!',hint:'A happy squint and one small celebratory hop.'}
};
Object.assign(definitions,workflowStates);
$('#states').innerHTML=Object.entries(definitions).map(([id,d])=>`<button data-state="${id}" aria-pressed="${id==='idle'}"><span class="icon">${d.icon}</span><span><strong>${d.name}</strong><small>${d.sub}</small></span></button>`).join('');
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
let state='sleep',started=performance.now(),last=started,nextBlink=started+3200,blinkStarted=-Infinity,motion=true,online=true,voice=.45,expression=.75,demoTimers=[],demoRunning=false,frameId;
let pose={x:0,y:0,angle:0,scale:1,eye:1,gx:0,gy:0,smile:24,open:0,width:49,skew:0,brow:0,asym:0,joy:0,round:0};
const statuses={idle:'tap to talk',sleep:'tap on me to wake up',wake:'waking up…',listen:'listening…',think:'thinking…',search:'looking into it…',speak:'speaking…',confused:'hmm…',curious:'let me understand…',surprised:'oh! I see…',delighted:'hello!',loved:'aww, thank you!',happy:'all done!'};
for(const [id,d] of Object.entries(workflowStates))statuses[id]=d.status;
const headVelocity={x:0,y:0,angle:0,scale:0};
// Browser-only eye attention; touch interaction and native Watch motion stay unchanged.
const pointerGaze={x:0,y:0,active:false},eyeAttention={x:0,y:0};
function trackMouse(event,offsetX=0,offsetY=0){
 if(event.pointerType!=='mouse')return;
 const rect=$('#stage').getBoundingClientRect();
 if(!rect.width||!rect.height)return;
 pointerGaze.x=Math.max(-1,Math.min(1,(event.clientX-offsetX-rect.left-rect.width*.5)/(rect.width*.7)))*24;
 pointerGaze.y=Math.max(-1,Math.min(1,(event.clientY-offsetY-rect.top-rect.height*.45)/(rect.height*.7)))*16;
 pointerGaze.active=true;
}
function releaseMouse(){pointerGaze.active=false;}
window.addEventListener('pointermove',event=>trackMouse(event));
window.addEventListener('blur',releaseMouse);
document.addEventListener('pointerleave',releaseMouse);
if(emulatorMode&&window.frameElement){
 // Include the surrounding emulator, with coordinates translated into the Watch frame.
 window.parent.addEventListener('pointermove',event=>{
  const rect=window.frameElement.getBoundingClientRect();
  trackMouse(event,rect.left,rect.top);
 });
 window.parent.addEventListener('blur',releaseMouse);
 window.parent.document.addEventListener('pointerleave',releaseMouse);
}

let speechEntrancePose=null,speechExitPose=null;
let visibleCaption='',captionShownAt=-Infinity;
function captionAt(requested,now){
 // Keep only the latest pending caption, rather than replaying stale statuses.
 if(requested!==visibleCaption&&now-captionShownAt>=1000){visibleCaption=requested;captionShownAt=now;}
 return visibleCaption;
}
const events=[];
const microphone=new MuseMicrophone(status=>{
 if(state!=='listen')return;
 $('#message').textContent=status==='active'?'listening…':status==='pending'?'allow microphone…':status==='denied'?'microphone blocked':'microphone unavailable';
 $('#connection').textContent=status==='active'?'Live microphone · local analysis only':status==='pending'?'Waiting for microphone permission':'Enable microphone access, then retry';
 $('#mic-retry').hidden=status==='active'||status==='pending';
 logEvent('microphone',status);
});
$('#mic-retry').onclick=()=>{if(state==='listen')void microphone.start();else setState('listen');};
let heartOverlay=false,heartStarted=-Infinity;
function heartTime(t){return heartOverlay?(performance.now()-heartStarted)/1000:t;}
let story='calendar',pendingAction=false,pressed=false,reactionTimer;
const reactionDurations={confused:3000,curious:3000,surprised:2400,delighted:2800,loved:4400,happy:2400};
$('#mascot').onpointerdown=()=>{pressed=true;};
window.addEventListener('pointerup',()=>{pressed=false;});
window.addEventListener('pointercancel',()=>{pressed=false;});
function logEvent(kind,detail){
 const entry={time:new Date().toLocaleTimeString('en-GB',{hour12:false}),kind,detail};
 events.unshift(entry);if(events.length>60)events.pop();
 const row=document.createElement('li');row.textContent=`${entry.time} · ${kind} · ${detail}`;
 $('#event-log').prepend(row);while($('#event-log').children.length>60)$('#event-log').lastElementChild.remove();
}
$('#clear-log').onclick=()=>{events.length=0;$('#event-log').replaceChildren();};
function filterStates(){const group=$('#state-filter').value;document.querySelectorAll('[data-state]').forEach(b=>b.hidden=group!=='all'&&!stateGroups[group].includes(b.dataset.state));}
$('#state-filter').onchange=filterStates;
function scheduleStates(sequence){
 cancelDemo();demoRunning=true;$('#demo').textContent='■ Stop conversation';
 for(const [id,delay]of sequence)demoTimers.push(setTimeout(()=>{setState(id,true);if(id==='happy'){$('#message').textContent=story==='research'?'your research is ready':'lunch added · 1 pm';logEvent('result',$('#message').textContent+' (simulated)');}if(id==='approval'||id==='clarify'||id===sequence[sequence.length-1][0]){cancelDemo();}},delay));
}
function finishApprovedTask(){
 pendingAction=false;logEvent('approval','user approved simulated lunch event');
 scheduleStates([['working',0],[story==='recovery'?'error':'happy',2600]]);
}
function startStory(){
 story=$('#scenario').value;online=true;pendingAction=false;
 logEvent('story',story+' · simulated only');
 if(story==='research')scheduleStates([['listen',0],['transcribe',1800],['route',3000],['search',4200],['waiting',6500],['speak',8500],['happy',17000]]);
 else if(story==='clarification')scheduleStates([['listen',0],['transcribe',1800],['clarify',3000]]);
 else scheduleStates([['listen',0],['transcribe',1800],['think',2900],['route',4200],['approval',5600]]);
}
$('#story').onclick=startStory;
$('#cancel-action').onclick=()=>{pendingAction=false;logEvent('cancel','user cancelled the simulated task');setState('cancelled');};
function connection(){ $('#connection').textContent=online?'Simulated tasks · microphone used only while listening':'Offline preview';$('#disconnect').textContent=online?'Disconnect':'Reconnect'; }
function cancelDemo(){demoTimers.forEach(clearTimeout);demoTimers=[];demoRunning=false;$('#demo').textContent='▶ Play a full conversation';}
function setState(id,fromDemo=false){
 if(!definitions[id])return;
 clearTimeout(reactionTimer);
 if(!fromDemo)cancelDemo();
 const previous=state;
 speechExitPose=previous==='speak'&&id==='idle'?{...pose}:null;
 if(speechExitPose)nextBlink=performance.now()+1800;
 speechEntrancePose=previous==='think'&&id==='speak'?{...pose}:null;
 if(previous==='listen')microphone.stop();state=id;started=performance.now();if(id==='offline')online=false;
 pendingAction=id==='approval';
 logEvent('state',`${previous} → ${id}`);
 connection();
 $('#state-note').textContent=definitions[id].hint||definitions[id].sub;
 $('#cancel-action').disabled=!['approval','working','waiting','think','route','search','clarify'].includes(id);
 $('#message').textContent=statuses[id];
 $('#message').setAttribute('aria-label',id==='listen'?'listening — microphone activity':statuses[id]);
 $('#mic-retry').hidden=true;
 if(id==='listen'&&!emulatorMode)void microphone.start();
 $('#mascot').setAttribute('aria-label',id==='approval'?'Approve simulated lunch event':id==='error'?'Retry simulated save':id==='sleep'?'Tap Jolly to wake up':id==='listen'?'Tap Jolly to finish talking':'Tap Jolly to continue');
 document.querySelectorAll('[data-state]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.state===id)));
 // Keep this reaction independent of story timers, which stop at the result.
 if(Object.hasOwn(reactionDurations,id))reactionTimer=setTimeout(()=>setState('idle'),reactionDurations[id]);
}
function reply(){
 story='calendar';
 logEvent('request','simulated request: lunch tomorrow at 1 pm');
 scheduleStates([['transcribe',0],['think',1200],['route',2600],['approval',4000]]);
}
$('#states').onclick=e=>{const b=e.target.closest('[data-state]');if(b)setState(b.dataset.state);};
$('#mascot').onclick=()=>{
 if(emulatorMode){window.parent.postMessage({type:'muse-tap'},location.origin);return;}
 logEvent('tap',state);
 if(state==='approval'&&pendingAction){finishApprovedTask();return;}
 if(state==='clarify'){logEvent('clarification','demo answer: tomorrow');scheduleStates([['think',0],['approval',1500]]);return;}
 if(state==='error'){story='calendar';logEvent('retry','simulated save');scheduleStates([['connecting',0],['working',1200],['happy',3500]]);return;}
 if(state==='permission'){logEvent('blocked','Calendar connection must be completed on iPhone');return;}
 if(!online||state==='offline'){online=true;scheduleStates([['connecting',0],['listen',1400]]);return;}
 if(state==='sleep')setState('wake');
 else if(state==='listen')reply();
 else setState('listen');
};
$('#disconnect').onclick=()=>{if(online){online=false;setState('offline');}else{online=true;setState('wake');}};
$('#expression').oninput=e=>{expression=Number(e.target.value)/100;$('#expression-value').value=e.target.value+'%';};
$('#voice').oninput=e=>{voice=Number(e.target.value)/100;$('#voice-value').value=e.target.value+'%';};
$('#blink').onclick=()=>{if(state==='sleep')setState('wake');else blinkStarted=performance.now();};
$('#motion').onclick=()=>{motion=!motion;$('#motion').textContent=motion?'Motion on':'Motion off';$('#motion').setAttribute('aria-pressed',String(motion));};
$('#demo').onclick=()=>{if(demoRunning){pendingAction=false;setState('cancelled');}else startStory();};
// Authored silent phrase: closures, open vowels, rounded vowels and real rests.
// Each cue blends into the next; a real audio adapter will supply these channels later.
const speechCues=[
 [0,0,45,0],[.18,.18,36,.3],[.38,.72,48,.1],[.62,.25,56,0],
 [.83,0,40,0],[1.02,.55,25,1],[1.28,.8,32,.8],[1.57,.22,50,0],
 [1.85,0,47,0],[2.25,0,47,0],[2.44,.42,54,0],[2.68,.85,47,.15],
 [2.92,.12,37,0],[3.1,0,38,0],[3.28,.6,26,1],[3.55,.38,51,0],
 [3.85,.68,55,.1],[4.12,.17,42,.3],[4.4,0,48,0],[5.05,0,48,0],
 [5.25,.28,33,.7],[5.5,.78,46,.2],[5.8,.35,54,0],[6.04,0,39,0],
 [6.2,.55,24,1],[6.5,.73,46,.1],[6.8,.25,53,0],[7.08,0,48,0],[8.4,0,48,0]
];
function speechAt(time){
 const t=time%8.4;
 const index=speechCues.findIndex((cue,i)=>i<speechCues.length-1&&t>=cue[0]&&t<speechCues[i+1][0]);
 const a=speechCues[Math.max(0,index)],b=speechCues[Math.max(0,index)+1];
 const u=Math.max(0,Math.min(1,(t-a[0])/(b[0]-a[0]))),ease=u*u*(3-2*u);
 return {open:a[1]+(b[1]-a[1])*ease,width:a[2]+(b[2]-a[2])*ease,round:a[3]+(b[3]-a[3])*ease};
}
const pulse=(t,center,width)=>Math.exp(-(((t-center)/width)**2));
// Unevenly spaced idle gestures leave room for stillness between little discoveries.
// Gaze leads the head; every gesture releases back to the relaxed base pose.
const idleGestures=[
 {at:2,duration:2.8,gx:-17,gy:-5,angle:-3,brow:2},
 {at:7.2,duration:3.4,gx:15,gy:-10,angle:4,brow:5},
 {at:13,duration:2.3,gx:0,gy:3,angle:-2,smile:5},
 {at:18.3,duration:3.1,gx:-9,gy:8,angle:-4,brow:2},
 {at:24.5,duration:3.6,gx:12,gy:-3,angle:3,smile:4}
];
function idleGestureAt(time){
 const cycle=Math.floor(time/32),phase=time%32,direction=cycle%2?-1:1;
 const cue=idleGestures.find(g=>phase>=g.at&&phase<g.at+g.duration);
 if(!cue)return {};
 const age=phase-cue.at;
 const smooth=v=>{v=Math.max(0,Math.min(1,v));return v*v*(3-2*v);};
 const gaze=smooth(age/.35)*smooth((cue.duration-age)/.65);
 const head=smooth((age-.16)/.7)*smooth((cue.duration-age)/.8);
 return {gx:cue.gx*gaze*direction,gy:cue.gy*gaze,angle:cue.angle*head*direction,
  brow:(cue.brow||0)*head,smile:24+(cue.smile||0)*head};
}
// Uneven pauses make each glance deliberate. Eyes lead; the head follows.
const thinkingBeats=[
 {at:0,gx:-30,gy:-15,angle:-6,eye:.94,smile:12,asym:8},
 {at:2.1,gx:29,gy:-10,angle:6,eye:.88,smile:8,asym:-7},
 {at:4.5,gx:-18,gy:-23,angle:-4,eye:1,smile:15,asym:5},
 {at:6.4,gx:22,gy:-8,angle:4,eye:.9,smile:10,asym:-5},
 {at:8.6,gx:-30,gy:-15,angle:-6,eye:.94,smile:12,asym:8},
];
function thinkingAt(time){
 const phase=((time%8.6)+8.6)%8.6;
 const index=thinkingBeats.findIndex((beat,i)=>i<thinkingBeats.length-1&&phase>=beat.at&&phase<thinkingBeats[i+1].at);
 const a=thinkingBeats[index],b=thinkingBeats[index+1];
 const blend=Math.max(0,Math.min(1,(phase-(b.at-.85))/.85));
 const ease=blend*blend*blend*(blend*(blend*6-15)+10);
 return Object.fromEntries(['gx','gy','angle','eye','smile','asym'].map(key=>[key,a[key]+(b[key]-a[key])*ease]));
}
function render(now){const dt=Math.min((now-last)/1000,.05);last=now;const t=(now-started)/1000;const active=motion&&!reduced.matches;const breath=active?Math.sin(now/1100):0;
 const follow=active&&pointerGaze.active&&!['sleep','offline','wake'].includes(state);
 const attentionEase=1-Math.exp(-dt*7);
 for(const axis of ['x','y'])eyeAttention[axis]+=((follow?pointerGaze[axis]:0)-eyeAttention[axis])*attentionEase;
 if(state==='listen'&&!emulatorMode)microphone.sample();
 let target={x:0,y:breath*1.3,angle:0,scale:1+breath*.012,eye:1,gx:0,gy:0,smile:24,open:0,width:49,skew:0,brow:0,asym:0,joy:0,round:0};
 if(state==='idle'&&active)Object.assign(target,idleGestureAt(speechExitPose?Math.max(0,t-1.4):t));
 if(workflowStates[state]){
  Object.assign(target,workflowStates[state].pose);
  if(active){
   if(state==='connecting'){target.gx=18*Math.sin(t*1.2);target.angle=target.gx/6;}
   if(state==='transcribe'){target.y=3*pulse(t,.6,.25);target.gy=9-12*pulse(t,.6,.25);}
   if(state==='route'){target.gx=24*Math.tanh(Math.sin(t*.9)*3);target.angle=target.gx/5;}
   if(state==='working'){target.gx=12*Math.sin(t*1.4);target.y=1.5*Math.sin(t*2);}
   if(state==='waiting'){target.gx=14*Math.sin(t*.55);target.eye=.68+.08*Math.sin(t*.7);}
   if(state==='error'){target.angle=5+Math.sin(t*8)*3*Math.exp(-t*2);}
   if(state==='reminder'){target.y=-6*pulse(t,.35,.2)-3*pulse(t,.8,.18);}
   if(state==='cancelled'){target.y=3*pulse(t,.4,.25);}
  }
 }
 if(state==='sleep'||state==='offline'){Object.assign(target,{angle:9,y:8+breath*2,scale:.97+breath*.012,eye:0,smile:8,gy:4});}
 if(state==='wake'){Object.assign(target,{eye:Math.min(1.12,t*.9),angle:-3*Math.exp(-t),scale:1+.04*Math.sin(Math.min(t/1.8,1)*Math.PI),gy:-6,smile:30});if(t>1.5){setState('listen',demoRunning);}}
 // Deliberate phrase pauses and changing vowel shapes, not a continuous oscillator.
 const phrase=active?t%5.6:0;
 const talking=phrase<1.65||(phrase>2.15&&phrase<4.65);
 const syllable=talking?Math.pow(Math.max(0,Math.sin(t*13)+.3*Math.sin(t*23)),.7):0;
 const vowel=active?Math.floor(t*4.4)%4:0;
 const energy=.35+expression*.85;
 const beat=active?Math.sin(t*2.8):0;
 if(state==='listen'){const nod=active?Math.max(0,Math.sin(t*1.8))**8:0;Object.assign(target,{angle:-5*energy,y:nod*4,scale:1+(active?Math.max(0,Math.min(1,microphone.level))*.12:0),eye:1.1,gx:0,gy:-4+nod*9,smile:22,brow:9,asym:3});}
 if(state==='think'){
  const gaze=thinkingAt(active?t:0),head=thinkingAt(active?Math.max(0,t-.18):0);
  Object.assign(target,gaze,{angle:head.angle,x:head.gx*.055,width:39,brow:8,skew:gaze.gx*.08});
 }
 if(state==='search'){const step=Math.floor(t/1.1)%5;const points=[[-22,-12],[23,-15],[18,10],[-17,7],[0,-20]];Object.assign(target,{gx:points[step][0],gy:points[step][1],angle:points[step][0]/6,eye:1.02,smile:13});}
 if(state==='speak'){
  const phase=active?t%8.4:0,cue=speechAt(phase);
  const accent=active?pulse(phase,.65,.4)+pulse(phase,2.75,.45)+pulse(phase,5.65,.5):0;
  const settle=active?pulse(phase,1.95,.48)+pulse(phase,4.5,.5)+pulse(phase,7.25,.55):0;
  const openness=active?cue.open*Math.min(1.3,voice*1.6):0;
  Object.assign(target,{
   angle:active?(-3*pulse(phase,.9,.75)+4*pulse(phase,3.2,.9)-2.5*pulse(phase,6,.8))*energy:0,
   y:active?-accent*2.8+settle*1.6:0,scale:1+accent*.008,
   open:openness,width:cue.width,round:cue.round,
   smile:24*(1-cue.round*.8),skew:active?2*pulse(phase,4.6,.6):0,
   eye:1+accent*.09-settle*.15,brow:5+accent*12,asym:active?4*pulse(phase,3.1,.9)-3*pulse(phase,6,.8):0,
   gy:active?-accent*4+settle*3:0,gx:active?3*pulse(phase,4.6,.6):0
  });
 }
 if(state==='confused'){const look=active?Math.sin(t*1.1):0;Object.assign(target,{angle:7+look*2,gx:-16+look*8,gy:-9,eye:.83,brow:5,asym:19,smile:-4,width:28,skew:7});}
 if(state==='curious'){Object.assign(target,{angle:-11,eye:1.05,asym:17,brow:13,gx:12,gy:-9,smile:12,width:35,skew:7,scale:1.035});}
 if(state==='surprised'){const surprise=active?Math.exp(-Math.max(0,t-.6)*1.3):.75;Object.assign(target,{eye:1+surprise*.4,brow:24*surprise,open:.7*surprise,width:24+25*(1-surprise),smile:28*(1-surprise),y:-5*surprise,scale:1+.04*surprise});}
 if(state==='delighted'){Object.assign(target,{eye:1.02,smile:18,width:54,open:.85,brow:4,angle:-2});}
 if(state==='loved'){Object.assign(target,{eye:.12,joy:1,smile:34,width:57,brow:5,angle:active?-6+Math.sin(t*1.4)*2:0,scale:1.025,y:active?-Math.sin(Math.min(t/1.2,1)*Math.PI)*4:0});}
 if(state==='happy'){Object.assign(target,{eye:.08,joy:1,smile:36,width:63,brow:12,angle:active&&t<1?Math.sin(t*9)*4:0,y:active&&t<.8?-Math.sin(t/.8*Math.PI)*12:0,scale:1.025});}
 if(pressed)target.scale*=.975;
 target.angle*=energy;target.gx*=energy;target.gy*=energy;target.brow*=energy;target.asym*=energy;
 if(state==='speak'&&speechEntrancePose&&active&&t<.65){
  const u=Math.min(1,t/.65),blend=u*u*u*(u*(u*6-15)+10);
  // Ease gaze and expression out of the current thought; speech mouth stays responsive.
  for(const key of ['gx','gy','eye','smile','brow','asym','skew'])target[key]=speechEntrancePose[key]+(target[key]-speechEntrancePose[key])*blend;
 }
 // Let the last spoken gesture settle before the idle glances begin.
 // Close the mouth sooner so the face never looks frozen mid-word.
 if(state==='idle'&&speechExitPose&&active&&t<1.4){
  for(const key of Object.keys(pose)){
   const duration=['open','width','round'].includes(key)?.4:1.4;
   const u=Math.min(1,t/duration),blend=u*u*u*(u*(u*6-15)+10);
   target[key]=speechExitPose[key]+(target[key]-speechExitPose[key])*blend;
  }
 }
 if(active&&state!=='sleep'&&state!=='offline'&&state!=='wake'){if(now>nextBlink){blinkStarted=now;nextBlink=now+3400+Math.random()*2400;}const b=(now-blinkStarted)/1000;if(b>=0&&b<.22){target.eye*=1-Math.sin(b/.22*Math.PI);}}
 if(!active){target.x=0;target.y=0;target.angle=0;target.scale=1;target.gx=state==='think'?8:0;target.gy=state==='think'?-12:0;}
 const eyeSmooth=1-Math.exp(-dt*48);
 // Critically damped head motion preserves velocity when a gesture is interrupted.
 for(const key of Object.keys(pose)){
  if(Object.hasOwn(headVelocity,key)){
   const omega=11,delta=pose[key]-target[key],c=headVelocity[key]+omega*delta,decay=Math.exp(-omega*dt);
   pose[key]=target[key]+(delta+c*dt)*decay;
   headVelocity[key]=(headVelocity[key]-omega*c*dt)*decay;
  }else{
   const speed=['gx','gy'].includes(key)?15:['open','width','round'].includes(key)?18:8;
   pose[key]+=(target[key]-pose[key])*(key==='eye'?eyeSmooth:1-Math.exp(-dt*speed));
  }
 }
 $('#mascot').style.transform=`translate(${pose.x}px,${pose.y}px) rotate(${pose.angle}deg) scale(${pose.scale})`;
 $('#face').setAttribute('transform',`translate(${pose.gx*.25} ${pose.gy*.18})`);
 // One continuous filled contour per eye. No separate lid overlay.
 for(const [side,x,sign]of [['left',335,-1],['right',665,1]]){
  const eye=Math.max(0,pose.eye*(1+sign*pose.asym*.008));
  const ex=x+pose.gx*.75+eyeAttention.x,ey=520+pose.gy*.82+eyeAttention.y;
  // Keep the entire brow above the eye, including upward gaze and wide expressions.
  const eyeTop=ey-(3+Math.min(1.45,eye)*32);
  const browEnd=Math.max(4+sign*pose.asym*.4,4-sign*pose.asym*.4);
  const browY=Math.min(450-pose.brow-sign*pose.asym+eyeAttention.y,eyeTop-18-browEnd);
  $('#'+side+'-brow').setAttribute('d',`M ${ex-29} ${browY+4+sign*pose.asym*.4} Q ${ex} ${browY-7} ${ex+29} ${browY+4-sign*pose.asym*.4}`);
  $('#'+side+'-brow').style.opacity=Math.min(.22,Math.abs(pose.brow)/70+Math.abs(pose.asym)/100)*Math.min(1,eye*2);
 }
 // One continuous mouth contour: closed smile, wide vowel and rounded vowel share topology.
 // Reference mouth: shallow smiling upper edge, deep rounded lower bowl.
 const mx=500+pose.skew;
 const openness=Math.max(0,Math.min(1,pose.open));
 const width=pose.width*(1+openness*.32),left=mx-width,right=mx+width;
 const opening=openness*86,restSmile=pose.smile*(1-openness);
 const top=592+restSmile+opening*.08;
 const bottom=592+restSmile+opening*1.22;
 const upperControl=width*.6,lowerControl=width*(.6+openness*.38);
 const mouthPath=`M ${left} 592 C ${mx-upperControl} ${top}, ${mx+upperControl} ${top}, ${right} 592 C ${mx+lowerControl} ${bottom}, ${mx-lowerControl} ${bottom}, ${left} 592 Z`;
 $('#mouth').setAttribute('d',mouthPath);
 const tongueY=592+restSmile*.75+opening*.68;
 $('#tongue').setAttribute('d',`M ${mx-width*.8} ${tongueY+opening*.35} Q ${mx-width*.8} ${tongueY-opening*.26} ${mx} ${tongueY-opening*.26} Q ${mx+width*.8} ${tongueY-opening*.26} ${mx+width*.8} ${tongueY+opening*.35} Z`);
 $('#tongue').style.opacity=Math.max(0,Math.min(1,(openness-.14)*3));
 // A short, interruptible compliment reaction; no persistent decoration.
 document.querySelectorAll('#hearts>span').forEach((heart,i)=>{
  const ht=heartTime(t),age=ht-i*.22,progress=Math.max(0,Math.min(1,age/3.6));
  const show=(state==='loved'||heartOverlay)&&age>=0;
  const fade=Math.min(1,age/.35)*Math.min(1,((heartOverlay?3.6:4.3)-heartTime(t))/.7);
  heart.style.opacity=show?String(Math.max(0,fade)):'0';
  heart.style.transform=active?`translate(${Math.sin(age*1.6+i)*5}px,${-progress*25}px) scale(${.8+.2*Math.min(1,Math.max(0,age)/.4)}) rotate(${Math.sin(age+i)*8}deg)`:'none';
 });
 if(state==='waiting'&&t>8&&$('#message').textContent!=="taking longer than usual…"){$('#message').textContent='taking longer than usual…';logEvent('latency','service still pending; no completion claimed');}
 drawWatch(t,active);
 frameId=requestAnimationFrame(render);
}
document.addEventListener('visibilitychange',()=>{if(document.hidden){if(state==='listen')setState('idle');microphone.stop();pressed=false;cancelAnimationFrame(frameId);if(demoRunning){cancelDemo();setState('cancelled');logEvent('pause','preview hidden; simulated task stopped');}}else{last=performance.now();frameId=requestAnimationFrame(render);}});

const pixelCanvas=$('#watch-pixels'),pixelContext=pixelCanvas.getContext('2d');
const plate=$('#mascot img');
function configurePixels(){
 pixelCanvas.width=368;pixelCanvas.height=448;
 if(emulatorMode){$('#stage').style.width='100%';$('#stage').style.height='100%';return;}
 const zoom=Number($('#pixel-zoom').value),ratio=window.devicePixelRatio||1;
 $('#stage').style.width=`${pixelCanvas.width*zoom/ratio}px`;
 $('#stage').style.height=`${pixelCanvas.height*zoom/ratio}px`;
 $('#pixel-info').textContent=`${pixelCanvas.width} × ${pixelCanvas.height} rendered pixels · ${zoom}× display · device pixel ratio ${ratio}`;
}
$('#pixel-zoom').onchange=configurePixels;
window.addEventListener('resize',configurePixels);
window.addEventListener('pagehide',()=>microphone.stop());
function eyeContour(openness,joy){
 const o=Math.max(0,Math.min(1.45,openness));
 const close=1-Math.min(1,o/.7),curve=(12-joy*34)*close;
 const rx=33-close,ry=3+o*32,k=.5522848;
 // Rounded bead eyes become a single curved lid as they close.
 return new Path2D(`M ${-rx} 0 C ${-rx} ${-ry*k}, ${-rx*k} ${curve-ry}, 0 ${curve-ry} C ${rx*k} ${curve-ry}, ${rx} ${-ry*k}, ${rx} 0 C ${rx} ${ry*k}, ${rx*k} ${curve+ry}, 0 ${curve+ry} C ${-rx*k} ${curve+ry}, ${-rx} ${ry*k}, ${-rx} 0 Z`);
}
function drawWatch(t,active){
 const c=pixelContext,w=pixelCanvas.width,h=pixelCanvas.height,head=w*.86;
 c.clearRect(0,0,w,h);c.fillStyle='#000';c.fillRect(0,0,w,h);
 // Layout is in physical render pixels, independent of browser DPR or inspection zoom.
 const x=(w-head)/2,y=h*.10;
 c.save();c.translate(x+head*.5+pose.x,y+head*.65+pose.y);
 c.rotate(pose.angle*Math.PI/180);c.scale(pose.scale,pose.scale);c.translate(-head*.5,-head*.65);
 if(plate.complete&&plate.naturalWidth)c.drawImage(plate,0,0,head,head);
 c.scale(head/1000,head/1000);c.translate(pose.gx*.25,pose.gy*.18);
 for(const [side,ex,sign]of [['left',335,-1],['right',665,1]]){
  const openness=Math.max(0,pose.eye*(1+sign*pose.asym*.008));
  c.save();c.translate(ex+pose.gx*.75+eyeAttention.x,520+pose.gy*.82+eyeAttention.y);
  const eye=eyeContour(openness,pose.joy),gloss=c.createRadialGradient(10,-17,1,0,0,38);
  gloss.addColorStop(0,'#292b30');gloss.addColorStop(.45,'#101114');gloss.addColorStop(1,'#030405');
  c.fillStyle=openness<.25?'#211916':gloss;c.fill(eye);c.clip(eye);
  const shine=Math.max(0,Math.min(1,(openness-.3)*1.4));
  c.globalAlpha=shine*.2;c.fillStyle='#e5e9f4';
  c.beginPath();c.ellipse(12,-17,10,15,-.55,0,Math.PI*2);c.fill();
  c.globalAlpha=shine*.85;c.fillStyle='#fff';
  c.beginPath();c.ellipse(12,-18,5,9,-.55,0,Math.PI*2);c.fill();c.restore();
  c.save();c.globalAlpha=Number($('#'+side+'-brow').style.opacity)||0;c.strokeStyle='#80634e';c.lineWidth=6;c.lineCap='round';c.stroke(new Path2D($('#'+side+'-brow').getAttribute('d')));c.restore();
 }
 const mouth=new Path2D($('#mouth').getAttribute('d')),depth=c.createLinearGradient(0,590,0,675);
 depth.addColorStop(0,'#281311');depth.addColorStop(1,'#71332e');c.fillStyle=depth;c.fill(mouth);c.strokeStyle='#281b17';c.lineWidth=7;c.lineJoin='round';c.lineCap='round';c.stroke(mouth);
 c.save();c.clip(mouth);c.globalAlpha=Number($('#tongue').style.opacity)||0;c.fillStyle='#bd7773';c.fill(new Path2D($('#tongue').getAttribute('d')));c.restore();c.restore();
 if(state==='loved'||heartOverlay){
  const points=[[.13,.49,25],[.86,.29,31],[.22,.22,19]];
  points.forEach(([hx,hy,size],i)=>{const age=heartTime(t)-i*.22;if(age<0)return;c.save();c.globalAlpha=Math.max(0,Math.min(1,age/.35,((heartOverlay?3.6:4.3)-heartTime(t))/.7));c.font=`${size}px sans-serif`;c.textAlign='center';c.fillText('❤️',hx*w,hy*h-(active?Math.min(1,age/3.6)*25:0));c.restore();});
 }
 c.fillStyle='#e6e2db';c.font='400 22px -apple-system, BlinkMacSystemFont, sans-serif';c.textAlign='center';c.textBaseline='middle';
 // Preserve normal letter shapes rather than horizontally squeezing long replies.
 const fullText=captionAt($('#message').textContent,performance.now());
 let caption=fullText;
 while(caption.length&&c.measureText(caption).width>w-32)caption=caption.slice(0,-1);
 if(caption!==fullText){while(caption.length&&c.measureText(caption+'…').width>w-32)caption=caption.slice(0,-1);caption=caption.trimEnd()+'…';}
 c.fillText(caption,w/2,h*.87+6);
}
const emotionsOnly=typeof location!=='undefined'&&new URLSearchParams(location.search).get('view')==='emotions';
if(emotionsOnly){
 document.documentElement.classList.add('emotions-only');
 $('#state-filter').value='emotions';
 document.title='Muse for Watch · emotions';
 $('.intro h1').textContent='every little feeling.';
 $('.intro>p:last-child').textContent='Choose an emotion to see Jolly react, then settle back to neutral.';
 $('aside>.description').textContent='All available emotions and reactions. Click one to preview its animation.';
 $('header>a').href='/preview/emulator/';$('header>a').textContent='← back to emulator';
 $('#mascot').onclick=()=>setState('idle');
}
filterStates();setState(emotionsOnly?'idle':'sleep');pose.eye=emotionsOnly?1:0;pose.angle=emotionsOnly?0:9;configurePixels();frameId=requestAnimationFrame(render);

if(emulatorMode){
 window.addEventListener('message',event=>{
  if(event.origin!==location.origin||event.source!==window.parent)return;
  const data=event.data;
  if(data?.type==='muse-state'&&definitions[data.state]){
   if(data.hearts===true&&!heartOverlay)heartStarted=performance.now();
   heartOverlay=data.hearts===true;
   // Progress polling must not restart the thinking gesture every time.
   if(state!==data.state)setState(data.state);
   if(typeof data.text==='string'){$('#message').textContent=data.text;$('#message').setAttribute('aria-label',data.text);}
   $('#mascot').setAttribute('aria-label',data.state==='listen'?'Finish recording':data.state==='approval'?'Review the proposed event beside the watch':'Tap to talk');
  }
  if(data?.type==='muse-level'&&typeof data.level==='number'&&Number.isFinite(data.level))microphone.level=Math.max(0,Math.min(1,data.level));
 });
 window.parent.postMessage({type:'muse-ready'},location.origin);
}
