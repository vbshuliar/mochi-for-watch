import {setupServices} from './services.mjs';
import {EndOfSpeech} from './end-of-speech.mjs';
import {summarizeLog} from './log-summary.mjs';
import {VoiceRecorder} from './audio.mjs';
import {SpeechPlayer} from './speech.mjs';
import {RealtimeTranscriber} from './realtime.mjs';
const $=selector=>document.querySelector(selector),watch=$('#watch');
const speechPlayer=new SpeechPlayer();
let speechOutput=null;
let liveTranscript=null;
let sessionId=sessionStorage.getItem('muse-session'),pending=null,busy=false,recording=false,recordingPending=false,connected=false,lastRequest=null,lastReply='',speechVersion=0,idleTimer,pollTimer,polling=false,recordVersion=0;
const serviceViews=setupServices(enabled=>calendarOperation(async()=>{await api('/v1/integrations/google',{method:'PATCH',body:{enabled}});await status();log(`Calendar ${enabled?'enabled':'disabled'}`);}));
let calendarBusy=false;
let currentView={type:'muse-state',state:'sleep',text:'tap on me to wake up'};
function send(message){watch.contentWindow?.postMessage(message,location.origin);}
function face(state,text){if(['transcribe','think','search','working'].includes(state)){state='think';text='thinking…';}if(currentView.state!==state||currentView.text!==text)log(`${state} · ${text||state}`);currentView={type:'muse-state',state,text};send(currentView);}
function log(text){apiLog('state','',text);}
function message(role,text){apiLog(role==='user'?'input':'reply','',text);}
function controls(){
 serviceViews.setBusy(calendarBusy||busy||recording||recordingPending);
 $('#send').disabled=busy||recording||recordingPending||!connected||!!(pending&&pending.status!=='pending');
 $('#reset').disabled=busy||recording||recordingPending;
 $('#confirm').disabled=busy||recording||recordingPending||!pending;
 $('#cancel').disabled=busy||recording||recordingPending||!pending||pending.status!=='pending';
 $('#stop').hidden=!recording&&!recordingPending;
 $('#stop').textContent=recordingPending?'cancel microphone request':'finish talking';
 $('#connect-calendar').disabled=calendarBusy||busy||recording||recordingPending;
 $('#refresh-calendar').disabled=calendarBusy||busy||recording||recordingPending;
 $('#disconnect-calendar').disabled=calendarBusy||busy||recording||recordingPending;
 $('#edit-calendar').disabled=calendarBusy||busy||recording||recordingPending;
 $('#calendar-reconnect').disabled=calendarBusy||busy||recording||recordingPending;
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
function stopSpeech(){speechVersion++;clearTimeout(idleTimer);speechPlayer.stop();window.speechSynthesis?.cancel();}
window.addEventListener('pagehide',stopSpeech);
function rest(result){
 if(pending){face('approval','review event · tap to hear');return;}
 if(result?.state==='happy'){face('happy',result.statusText);idleTimer=setTimeout(()=>face('idle','tap to talk'),2400);}
 else if(result?.state==='clarify'){face('clarify','tap to answer');}
 else face('idle','tap to talk');
}
function speak(text,result){
 stopSpeech();lastReply=text;$('#replay').hidden=!text;
 if(!$('#spoken').checked){rest(result);return;}
 if(speechOutput!=='elevenlabs'){apiLog('error','/v1/speech','Jessica is unavailable · check ElevenLabs configuration',true);rest(result);return;}
 const version=speechVersion,started=performance.now();
 apiLog('request','POST /v1/speech',{text});
 face('think','getting my voice ready…');
 void speechPlayer.play(text,{
  onReady:bytes=>apiLog('response','/v1/speech',{status:200,ms:Math.round(performance.now()-started),message:`ElevenLabs audio ready · ${Math.round(performance.now()-started)} ms`,bytes}),
  onStart:()=>{if(version!==speechVersion)return;face('speak','speaking…');log(`ElevenLabs playback started · ${Math.round(performance.now()-started)} ms`);},
  onEnd:()=>{if(version===speechVersion){log('ElevenLabs playback finished');rest(result);}},
  onError:error=>{if(version!==speechVersion)return;apiLog('error','/v1/speech',`Jessica could not play · ${error.message}`,true);rest(result);$('#hint').textContent='Jessica could not play. Tap to try again.';},
 });
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
 // Keep thinking until audio actually starts; do not flash the result pose first.
 speak(result.speechText,result);
}
function errorView(error){apiLog('error','',error.message,true);$('#error').textContent=error.message;face(error.code==='calendar_disconnected'?'permission':'error',error.code==='calendar_disconnected'?'connect Calendar':'something went wrong');$('#hint').textContent=error.message;log(`error: ${error.code||'connection'}`);}
async function status(){const result=await api('/v1/status');speechOutput=result.speechOutput;connected=true;$('#connection').textContent=result.mode==='live'?'● live Meta backend':'● simulation backend';$('#mode-note').textContent=result.mode==='live'?'Real Meta requests use your API credits. No service key is exposed to this page.':'SIMULATION MODE — fixed replies and simulated Calendar.';const linked=result.calendar==='connected';
 $('#calendar-status').textContent=result.mode==='mock'?'simulated connection':linked?(result.calendarEnabled===false?'connected · disabled':'connected'):'not connected';
 $('#calendar-dot').classList.toggle('connected',linked);
 $('#connect-calendar').textContent=linked?'reconnect':'connect';
 $('#disconnect-calendar').hidden=!linked;
 if(linked)$('#consent').hidden=true;serviceViews.update(result.calendar,result.mode,result.calendarEnabled!==false);controls();return result;}
async function session(){if(!sessionId){const created=await api('/v1/sessions',{method:'POST',body:{timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone||'Europe/London'}});sessionId=created.id;sessionStorage.setItem('muse-session',sessionId);}return sessionId;}
async function poll(since){
 if(!polling||!sessionId)return;
 try{const {events}=await api(`/v1/sessions/${sessionId}/events`);const latest=events.filter(event=>Date.parse(event.at)>=since).at(-1);if(polling&&latest&&['transcribe','think','search','working'].includes(latest.state)){face(latest.state,latest.statusText);}}catch{/* Main request reports failures; polling is only presentation. */}
 if(polling)pollTimer=setTimeout(()=>poll(since),1400);
}
async function submit(request){
 if(busy)return;stopSpeech();busy=true;controls();$('#error').textContent='';$('#retry').hidden=true;lastRequest=request;
 face('think','thinking…');$('#hint').textContent='Working with Meta…';const since=Date.now();
 try{
  await session();polling=true;pollTimer=setTimeout(()=>poll(since),900);
  const result=await api(`/v1/sessions/${sessionId}/${request.audio?'audio':'turns'}`,{method:'POST',body:request.audio||{text:request.text,requestId:request.id},requestId:request.audio?request.id:undefined});
  polling=false;clearTimeout(pollTimer);await renderResult(result);lastRequest=null;
 }catch(error){polling=false;busy=false;clearTimeout(pollTimer);errorView(error);$('#retry').hidden=false;}
 finally{busy=false;controls();}
}
const endOfSpeech=new EndOfSpeech();
const recorder=new VoiceRecorder(level=>{send({type:'muse-level',level});if(recording&&endOfSpeech.sample(level,performance.now())){log('finished speaking · silence detected');void finishRecording();}},()=>finishRecording(),text=>{liveTranscript?.cancel();liveTranscript=null;recordVersion++;recording=recordingPending=false;controls();errorView(new Error(text));},(chunk,rate)=>liveTranscript?.push(chunk,rate));
async function startRecording(){
 if(busy||recording||recordingPending)return;
 if(!connected){try{await status();await session();}catch(error){errorView(error);return;}}
 stopSpeech();$('#error').textContent='';recordingPending=true;controls();face('listen','allow microphone…');const version=++recordVersion;
 liveTranscript?.cancel();let lastPartial='';
 liveTranscript=new RealtimeTranscriber({onPartial:text=>{if(version===recordVersion&&text!==lastPartial){lastPartial=text;apiLog('transcript','',text);}},onFailure:reason=>{if(version===recordVersion)log(`${reason} · recording upload fallback available`);}});
 try{const started=await recorder.start();if(version!==recordVersion||!started)return;recordingPending=false;endOfSpeech.reset();recording=true;face('listen','listening…');$('#hint').textContent='Listening. Pause when done, or tap Jolly to send (60-second maximum).';log('recording started');}
 catch(error){if(version!==recordVersion)return;liveTranscript?.cancel();liveTranscript=null;recordingPending=false;errorView(new Error(error.name==='NotAllowedError'?'Microphone permission denied. Allow it in browser settings, or type below.':error.message));}
 finally{controls();}
}
async function finishRecording(){
 if(recordingPending){recordVersion++;liveTranscript?.cancel();liveTranscript=null;recorder.cancel();recordingPending=false;face('idle','tap to talk');controls();return;}
 if(!recording)return;
 recording=false;busy=true;face('think','thinking…');controls();
 const stream=liveTranscript,version=recordVersion;
 try{
  const audio=await recorder.finish();let text;
  const finalizedAt=performance.now();
  try{text=await stream.finish();log(`live transcript finalized · ${Math.round(performance.now()-finalizedAt)} ms after recording`);}
  catch{if(version!==recordVersion)return;log('live transcription failed · uploading recording to Meta');}
  if(version!==recordVersion)return;
  liveTranscript=null;busy=false;message('user',text||'[voice message]');
  await submit(text?{text,id:crypto.randomUUID()}:{audio,id:crypto.randomUUID()});
 }catch(error){if(version===recordVersion){busy=false;errorView(error);controls();}}
 finally{stream?.cancel();if(liveTranscript===stream)liveTranscript=null;}
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
async function calendarOperation(operation){
 if(calendarBusy||busy||recording||recordingPending)return;
 calendarBusy=true;controls();$('#phone-error').hidden=true;
 try{await operation();}
 catch(error){$('#phone-error').textContent=error.message.includes('configure Google OAuth')?'I’m not quite ready to connect to Google yet. Please try again once setup is finished.':'I couldn’t connect just now. Please try again.';$('#phone-error').hidden=false;apiLog('error','Calendar connection',error.message,true);}
 finally{calendarBusy=false;controls();}
}
$('#connect-calendar').onclick=()=>calendarOperation(async()=>{
 $('#consent').hidden=true;
 const {url}=await api('/v1/integrations/google/connect',{method:'POST',body:{}});
 const parsed=new URL(url);if(parsed.origin!=='https://accounts.google.com')throw new Error('Unexpected consent destination');
 $('#consent').href=url;$('#consent').hidden=false;
 $('#calendar-status').textContent='awaiting Google sign-in';
});
$('#refresh-calendar').onclick=()=>calendarOperation(()=>status());
$('#disconnect-calendar').onclick=()=>calendarOperation(async()=>{
 await api('/v1/integrations/google',{method:'DELETE'});
 $('#consent').hidden=true;await status();log('Google Calendar disconnected');
});
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
function discardRecording(){if(recording||recordingPending||liveTranscript){recordVersion++;liveTranscript?.cancel();liveTranscript=null;recorder.cancel();recording=recordingPending=busy=false;face('idle','recording discarded');$('#hint').textContent='Recording stopped. Streamed audio may already have reached Meta; no request was submitted to the agent.';controls();}stopSpeech();if(currentView.state==='speak')rest();}
document.addEventListener('visibilitychange',()=>{if(document.hidden)discardRecording();});window.addEventListener('pagehide',discardRecording);
try{
 await status();
 if(sessionId){try{await api(`/v1/sessions/${sessionId}/events`);}catch(error){if(error.status!==404)throw error;sessionId=null;sessionStorage.removeItem('muse-session');sessionStorage.removeItem('muse-action');}}
 await session();const actionId=sessionStorage.getItem('muse-action');if(actionId){try{actionView((await api(`/v1/sessions/${sessionId}/actions/${actionId}`)).action);if(pending)face('approval','review pending event');}catch{sessionStorage.removeItem('muse-action');}}
 $('#hint').textContent=pending?'A previous proposal is ready for review.':'Tap Jolly to start a real conversation.';log('backend connected');
}catch(error){connected=false;$('#connection').textContent='○ backend unavailable';errorView(error);controls();}
