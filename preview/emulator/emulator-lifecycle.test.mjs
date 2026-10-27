import {reactionFor,reactionPresentation} from './reactions.mjs';
import {localIntent} from './local-intents.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {TurnCoordinator} from './turn-coordinator.mjs';
import {EndOfSpeech} from './end-of-speech.mjs';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function harness(){
 const elements=new Map(),listeners={},played=[],states=[],timers=new Set();
 function element(){return {children:[],parentElement:{scrollHeight:0,scrollTop:0,clientHeight:100},classList:{toggle(){}},checked:true,value:'',textContent:'',hidden:false,append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},scrollIntoView(){},add(){},focus(){},contentWindow:{postMessage(state){states.push(state);}}};}
 const document={hidden:false,querySelector(selector){if(!elements.has(selector))elements.set(selector,element());return elements.get(selector);},createElement:element,addEventListener(name,fn){listeners[name]=fn;}};
 let inFlight, microphone, playbackEnd, now=0;
 class Player{stop(){this.current=null;} async play(text,callbacks){this.current={};playbackEnd=callbacks.onEnd;played.push(text);callbacks.onReady(10);callbacks.onStart();}}
 class Recorder{constructor(onLevel){microphone=onLevel;}cancel(){} async start(){return true;}}
 class Transcriber{cancel(){}}
 const ctx={reactionFor,reactionPresentation,localIntent,streamReply:async(id,request,{signal})=>{const r=await ctx.fetch(`/api/v1/sessions/${id}/turns`,{signal});return r.json();},SentenceSpeaker:class{},document,window:{addEventListener(){},speechSynthesis:{cancel(){},getVoices(){return [];},addEventListener(){}}},location:{origin:'http://localhost'},sessionStorage:{getItem(){return 'session';},setItem(){},removeItem(){}},setupServices:()=>({setBusy(){},update(){}}),summarizeLog:()=>'',SpeechPlayer:Player,VoiceRecorder:Recorder,RealtimeTranscriber:Transcriber,EndOfSpeech,TurnCoordinator,Option:class{},Blob,AbortSignal,AbortController,URL,performance:{now:()=>now},Intl,Date,crypto:globalThis.crypto,setTimeout(fn,ms){const id=setTimeout(fn,ms);timers.add(id);return id;},clearTimeout(id){clearTimeout(id);timers.delete(id);},fetch:async url=>{
  if(url.endsWith('/cancel'))return new Response('{"cancelled":true}');
  if(url.endsWith('/status'))return new Response(JSON.stringify({mode:'live',speechOutput:'elevenlabs',calendar:'disconnected'}));
  if(url.endsWith('/turns'))return inFlight.promise;
  throw new Error('Unexpected test endpoint '+url);
 }};
 const source=(await readFile(new URL('./emulator.mjs',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').split('try{\n await status();')[0];
 const app=await vm.runInNewContext('(async()=>{'+source+';await status();return {submit,tap,discardRecording,view:()=>currentView,busy:()=>busy,recording:()=>recording};})()',ctx);
 return {app,document,played,states,finishSpeech(){playbackEnd();},sample(level,at){now=at;microphone(level);},setRequest(){inFlight=deferred();return inFlight;},cleanup(){for(const id of timers)clearTimeout(id);}};
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
