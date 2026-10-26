import {summarizeLog} from './log-summary.mjs';
import {VoiceRecorder} from './audio.mjs';
const $=selector=>document.querySelector(selector),watch=$('#watch');
let sessionId=sessionStorage.getItem('muse-session'),pending=null,busy=false,recording=false,recordingPending=false,connected=false,lastRequest=null,lastReply='',speechVersion=0,idleTimer,pollTimer,polling=false,recordVersion=0;
let currentView={type:'muse-state',state:'sleep',text:'tap on me to wake up'};
function send(message){watch.contentWindow?.postMessage(message,location.origin);}
function face(state,text){if(currentView.state!==state||currentView.text!==text)log(`${state} · ${text||state}`);currentView={type:'muse-state',state,text};send(currentView);}
function log(text){apiLog('state','',text);}
function message(role,text){apiLog(role==='user'?'input':'reply','',text);}
function controls(){
 $('#send').disabled=busy||recording||recordingPending||!connected||!!(pending&&pending.status!=='pending');
 $('#reset').disabled=busy||recording||recordingPending;
 $('#confirm').disabled=busy||recording||recordingPending||!pending;
 $('#cancel').disabled=busy||recording||recordingPending||!pending||pending.status!=='pending';
 $('#stop').hidden=!recording&&!recordingPending;
 $('#stop').textContent=recordingPending?'cancel microphone request':'finish talking';
 $('#connect-calendar').disabled=busy||recording||recordingPending;
}
function apiLog(kind,path,data,failed=false){
 const list=$('#api-log'),row=document.createElement('li'),details=document.createElement('details'),heading=document.createElement('summary');
 row.className='log-row'+(failed?' failed':'');heading.className='log-heading';
 const badge=document.createElement('span');badge.className='call-kind';badge.textContent=kind;
 const route=document.createElement('span');route.className='call-route';route.textContent=summarizeLog(kind,path,data);route.title=route.textContent;
 const time=document.createElement('time');time.className='call-time';time.textContent=new Date().toLocaleTimeString();
 heading.append(time,badge,route);details.append(heading);row.append(details);
 if(data!==undefined||path){const pre=document.createElement('pre');pre.textContent=typeof data==='string'?data:JSON.stringify({endpoint:path,...(data===undefined?{}:{details:data})},(key,value)=>/token|secret|authorization|url/i.test(key)?'[redacted]':value,2);details.append(pre);}
 const atBottom=list.parentElement.scrollHeight-list.parentElement.scrollTop-list.parentElement.clientHeight<60;
 list.append(row);while(list.children.length>200)list.firstChild.remove();
 if(atBottom)row.scrollIntoView({block:'nearest'});
}
async function api(path,{method='GET',body,requestId}={}){
 const started=performance.now();apiLog('request',`${method} ${path}`,body instanceof Blob?{type:body.type,bytes:body.size,requestId}:body);
 const headers={'X-Muse-Emulator':'1'};
 if(body instanceof Blob)headers['Content-Type']='audio/wav';else if(body!==undefined)headers['Content-Type']='application/json';
 if(requestId)headers['Idempotency-Key']=requestId;
 let response;try{response=await fetch('/api'+path,{method,headers,body:body===undefined?undefined:body instanceof Blob?body:JSON.stringify(body),signal:AbortSignal.timeout(95000)});}catch{apiLog('failed',path,{message:'connection lost'},true);throw new Error('Connection lost. Retry the same request when the backend is available.');}
 if(response.status===204){apiLog('response',path,{status:204,ms:Math.round(performance.now()-started)});return null;}
 const result=await response.json();apiLog('response',path,{status:response.status,ms:Math.round(performance.now()-started),body:result},!response.ok);if(!response.ok){const error=new Error(result.error?.message||'Request failed');error.code=result.error?.code;error.status=response.status;throw error;}return result;
}
function stopSpeech(){speechVersion++;clearTimeout(idleTimer);window.speechSynthesis?.cancel();}
function rest(result){
 if(pending){face('approval','review event · tap to hear');return;}
 if(result?.state==='happy'){face('happy',result.statusText);idleTimer=setTimeout(()=>face('idle','tap to talk'),2400);}
 else if(result?.state==='clarify'){face('clarify','tap to answer');}
 else face('idle','tap to talk');
}
function speak(text,result){
 stopSpeech();lastReply=text;$('#replay').hidden=!text;
 if(!$('#spoken').checked||!window.speechSynthesis){rest(result);return;}
 const version=speechVersion,utterance=new SpeechSynthesisUtterance(text);utterance.rate=.96;utterance.pitch=1.16;
 const selected=speechSynthesis.getVoices().find(v=>v.voiceURI===$('#voice-choice').value);if(selected)utterance.voice=selected;
 const fallback=setTimeout(()=>{if(version!==speechVersion)return;stopSpeech();rest(result);$('#hint').textContent='Reply is ready. Tap “hear reply again” if speech was blocked.';},Math.max(12000,text.length*130));
 utterance.onstart=()=>{if(version===speechVersion){face('speak','speaking…');$('#hint').textContent='Tap Jolly to interrupt and talk.';}};
 const finish=()=>{clearTimeout(fallback);if(version===speechVersion){rest(result);$('#hint').textContent=pending?'Review the exact event, then choose add or cancel.':'Tap Jolly to talk again.';}};
 utterance.onend=finish;utterance.onerror=()=>{finish();if(version===speechVersion)$('#hint').textContent='Browser speech unavailable. Read the reply or try replay.';};
 speechSynthesis.speak(utterance);
}
function actionView(action){
 pending=action&&['pending','uncertain','executing'].includes(action.status)?action:null;
 $('#approval').hidden=!pending;
 if(pending){let row=$('#approval-log-row');if(!row){row=document.createElement('li');row.id='approval-log-row';row.className='log-row';$('#api-log').append(row);}row.append($('#approval'));}
 if(!pending){sessionStorage.removeItem('muse-action');controls();return;}
 sessionStorage.setItem('muse-action',pending.id);
 $('#event-title').textContent=pending.event.title;
 const fmt=new Intl.DateTimeFormat(undefined,{timeZone:pending.event.timeZone,dateStyle:'full',timeStyle:'short'});
 $('#event-time').textContent=`${fmt.format(new Date(pending.event.start))} → ${fmt.format(new Date(pending.event.end))} (${pending.event.timeZone})`;
 $('#action-note').textContent=pending.status==='pending'?'Nothing has been saved. Confirm this exact event to create it.':'The last save is unverified. Retry to check the same event; do not create a new proposal.';
 $('#confirm').textContent=pending.status==='pending'?'add to Calendar':'verify / retry save';controls();
}
function displayData(data){
 if(Array.isArray(data)){for(const event of data.slice(0,12))message('assistant',`${event.title}\n${event.start} → ${event.end}`);if(data.length>12)message('assistant',`${data.length-12} more events; ask for a shorter date range.`);}
 else if(data?.busy){for(const interval of data.busy.slice(0,12))message('assistant',`busy: ${interval.start} → ${interval.end}`);}
}
async function renderResult(result){
 if(result.action){const authoritative=await api(`/v1/sessions/${sessionId}/actions/${result.action.id}`);actionView(authoritative.action);}else actionView(null);
 message('assistant',result.speechText);displayData(result.data);
 if(result.simulated)$('#mode-note').textContent='SIMULATION MODE: this backend is not using real Meta or Calendar.';
 face(result.state,result.statusText);speak(result.speechText,result);
}
function errorView(error){apiLog('error','',error.message,true);$('#error').textContent=error.message;face(error.code==='calendar_disconnected'?'permission':'error',error.code==='calendar_disconnected'?'connect Calendar':'something went wrong');$('#hint').textContent=error.message;log(`error: ${error.code||'connection'}`);}
async function status(){const result=await api('/v1/status');connected=true;$('#connection').textContent=result.mode==='live'?'● live Meta backend':'● simulation backend';$('#mode-note').textContent=result.mode==='live'?'Real Meta requests use your API credits. No service key is exposed to this page.':'SIMULATION MODE — fixed replies and simulated Calendar.';$('#calendar-status').textContent=`Google Calendar: ${result.calendar}`;controls();return result;}
async function session(){if(!sessionId){const created=await api('/v1/sessions',{method:'POST',body:{timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone||'Europe/London'}});sessionId=created.id;sessionStorage.setItem('muse-session',sessionId);}return sessionId;}
async function poll(since){
 if(!polling||!sessionId)return;
 try{const {events}=await api(`/v1/sessions/${sessionId}/events`);const latest=events.filter(event=>Date.parse(event.at)>=since).at(-1);if(polling&&latest&&['transcribe','think','search','working'].includes(latest.state)){face(latest.state,latest.statusText);}}catch{/* Main request reports failures; polling is only presentation. */}
 if(polling)pollTimer=setTimeout(()=>poll(since),1400);
}
async function submit(request){
 if(busy)return;stopSpeech();busy=true;controls();$('#error').textContent='';$('#retry').hidden=true;lastRequest=request;
 face(request.audio?'transcribe':'think',request.audio?'hearing your words…':'thinking…');$('#hint').textContent='Working with Meta…';const since=Date.now();
 try{
  await session();polling=true;pollTimer=setTimeout(()=>poll(since),900);
  const result=await api(`/v1/sessions/${sessionId}/${request.audio?'audio':'turns'}`,{method:'POST',body:request.audio||{text:request.text,requestId:request.id},requestId:request.audio?request.id:undefined});
  polling=false;clearTimeout(pollTimer);await renderResult(result);lastRequest=null;
 }catch(error){polling=false;busy=false;clearTimeout(pollTimer);errorView(error);$('#retry').hidden=false;}
 finally{busy=false;controls();}
}
const recorder=new VoiceRecorder(level=>send({type:'muse-level',level}),()=>finishRecording(),text=>{recordVersion++;recording=recordingPending=false;controls();errorView(new Error(text));});
async function startRecording(){
 if(busy||recording||recordingPending)return;
 if(!connected){try{await status();await session();}catch(error){errorView(error);return;}}
 stopSpeech();$('#error').textContent='';recordingPending=true;controls();face('listen','allow microphone…');const version=++recordVersion;
 try{const started=await recorder.start();if(version!==recordVersion||!started)return;recordingPending=false;recording=true;face('listen','listening…');$('#hint').textContent='Listening. Tap Jolly again to send (60-second maximum).';log('recording started');}
 catch(error){if(version!==recordVersion)return;recordingPending=false;errorView(new Error(error.name==='NotAllowedError'?'Microphone permission denied. Allow it in browser settings, or type below.':error.message));}
 finally{controls();}
}
async function finishRecording(){
 if(recordingPending){recordVersion++;recorder.cancel();recordingPending=false;face('idle','tap to talk');controls();return;}
 if(!recording)return;
 recording=false;busy=true;controls();
 try{const audio=await recorder.finish();busy=false;message('user','[voice message]');await submit({audio,id:crypto.randomUUID()});}
 catch(error){busy=false;errorView(error);controls();}
}
async function tap(){if(busy)return;if(recording||recordingPending){await finishRecording();return;}if(pending&&(currentView.state==='approval'||pending.status!=='pending')){speak(`${pending.event.title}, from ${pending.event.start} until ${pending.event.end}, ${pending.event.timeZone}. Review the event beside the watch to approve.`,{state:'approval'});return;}await startRecording();}
window.addEventListener('message',event=>{if(event.source!==watch.contentWindow||event.origin!==location.origin)return;if(event.data?.type==='muse-ready')send(currentView);if(event.data?.type==='muse-tap')void tap();});
$('#stop').onclick=finishRecording;
$('#text-form').onsubmit=event=>{event.preventDefault();const text=$('#text').value.trim();if(!text||busy||recording||recordingPending||(pending&&pending.status!=='pending'))return;$('#text').value='';message('user',text);void submit({text,id:crypto.randomUUID()});};
$('#retry').onclick=()=>{if(lastRequest)void submit(lastRequest);};
$('#replay').onclick=()=>{if(!busy&&!recording&&!recordingPending)speak(lastReply,{state:pending?'approval':'idle'});};
async function decision(value){
 if(!pending||busy||recording||recordingPending)return;stopSpeech();busy=true;controls();$('#error').textContent='';face('working',value==='confirm'?'saving your event…':'cancelling…');
 try{const result=await api(`/v1/sessions/${sessionId}/actions/${pending.id}/decision`,{method:'POST',body:{decision:value}});await renderResult(result);}
 catch(error){try{actionView((await api(`/v1/sessions/${sessionId}/actions/${pending.id}`)).action);}catch{}errorView(error);}
 finally{busy=false;controls();}
}
$('#confirm').onclick=()=>decision('confirm');$('#cancel').onclick=()=>decision('cancel');
$('#reset').onclick=async()=>{if(busy||recording||recordingPending)return;stopSpeech();busy=true;controls();try{if(sessionId)await api(`/v1/sessions/${sessionId}`,{method:'DELETE'});sessionId=null;sessionStorage.removeItem('muse-session');actionView(null);lastRequest=null;$('#retry').hidden=true;$('#replay').hidden=true;$('#conversation').replaceChildren();$('#error').textContent='';await session();face('sleep','tap on me to wake up');$('#hint').textContent='A fresh conversation. Tap Jolly to start.';}catch(error){errorView(error);}finally{busy=false;controls();}};
$('#connect-calendar').onclick=async()=>{try{const {url}=await api('/v1/integrations/google/connect',{method:'POST',body:{}});const parsed=new URL(url);if(parsed.origin!=='https://accounts.google.com')throw new Error('Unexpected consent destination');$('#consent').href=url;$('#consent').hidden=false;$('#error').textContent='';}catch(error){errorView(error);}};
window.addEventListener('focus',()=>{void status().catch(()=>{});});
function voices(){
 const selected=$('#voice-choice').value;
 const available=window.speechSynthesis?.getVoices()||[];
 const preferred=available.find(v=>v.name==='Samantha'&&v.lang.startsWith('en'))||available.find(v=>v.name==='Karen'&&v.lang.startsWith('en'))||available.find(v=>v.lang==='en-US')||available.find(v=>v.lang.startsWith('en'));
 $('#voice-choice').replaceChildren(new Option('system default',''));
 for(const voice of available)$('#voice-choice').add(new Option(`${voice.name} · ${voice.lang}`,voice.voiceURI));
 $('#voice-choice').value=available.some(v=>v.voiceURI===selected)?selected:preferred?.voiceURI||'';
}

