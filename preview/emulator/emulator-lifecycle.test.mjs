import {taskGroups,taskLabel,installTaskSwipe} from './tasks.mjs';
import {reactionFor,reactionPresentation} from './reactions.mjs';
import {localIntent} from './local-intents.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {TurnCoordinator} from './turn-coordinator.mjs';
import {EndOfSpeech} from './end-of-speech.mjs';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function harness(callHandler,viewerTimeZone){
 const storage=new Map([['muse-session','session']]);
 const elements=new Map(),listeners={},played=[],states=[],timers=new Set();
 function element(){const classes=new Set();return {children:[],parentElement:{scrollHeight:0,scrollTop:0,clientHeight:100},classList:{toggle(name,enabled){if(enabled)classes.add(name);else classes.delete(name);},contains(name){return classes.has(name);}},checked:true,value:'',textContent:'',hidden:false,style:{},dataset:{},setAttribute(name,value){this[name]=value;},addEventListener(){},append(...items){for(const item of items){item.remove?.();item.parentElement=this;this.children.push(item);}},remove(){const siblings=this.parentElement?.children;if(siblings){const index=siblings.indexOf(this);if(index>=0)siblings.splice(index,1);}},replaceChildren(...items){this.children=items;},scrollIntoView(){},add(){},focus(){},contentWindow:{postMessage(state){states.push(state);}}};}
 const document={hidden:false,querySelector(selector){if(!elements.has(selector))elements.set(selector,element());return elements.get(selector);},createElement:element,addEventListener(name,fn){listeners[name]=fn;}};
 let inFlight, microphone, playbackEnd, now=0;
 class Player{stop(){this.current=null;} async play(text,callbacks){this.current={};playbackEnd=()=>{this.current=null;callbacks.onEnd();};played.push(text);callbacks.onReady(10);callbacks.onStart();}}
 class Recorder{constructor(onLevel){microphone=onLevel;}cancel(){} async start(){return true;}}
 class Transcriber{cancel(){}}
 const ctx={taskGroups,taskLabel,installTaskSwipe,reactionFor,reactionPresentation,localIntent,streamReply:async(id,request,{signal})=>{const r=await ctx.fetch(`/api/v1/sessions/${id}/turns`,{signal});return r.json();},SentenceSpeaker:class{},document,window:{addEventListener(){},speechSynthesis:{cancel(){},getVoices(){return [];},addEventListener(){}}},location:{origin:'http://localhost'},sessionStorage:{getItem(key){return storage.get(key)||null;},setItem(key,value){storage.set(key,value);},removeItem(key){storage.delete(key);}},setupServices:()=>({setBusy(){},update(){}}),summarizeLog:()=>'',SpeechPlayer:Player,VoiceRecorder:Recorder,RealtimeTranscriber:Transcriber,EndOfSpeech,TurnCoordinator,Option:class{},Blob,AbortSignal,AbortController,URL,performance:{now:()=>now},Intl:viewerTimeZone?{DateTimeFormat:class extends Intl.DateTimeFormat{constructor(locale,options={}){super(locale,{timeZone:viewerTimeZone,...options});}}}:Intl,Date,crypto:globalThis.crypto,setTimeout(fn,ms){const id=setTimeout(fn,ms);timers.add(id);return id;},clearTimeout(id){clearTimeout(id);timers.delete(id);},fetch:async (url,options)=>{
  if((url.includes('/calls/')||url.endsWith('/calls')||options?.method==='DELETE'||url.endsWith('/sessions'))&&callHandler)return callHandler(url,options);
  if(url.endsWith('/cancel'))return new Response('{"cancelled":true}');
  if(url.endsWith('/status'))return new Response(JSON.stringify({mode:'live',speechOutput:'elevenlabs',calendar:'disconnected'}));
  if(url.endsWith('/turns'))return inFlight.promise;
  throw new Error('Unexpected test endpoint '+url);
 }};
 const source=(await readFile(new URL('./emulator.mjs',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').split('try{\n await status();')[0];
 const app=await vm.runInNewContext('(async()=>{'+source+';await status();return {submit,tap,discardRecording,actionView,callCommand,apiLog,startRecording,restoreSavedAction,announceCall,flushCompletion,taskCalls,renderTasks,showTaskPage,refreshTasks,taskPage:()=>taskPage,background:()=>backgroundCall,pending:()=>pending,view:()=>currentView,busy:()=>busy,recording:()=>recording};})()',ctx);
 return {app,document,storage,played,states,finishSpeech(){playbackEnd();},sample(level,at){now=at;microphone(level);},setRequest(){inFlight=deferred();return inFlight;},cleanup(){for(const id of timers)clearTimeout(id);}};
}
const reply=text=>new Response(JSON.stringify({state:'speak',speechText:text}));
test('tap during thinking immediately listens and late reply cannot change the face or speak',async t=>{
 const h=await harness();t.after(h.cleanup);const request=h.setRequest();
 const task=h.app.submit({text:'old question',id:'old'});await new Promise(r=>setImmediate(r));
 await h.app.tap();assert.equal(h.app.recording(),true);assert.equal(h.app.view().state,'listen');
 request.resolve(reply('stale answer'));await task;
 assert.equal(h.app.view().state,'listen');assert.deepEqual(h.played,[]);assert.equal(h.app.busy(),false);
});
test('backgrounding suppresses a pending response and restores a usable idle state',async t=>{
 const h=await harness();t.after(h.cleanup);const request=h.setRequest();const task=h.app.submit({text:'hello',id:'one'});await new Promise(r=>setImmediate(r));
 h.document.hidden=true;h.app.discardRecording();request.resolve(reply('must not play'));await task;
 assert.deepEqual(h.played,[]);assert.equal(h.app.view().state,'idle');assert.equal(h.app.busy(),false);
});
test('normal reply plays and a tap interrupts playback to start listening',async t=>{
 const h=await harness();t.after(h.cleanup);const request=h.setRequest();const task=h.app.submit({text:'hello',id:'one'});request.resolve(reply('hello there'));await task;
 assert.deepEqual(h.played,['hello there']);assert.equal(h.app.view().state,'speak');await h.app.tap();assert.equal(h.app.view().state,'listen');assert.equal(h.app.recording(),true);
});

test('silence closes the microphone locally without sending an agent request',async t=>{
 const h=await harness();t.after(h.cleanup);await h.app.tap();assert.equal(h.app.recording(),true);
 h.sample(0,0);h.sample(0,8000);assert.equal(h.app.recording(),false);assert.equal(h.app.busy(),false);
 assert.equal(h.app.view().text,'didn’t hear you · tap to try');assert.deepEqual(h.played,[]);
});

test('affection shows hearts before speech, keeps them during speech, then returns to idle',async t=>{
 const h=await harness();t.after(h.cleanup);const request=h.setRequest();const task=h.app.submit({text:"Hey, Jolly, I really love you.",id:'compliment'});assert.equal(h.app.view().state,'loved');assert.equal(h.app.view().hearts,true);
 request.resolve(reply('aww, thank you!'));await task;
 assert.equal(h.app.view().state,'speak');assert.equal(h.app.view().hearts,true);
 h.finishSpeech();assert.equal(h.app.view().state,'idle');assert.equal(h.app.view().hearts,false);
 await h.app.tap();assert.equal(h.app.view().state,'listen');
});

const callFixture={id:'call-1',sessionId:'session',status:'pending',calendarChecked:false,booking:{destinationName:'Salon',phoneNumber:'+442012345678',purpose:'Haircut',customerName:'Alex',timeZone:'Europe/London',window:{start:'2026-11-01T10:00:00Z',end:'2026-11-01T12:00:00Z'},durationMinutes:30}};
test('call review requires approval and failed confirmation never permits automatic redial',async t=>{
 let confirmations=0,reads=0;
 const h=await harness(async(url,options)=>{
  if(url.endsWith('/decision')){confirmations++;throw new Error('lost response');}
  reads++;return new Response(JSON.stringify({callAction:{...callFixture,status:'uncertain'}}));
 });t.after(h.cleanup);
 h.app.actionView(callFixture);
 assert.equal(confirmations,0);
 assert.match(h.document.querySelector('#event-time').textContent,/Calendar has not been checked/);
 await h.app.callCommand('confirm');
 assert.equal(confirmations,1);assert.equal(reads,1);assert.equal(h.app.background().status,'uncertain');
 await h.app.callCommand('confirm');assert.equal(confirmations,1);h.app.actionView(h.app.background(),true);
 assert.equal(h.document.querySelector('#confirm').hidden,true);
 assert.equal(h.document.querySelector('#dismiss-document').hidden,false);
});
test('only a booked terminal call offers a separate Calendar proposal',async t=>{
 const h=await harness();t.after(h.cleanup);
 h.app.actionView({...callFixture,status:'completed',outcome:'not_booked'},true);
 assert.equal(h.document.querySelector('#call-calendar').hidden,true);
 h.app.actionView({...callFixture,status:'completed',outcome:'booked'},true);
 assert.equal(h.document.querySelector('#call-calendar').hidden,false);
 assert.equal(h.document.querySelector('#confirm').hidden,true);
});

test('active call approval survives more than 200 progress log entries',async t=>{
 const h=await harness();t.after(h.cleanup);
 const list=h.document.querySelector('#api-log'),pinned=h.document.querySelector('#approval-log-row');
 pinned.id='approval-log-row';list.append(pinned);
 h.app.actionView({...callFixture,status:'in_progress'},true);
 for(let i=0;i<250;i++)h.app.apiLog('response','/v1/sessions/session/calls/call-1',{status:200});
 assert.equal(list.children.length,200);
 assert.ok(list.children.includes(pinned));
 assert.ok(pinned.children.includes(h.document.querySelector('#approval')));
 assert.equal(h.document.querySelector('#stop-call').hidden,false);
 h.app.actionView({...callFixture,status:'completed',outcome:'booked'},true);
 assert.equal(h.document.querySelector('#call-calendar').hidden,false);
});
test('active calls allow speech and normal replies retain background tracking',async t=>{
 const h=await harness();t.after(h.cleanup);
 h.app.actionView({...callFixture,status:'in_progress'});
 assert.equal(h.app.pending(),null);
 await h.app.tap();assert.equal(h.app.recording(),true);
 h.app.discardRecording();
 const request=h.setRequest();const task=h.app.submit({text:'another question',id:'chat'});
 request.resolve(reply('Here is your answer'));await task;
 assert.equal(h.app.background().id,'call-1');
 assert.equal(h.storage.get('muse-calls:http://localhost:session:active'),'call-1');
 assert.equal(h.app.view().state,'speak');
});
test('completion waits for speech then persists dedupe and can be dismissed',async t=>{
 const h=await harness();t.after(h.cleanup);
 const request=h.setRequest();const task=h.app.submit({text:'hello',id:'chat'});request.resolve(reply('Hello'));await task;
 h.app.announceCall({...callFixture,status:'completed',outcome:'booked'});
 assert.equal(h.app.view().state,'speak');
 h.finishSpeech();assert.equal(h.app.view().state,'happy');
 h.document.querySelector('#call-card-dismiss').onclick();assert.equal(h.app.view().state,'idle');
 h.app.announceCall({...callFixture,status:'completed',outcome:'booked'});assert.equal(h.app.view().state,'idle');
 assert.equal(h.storage.get('muse-calls:http://localhost:session:seen:call-1:completed:booked'),'1');
});
test('stop call leaves current voice playing',async t=>{
 const h=await harness(async()=>new Response(JSON.stringify({callAction:{...callFixture,status:'cancelled'}})));t.after(h.cleanup);
 h.app.actionView({...callFixture,status:'in_progress'});
 const request=h.setRequest();const task=h.app.submit({text:'hello',id:'chat'});request.resolve(reply('Still talking'));await task;
 await h.app.callCommand('stop');assert.equal(h.app.view().state,'speak');assert.equal(h.app.background().status,'cancelled');
});
test('tracked call restores independently of foreground proposal storage',async t=>{
 const h=await harness(async()=>new Response(JSON.stringify({callAction:{...callFixture,status:'in_progress'}})));t.after(h.cleanup);
 h.storage.set('muse-calls:http://localhost:session:active','call-1');
 await h.app.restoreSavedAction();assert.equal(h.app.background().id,'call-1');assert.equal(h.app.pending(),null);
 h.app.actionView(null);assert.equal(h.storage.get('muse-calls:http://localhost:session:active'),'call-1');
});

test('transient saved-call recovery failure preserves pointer and blocks replacement',async t=>{
 const h=await harness(async()=>{throw new Error('temporary outage');});t.after(h.cleanup);
 h.storage.set('muse-action','call-1');h.storage.set('muse-action-kind','calls');
 await assert.rejects(h.app.restoreSavedAction(),/Reload/);
 assert.equal(h.storage.get('muse-action'),'call-1');
 await h.app.tap();await h.app.startRecording();await h.app.submit({text:'new request',id:'new'});
 assert.equal(h.app.recording(),false);assert.equal(h.app.busy(),false);
 assert.equal(h.document.querySelector('#send').disabled,true);
});
test('uncertain call retains safe stop control',async t=>{
 const h=await harness();t.after(h.cleanup);
 h.app.actionView({...callFixture,status:'uncertain'},true);
 assert.equal(h.document.querySelector('#stop-call').hidden,false);
 assert.equal(h.document.querySelector('#stop-call').textContent,'try stopping call');
 assert.equal(h.document.querySelector('#confirm').hidden,true);
});
test('terminal booked update celebrates once and never announces on restoration alone',async t=>{
 const h=await harness();t.after(h.cleanup);
 const call={...callFixture,status:'completed',outcome:'booked'};
 h.app.actionView(call);assert.notEqual(h.app.view().state,'happy');
 h.app.announceCall(call);assert.equal(h.app.view().state,'happy');
 const count=h.states.length;h.app.announceCall(call);assert.equal(h.states.length,count);
});

 test('flexible call review shows each allowed window instead of a continuous envelope',async t=>{
 const h=await harness();t.after(h.cleanup);
 const windows=[{start:'2026-11-02T14:00:00Z',end:'2026-11-02T16:00:00Z'},{start:'2026-11-04T14:00:00Z',end:'2026-11-04T16:00:00Z'}];
 h.app.actionView({...callFixture,booking:{...callFixture.booking,window:{start:windows[0].start,end:windows[1].end},windows}});
 const text=h.document.querySelector('#event-time').textContent;
 const fmt=new Intl.DateTimeFormat(undefined,{timeZone:'Europe/London',dateStyle:'medium',timeStyle:'short'});
 for(const window of windows) assert.ok(text.includes(`${fmt.format(new Date(window.start))} → ${fmt.format(new Date(window.end))}`));
 assert.equal(h.document.querySelector('#confirm').hidden,false);
});

test('completion waits through recording and foreground approval',async t=>{
 const h=await harness();t.after(h.cleanup);
 await h.app.startRecording();
 h.app.announceCall({...callFixture,status:'completed',outcome:'not_booked'});
 assert.equal(h.app.view().state,'listen');
 h.app.actionView(callFixture);
 h.app.discardRecording();assert.equal(h.app.view().state,'approval');
 h.app.actionView(null);assert.equal(h.document.querySelector('#call-card').hidden,false);
 assert.equal(h.document.querySelector('#call-card-title').textContent,'call finished');
 assert.equal(h.document.querySelector('#call-card').classList.contains('is-confirmed'),false);
 assert.equal(h.document.querySelector('#call-card-review').textContent,'review call');
 assert.doesNotMatch(h.document.querySelector('#call-card-detail').textContent,/Booking confirmed/);
});
test('persisted completion marker prevents replay after restoration',async t=>{
 const h=await harness(async()=>new Response(JSON.stringify({callAction:{...callFixture,status:'completed',outcome:'booked'}})));t.after(h.cleanup);
 h.storage.set('muse-calls:http://localhost:session:active','call-1');
 h.storage.set('muse-calls:http://localhost:session:seen:call-1:completed:booked','1');
 await h.app.restoreSavedAction();assert.notEqual(h.app.view().state,'happy');assert.equal(h.app.background().outcome,'booked');
});

 test('reviewing a background call retains the foreground Calendar proposal',async t=>{
 const h=await harness();t.after(h.cleanup);
 h.app.actionView({...callFixture,status:'in_progress'});
 const proposal={id:'calendar-1',status:'pending',event:{title:'Lunch',start:'2026-11-01T10:00:00Z',end:'2026-11-01T11:00:00Z',timeZone:'Europe/London'}};
 h.app.actionView(proposal);
 h.document.querySelector('#call-indicator').onclick();
 assert.equal(h.storage.get('muse-action'),'calendar-1');
 h.app.actionView(null);assert.equal(h.app.pending().id,'calendar-1');
 assert.equal(h.document.querySelector('#confirm').textContent,'add to Calendar');
});

 test('failed session reset retains the tracked call and review control',async t=>{
 const h=await harness();t.after(h.cleanup);
 h.app.actionView({...callFixture,status:'uncertain'});
 await h.document.querySelector('#reset').onclick();
 assert.equal(h.app.background().id,'call-1');
 assert.equal(h.document.querySelector('#call-indicator').hidden,false);
 h.document.querySelector('#call-indicator').onclick();
 assert.equal(h.document.querySelector('#stop-call').hidden,false);
});

 test('completion card uses viewer local date and lowercase twelve-hour time without zone labels',async t=>{
 const h=await harness(undefined,'America/Los_Angeles');t.after(h.cleanup);
 const call={...callFixture,status:'completed',outcome:'booked',booking:{...callFixture.booking,timeZone:'Asia/Tokyo'},bookedSlot:{start:'2026-11-06T23:30:00Z',end:'2026-11-07T00:00:00Z'}};
 h.app.announceCall(call);
 assert.equal(h.document.querySelector('#call-card-title').textContent,'booking confirmed');
 assert.equal(h.document.querySelector('#call-card-date').textContent,'Fri, 6 Nov · 3:30 pm');
 assert.equal(h.document.querySelector('#call-card-detail').textContent,'Haircut');
 assert.equal(h.document.querySelector('#call-card-business').textContent,'Salon');
 assert.equal(h.document.querySelector('#call-card').classList.contains('is-confirmed'),true);
 assert.doesNotMatch(h.document.querySelector('#call-card-detail').textContent,/Alex|Tokyo|Los_Angeles/);
 h.app.actionView(call,true);assert.match(h.document.querySelector('#event-time').textContent,/Asia\/Tokyo/);
});

 test('completion replaces the head until dismissed or conversation resumes',async t=>{
 const h=await harness();t.after(h.cleanup);
 const shell=h.document.querySelector('.watch-shell');
 h.app.announceCall({...callFixture,status:'completed',outcome:'booked'});
 assert.equal(shell.classList.contains('has-call-card'),true);
 h.document.querySelector('#call-card-dismiss').onclick();
 assert.equal(shell.classList.contains('has-call-card'),false);
 h.app.announceCall({...callFixture,id:'call-2',status:'completed',outcome:'booked'});
 assert.equal(shell.classList.contains('has-call-card'),true);
 await h.app.startRecording();
 assert.equal(shell.classList.contains('has-call-card'),false);
 assert.equal(h.document.querySelector('#call-card').hidden,true);
});

test('task paging preserves speech and task review retains the active call',async t=>{
 const h=await harness();t.after(h.cleanup);
 h.app.actionView({...callFixture,id:'ongoing',status:'in_progress'});
 const request=h.setRequest();const task=h.app.submit({text:'chat',id:'chat'});request.resolve(reply('Still speaking'));await task;
 h.app.showTaskPage('tasks');assert.equal(h.app.view().state,'speak');assert.equal(h.app.taskPage(),'tasks');
 h.app.actionView({...callFixture,id:'older',status:'completed',outcome:'booked',finishedAt:Date.now()},true);
 assert.equal(h.app.background().id,'ongoing');assert.equal(h.app.pending().id,'older');
 assert.equal(h.app.taskCalls.size,2);assert.equal(h.document.querySelector('#confirm').hidden,true);
 h.app.showTaskPage('jolly');assert.equal(h.app.view().state,'speak');
});
test('reviewing an older call preserves a pending call approval',async t=>{
 const h=await harness();t.after(h.cleanup);
 h.app.actionView(callFixture);
 h.app.actionView({...callFixture,id:'older',status:'completed',finishedAt:Date.now()},true);
 assert.equal(h.storage.get('muse-action'),'call-1');
 h.app.actionView(null);assert.equal(h.app.pending().id,'call-1');assert.equal(h.document.querySelector('#confirm').hidden,false);
});
test('task list keeps every session call and ignores foreign session records',async t=>{
 const calls=[{...callFixture,status:'in_progress'},{...callFixture,id:'done',status:'completed',finishedAt:Date.now()},{...callFixture,id:'foreign',sessionId:'other'}];
 const h=await harness(async()=>new Response(JSON.stringify({calls})));t.after(h.cleanup);
 await h.app.refreshTasks();assert.equal(h.app.taskCalls.size,2);
 assert.equal(h.app.view().state,'sleep');assert.deepEqual(h.played,[]);
});
test('an older collection response cannot overwrite a fresher task status',async t=>{
 const stale=deferred();let reads=0;
 const h=await harness(async()=>++reads===1?stale.promise:new Response(JSON.stringify({calls:[{...callFixture,status:'completed',finishedAt:Date.now()}]})));t.after(h.cleanup);
 const oldRead=h.app.refreshTasks();await h.app.refreshTasks();
 stale.resolve(new Response(JSON.stringify({calls:[{...callFixture,status:'in_progress'}]})));await oldRead;
 assert.equal(h.app.taskCalls.get(callFixture.id).status,'completed');
});
test('stopping a selected uncertain task targets that task and retains another ongoing call',async t=>{
 let stopped;
 const h=await harness(async url=>{stopped=url;return new Response(JSON.stringify({callAction:{...callFixture,id:'older',status:'stopped',finishedAt:Date.now()}}));});t.after(h.cleanup);
 h.app.actionView({...callFixture,id:'ongoing',status:'in_progress'});
 h.app.actionView({...callFixture,id:'older',status:'uncertain'},true);
 await h.app.callCommand('stop');
 assert.match(stopped,/\/calls\/older\/stop$/);assert.equal(h.app.background().id,'ongoing');
 assert.equal(h.app.taskCalls.get('older').status,'stopped');
});
test('successful session reset clears task history and rejects an old in-flight collection',async t=>{
 const stale=deferred();
 const h=await harness(async(url,options)=>url.endsWith('/calls')?stale.promise:new Response(JSON.stringify(options?.method==='DELETE'?{}:{id:'new-session'})));t.after(h.cleanup);
 h.app.actionView({...callFixture,status:'completed',finishedAt:Date.now()});
 const oldRead=h.app.refreshTasks();await h.document.querySelector('#reset').onclick();
 stale.resolve(new Response(JSON.stringify({calls:[{...callFixture,status:'in_progress'}]})));await oldRead;
 assert.equal(h.app.taskCalls.size,0);assert.equal(h.storage.get('muse-session'),'new-session');assert.equal(h.app.taskPage(),'jolly');
 assert.equal(h.document.querySelector('#tasks-empty').hidden,false);
});
