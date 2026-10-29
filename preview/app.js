'use strict';
const states = [
 {id:'idle',title:'Tuck · Idle',label:'Tap to talk',description:'A gentle breath. A little blink. Ready when you are.',hint:'Tap to talk to Tuck.'},
 {id:'listening',title:'Listening',label:'Finish',description:'An attentive lean and a reactive voice waveform.',hint:'Imagine saying: “Find 30 minutes for a walk tomorrow.”'},
 {id:'thinking',title:'Thinking',label:'Cancel',description:'A curious head tilt while Tuck checks your calendar.',hint:'Checking your calendar…'},
 {id:'speaking',title:'Speaking',label:'Stop speaking',description:'A soft speech pulse. You can interrupt at any time.',hint:'“You have time tomorrow at two.”'},
 {id:'approval',title:'Review action',label:'Add',description:'A calm pause. Nothing changes until you approve.',hint:'Review the proposed event, then add or cancel.'},
 {id:'executing',title:'Adding to Calendar',label:'Adding…',description:'Working on exactly the action you approved.',hint:'Simulating event creation…'},
 {id:'success',title:'Success',label:'Done',description:'One happy bounce, then back to a calm smile.',hint:'Demo complete. No real event was created.'},
 {id:'error',title:'Connection error',label:'Try again',description:'A concerned tilt. A clear message. An easy retry.',hint:'Simulated connection failure. Nothing was added.'},
 {id:'pip',title:'Pip · Preview',label:'Preview only',description:'A second specialist, sharing the same motion language.',hint:'Pip is a visual preview; Tuck has the connected demo.'}
];
const $ = (q) => document.querySelector(q);
const player = $('#player');
let selected='idle', current='idle', timer, failNext=false, zoom=1, blinkTimer;
function head(){return '<div class="head"><img class="eyes-open" src="../docs/design/tuck-portrait.png" alt="Smiling plush mascot"><svg class="eyes-closed" viewBox="0 0 1000 1000" aria-hidden="true"><image href="../docs/design/tuck-face-plate.png" width="1000" height="1000"/><g fill="none" stroke="#291a14" stroke-width="9" stroke-linecap="round"><path d="M296 487 Q335 509 374 487 M626 487 Q665 509 704 487"/><path d="M439 548 C463 582 537 582 561 548"/></g></svg></div>';}
function watch(state){
 let content=head();
 if(state.id==='listening') content+='<div class="wave" aria-label="Simulated voice activity">'+Array.from({length:7},(_,i)=>`<i style="--i:${i}"></i>`).join('')+'</div>';
 if(state.id==='thinking') content+='<p>Finding a free slot…</p>';
 if(state.id==='speaking') content+='<p>You’re free at two.</p>';
 if(state.id==='approval') content='<h3>Add a walk?</h3><p class="detail">Tomorrow · 2:00–2:30</p><p>Personal calendar</p><p>30 minutes outdoors</p>';
 if(state.id==='executing') content+='<p class="detail">Adding your walk…</p>';
 if(state.id==='success') content+='<h3>You’re all set.</h3><p>Tomorrow · 2:00–2:30</p>';
 if(state.id==='error') content+='<h3>Couldn’t connect.</h3><p>Nothing was added.</p>';
 const action=state.id==='approval'?'<div class="approval-actions"><button class="watch-action" data-action="cancel">Cancel</button><button class="watch-action blue" data-action="advance">Add</button></div>':`<button class="watch-action ${state.id==='listening'?'blue':''}" data-action="advance" ${['executing','pip'].includes(state.id)?'disabled':''}>${state.label}</button>`;
 return `<div class="watch ${state.id}"><div class="watch-header"><b>${state.id==='pip'?'Pip':'Tuck'}</b><time>9:41</time></div><div class="watch-content">${content}</div>${action}<div class="dots" aria-hidden="true"><i></i><i></i></div></div>`;
}
$('#frames').innerHTML=states.map((s,i)=>`<article class="frame-card ${i===0?'selected':''}" data-state="${s.id}"><div class="frame-label" tabindex="0" role="button" aria-label="Select ${s.title}">${String(i+1).padStart(2,'0')} / ${s.title}<span>◇</span></div>${watch(s)}<p class="frame-description">${s.description}</p></article>`).join('');
$('#layers').innerHTML=states.map((s,i)=>`<button data-select="${s.id}" class="${i===0?'active':''}"><span>▧</span>${s.title}</button>`).join('');
function select(id){selected=id;const state=states.find(s=>s.id===id);$('#state-title').textContent=state.title;$('#state-description').textContent=state.description;document.querySelectorAll('.frame-card').forEach(n=>n.classList.toggle('selected',n.dataset.state===id));document.querySelectorAll('[data-select]').forEach(n=>n.classList.toggle('active',n.dataset.select===id));}
function show(id){clearTimeout(timer);current=id;const state=states.find(s=>s.id===id);$('#live-watch').innerHTML=watch(state);$('#live-caption').textContent=state.hint;const next={thinking:['speaking',1900],speaking:['approval',2400],executing:[failNext?'error':'success',1600]}[id];if(id==='executing'){failNext=false;updateFailureButton();}if(next)timer=setTimeout(()=>{if(player.open)show(next[0]);},next[1]);}
function open(id='idle'){if(!player.open)player.showModal();show(id);}
function updateFailureButton(){$('#fail-next').setAttribute('aria-pressed',String(failNext));$('#fail-next').textContent=failNext?'Failure armed':'Fail next action';}
function advance(action){if(action==='cancel'){show('idle');return;}const next={idle:'listening',listening:'thinking',thinking:'idle',speaking:'approval',approval:'executing',success:'idle',error:'thinking'}[current];if(next)show(next);}
$('#frames').addEventListener('click',e=>{const card=e.target.closest('[data-state]');if(!card)return;select(card.dataset.state);if(e.target.closest('button')){open(card.dataset.state);advance(e.target.closest('button').dataset.action);}});
$('#frames').addEventListener('keydown',e=>{if(e.target.classList.contains('frame-label')&&['Enter',' '].includes(e.key)){e.preventDefault();select(e.target.closest('[data-state]').dataset.state);}});
$('#layers').addEventListener('click',e=>{const b=e.target.closest('[data-select]');if(!b)return;select(b.dataset.select);document.querySelector(`[data-state="${selected}"]`).scrollIntoView({block:'nearest',inline:'nearest'});});
$('#live-watch').addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(b&&!b.disabled)advance(b.dataset.action);});
$('#present').onclick=()=>open(selected==='pip'?'idle':selected);
$('#close-player').onclick=()=>player.close();player.addEventListener('close',()=>{clearTimeout(timer);$('#live-watch').innerHTML='';});
$('#restart').onclick=()=>{failNext=false;updateFailureButton();show('idle');};
$('#fail-next').onclick=()=>{failNext=!failNext;updateFailureButton();};
$('#error-demo').onclick=()=>open('error');
$('#motion').onclick=()=>{const off=document.body.classList.toggle('motion-off');$('#motion').textContent=off?'◉ Motion off':'◉ Motion on';$('#motion').setAttribute('aria-pressed',String(!off));};
$('#intensity').oninput=e=>{document.documentElement.style.setProperty('--motion',e.target.value);$('#intensity-value').textContent=e.target.value<.8?'Subtle':e.target.value>1.2?'Expressive':'Natural';};
$('#blink').onclick=()=>{window.location.href='animation/';};
function setZoom(value){zoom=Math.max(.5,Math.min(1.5,value));$('#canvas').style.zoom=zoom;$('#zoom-value').textContent=Math.round(zoom*100)+'%';}
$('#zoom-in').onclick=()=>setZoom(zoom+.1);$('#zoom-out').onclick=()=>setZoom(zoom-.1);$('#zoom-reset').onclick=()=>setZoom(1);
select('idle');
document.addEventListener('visibilitychange',()=>document.body.classList.toggle('tab-hidden',document.hidden));