voices();window.speechSynthesis?.addEventListener('voiceschanged',voices);
$('#spoken').onchange=()=>{if(!$('#spoken').checked){stopSpeech();rest();}};
function discardRecording(){if(recording||recordingPending){recordVersion++;recorder.cancel();recording=recordingPending=false;face('idle','recording discarded');$('#hint').textContent='Recording stopped because the page was hidden. Nothing was sent.';controls();}stopSpeech();if(currentView.state==='speak')rest();}
document.addEventListener('visibilitychange',()=>{if(document.hidden)discardRecording();});window.addEventListener('pagehide',discardRecording);
try{
 await status();
 if(sessionId){try{await api(`/v1/sessions/${sessionId}/events`);}catch(error){if(error.status!==404)throw error;sessionId=null;sessionStorage.removeItem('muse-session');sessionStorage.removeItem('muse-action');}}
 await session();const actionId=sessionStorage.getItem('muse-action');if(actionId){try{actionView((await api(`/v1/sessions/${sessionId}/actions/${actionId}`)).action);if(pending)face('approval','review pending event');}catch{sessionStorage.removeItem('muse-action');}}
 $('#hint').textContent=pending?'A previous proposal is ready for review.':'Tap Jolly to start a real conversation.';log('backend connected');
}catch(error){connected=false;$('#connection').textContent='○ backend unavailable';errorView(error);controls();}
