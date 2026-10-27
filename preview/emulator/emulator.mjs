import {reactionFor,reactionPresentation} from './reactions.mjs';
import {streamReply,SentenceSpeaker} from './stream-reply.mjs';
import {localIntent} from './local-intents.mjs';
import {TurnCoordinator} from './turn-coordinator.mjs';
import {setupServices} from './services.mjs';
import {EndOfSpeech} from './end-of-speech.mjs';
import {summarizeLog} from './log-summary.mjs';
import {VoiceRecorder} from './audio.mjs';
import {SpeechPlayer} from './speech.mjs';
import {RealtimeTranscriber} from './realtime.mjs';
const $=selector=>document.querySelector(selector),watch=$('#watch');
const speechPlayer=new SpeechPlayer();
const turns=new TurnCoordinator();
let activeRequest=null,cancellationBarrier=Promise.resolve(true),streamSpeaker=null;
let decisionBusy=false,voiceEndedAt=null,softWaitTimer=null;
let speechOutput=null,affectionActive=false;
let liveTranscript=null;
let sessionId=sessionStorage.getItem('muse-session'),pending=null,busy=false,recording=false,recordingPending=false,connected=false,lastRequest=null,lastReply='',speechVersion=0,idleTimer,pollTimer,polling=false,recordVersion=0;
const serviceViews=setupServices(enabled=>calendarOperation(async()=>{await api('/v1/integrations/google',{method:'PATCH',body:{enabled}});await status();log(`Calendar ${enabled?'enabled':'disabled'}`);}));
let calendarBusy=false;
let currentView={type:'muse-state',state:'sleep',text:'tap on me to wake up'};
function send(message){watch.contentWindow?.postMessage(message,location.origin);}
function face(state,text){if(affectionActive&&state==='think'){state='loved';text='aww, thank you!';}if(['transcribe','search','working'].includes(state)){state='think';text='thinking…';}if(currentView.state!==state||currentView.text!==text)log(`${state} · ${text||state}`);currentView={type:'muse-state',state,text,hearts:affectionActive};send(currentView);}
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
async function api(path,{method='GET',body,requestId,signal}={}){
 const started=performance.now();apiLog('request',`${method} ${path}`,body instanceof Blob?{type:body.type,bytes:body.size,requestId}:body);
 const headers={'X-Muse-Emulator':'1'};
 if(body instanceof Blob)headers['Content-Type']='audio/wav';else if(body!==undefined)headers['Content-Type']='application/json';
 if(requestId)headers['Idempotency-Key']=requestId;
 let response;try{response=await fetch('/api'+path,{method,headers,body:body===undefined?undefined:body instanceof Blob?body:JSON.stringify(body),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(95000)]):AbortSignal.timeout(95000)});}catch{apiLog('failed',path,{message:'connection lost'},true);throw new Error('Connection lost. Retry the same request when the backend is available.');}
 if(response.status===204){apiLog('response',path,{status:204,ms:Math.round(performance.now()-started)});return null;}
 const result=await response.json();apiLog('response',path,{status:response.status,ms:Math.round(performance.now()-started),body:result},!response.ok);if(!response.ok){const error=new Error(result.error?.message||'Request failed');error.code=result.error?.code;error.status=response.status;throw error;}return result;
}
function stopSpeech(preserveReaction=false){if(!preserveReaction)affectionActive=false;streamSpeaker?.stop();streamSpeaker=null;speechVersion++;clearTimeout(idleTimer);clearTimeout(softWaitTimer);speechPlayer.stop();window.speechSynthesis?.cancel();}
window.addEventListener('pagehide',stopSpeech);
function rest(result){
 if(affectionActive){affectionActive=false;result={...result,reaction:null};}
 clearTimeout(idleTimer);
 if(pending){face('approval','review event · tap to hear');return;}
 if(result?.state==='happy'){face('happy',result.statusText);idleTimer=setTimeout(()=>face('idle','tap to talk'),2400);return;}
 const reaction=reactionPresentation[result?.reaction];
 const next=result?.state==='clarify'||/\?\s*$/.test(result?.speechText||'')?'tap to answer':'tap to talk';
 if(reaction){face(result.reaction,result.state==='clarify'?'tap to answer':reaction.text);log(`reaction · ${result.reaction}`);idleTimer=setTimeout(()=>face('idle',next),reaction.duration);}
 else if(result?.state==='clarify'){face('clarify','tap to answer');idleTimer=setTimeout(()=>face('idle','tap to answer'),1800);}
 else face('idle',next);
}
function speak(text,result){
 stopSpeech(true);lastReply=text;$('#replay').hidden=!text;
 if(document.hidden){rest(result);return;}
 if(!$('#spoken').checked){rest(result);return;}
 if(speechOutput!=='elevenlabs'){apiLog('error','/v1/speech','Jessica is unavailable · check ElevenLabs configuration',true);rest(result);return;}
 const version=speechVersion,started=performance.now();
 apiLog('request','POST /v1/speech',{text});
 face('think','thinking…');
 void speechPlayer.play(text,{
  onBlocked:()=>{if(version!==speechVersion)return;clearTimeout(softWaitTimer);face('idle','tap to hear me');log('browser paused audio · tap Jolly to play');},
  onReady:bytes=>apiLog('response','/v1/speech',{status:200,ms:Math.round(performance.now()-started),message:`ElevenLabs audio ready · ${Math.round(performance.now()-started)} ms`,bytes}),
  onStart:()=>{if(version!==speechVersion)return;clearTimeout(softWaitTimer);if(result?.voiceEndedAt!=null)log(`voice response · ${Math.round(performance.now()-result.voiceEndedAt)} ms from last speech to first audio`);face('speak','speaking…');log(`ElevenLabs playback started · ${Math.round(performance.now()-started)} ms`);},
  onEnd:()=>{if(version===speechVersion){clearTimeout(softWaitTimer);log('ElevenLabs playback finished');rest(result);}},
  onError:error=>{if(version!==speechVersion)return;clearTimeout(softWaitTimer);apiLog('error','/v1/speech',`Jessica could not play · ${error.message}`,true);face('idle','voice unavailable · tap to talk');$('#hint').textContent='Voice unavailable. The reply is in the activity log.';},
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
async function renderResult(result,ticket,streamed=false){
 const valid=()=>ticket===undefined||turns.current(ticket);
 if(!valid())return;
 if(result.action){const authoritative=await api(`/v1/sessions/${sessionId}/actions/${result.action.id}`);if(!valid())return;actionView(authoritative.action);}else actionView(null);
 message('assistant',result.speechText);displayData(result.data);
 if(result.simulated)$('#mode-note').textContent='SIMULATION MODE: this backend is not using real Meta or Calendar.';
 // Keep thinking until audio actually starts; do not flash the result pose first.
 if(!streamed)speak(result.speechText,result);
}
function errorView(error){affectionActive=false;apiLog('error','',error.message,true);$('#error').textContent=error.message;face(error.code==='calendar_disconnected'?'permission':'error',error.code==='calendar_disconnected'?'connect Calendar':/Microphone permission/i.test(error.message)?'allow mic access · tap again':/Microphone disconnected/i.test(error.message)?'mic disconnected · tap again':'couldn’t connect · tap to try');$('#hint').textContent=error.message;log(`error: ${error.code||'connection'}`);}
async function status(){const result=await api('/v1/status');speechOutput=result.speechOutput;connected=true;$('#connection').textContent=result.mode==='live'?'● live Meta backend':'● simulation backend';$('#mode-note').textContent=result.mode==='live'?'Real Meta requests use your API credits. No service key is exposed to this page.':'SIMULATION MODE — fixed replies and simulated Calendar.';const linked=result.calendar==='connected';
 $('#calendar-status').textContent=result.mode==='mock'?'simulated connection':linked?(result.calendarEnabled===false?'connected · disabled':'connected'):'not connected';
 $('#calendar-dot').classList.toggle('connected',linked);
 $('#connect-calendar').textContent=linked?'Reconnect with Google':'Connect with Google';
 $('#disconnect-calendar').hidden=!linked;
 if(linked)$('#consent').hidden=true;serviceViews.update(result.calendar,result.mode,result.calendarEnabled!==false);controls();return result;}
async function session(){if(!sessionId){const created=await api('/v1/sessions',{method:'POST',body:{timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone||'Europe/London'}});sessionId=created.id;sessionStorage.setItem('muse-session',sessionId);}return sessionId;}
async function poll(since,ticket){
 if(!polling||!sessionId||!turns.current(ticket))return;
 try{const {events}=await api(`/v1/sessions/${sessionId}/events`);const latest=events.filter(event=>Date.parse(event.at)>=since).at(-1);if(polling&&turns.current(ticket)&&currentView.state!=='speak'&&currentView.text!=='still thinking · tap to interrupt'&&latest&&['transcribe','think','search','working'].includes(latest.state)){face(latest.state,latest.statusText);}}catch{/* Main request reports failures; polling is only presentation. */}
 if(polling&&turns.current(ticket))pollTimer=setTimeout(()=>poll(since,ticket),1400);
}
async function submit(request){
 if(busy)return;
 const local=request.text?localIntent(request.text):null;
 if(local==='stop'){stopSpeech();face('idle','tap to talk');log('local command · stopped speaking');return;}
 if(local==='repeat'&&lastReply){log('local command · repeat last reply without Meta');speak(lastReply,{state:pending?'approval':'idle'});return;}
 stopSpeech();const ticket=turns.begin();let reaction=null,reactionResult=null;let streamFailed=false;busy=true;controls();$('#error').textContent='';$('#retry').hidden=true;lastRequest=request;
 affectionActive=!pending&&reactionFor(request.text)==='loved';
 face('think','thinking…');$('#hint').textContent='Tap Jolly to interrupt and speak again.';const since=Date.now();
 clearTimeout(softWaitTimer);softWaitTimer=setTimeout(()=>{if(turns.current(ticket)&&currentView.state==='think')face('think','still thinking · tap to interrupt');},6500);
 try{
  const result=await turns.run(ticket,async()=>{
   if(!await cancellationBarrier)throw new Error('Previous request could not be cancelled. Please try again.');
   await session();if(!turns.current(ticket))return;
   const controller=new AbortController();activeRequest={id:request.id,sessionId,controller};
   polling=true;pollTimer=setTimeout(()=>poll(since,ticket),900);
   if(request.audio)return api(`/v1/sessions/${sessionId}/audio`,{method:'POST',body:request.audio,requestId:request.id,signal:controller.signal});
   apiLog('request','POST /v1/sessions/:id/stream',{text:request.text});
   return streamReply(sessionId,request,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(95000)]),onText:text=>{
    if(streamFailed||!turns.current(ticket)||document.hidden||!$('#spoken').checked||speechOutput!=='elevenlabs')return;
    if(!streamSpeaker){
     let started=false;
     streamSpeaker=new SentenceSpeaker({
      onStart:()=>{if(!turns.current(ticket))return;clearTimeout(softWaitTimer);face('speak','speaking…');if(!started){started=true;log(`streamed speech started · ${Math.round(performance.now()-(request.voiceEndedAt??performance.now()))} ms after last speech`);}},
      onBlocked:()=>{if(turns.current(ticket))face('idle','tap to hear me');},
      onEnd:()=>{if(turns.current(ticket)){streamSpeaker=null;rest(reactionResult||{reaction});}},
      onError:error=>{if(turns.current(ticket)){streamFailed=true;streamSpeaker=null;apiLog('error','streamed speech',error.message,true);face('idle','voice unavailable · tap to talk');}}
     });
    }
    streamSpeaker.add(text);
   }});
  });
  if(!turns.current(ticket)||!result)return;
  polling=false;clearTimeout(pollTimer);
  reaction=reactionFor(request.text,result.speechText,result.state);
  reactionResult={...result,reaction};
  const streamed=!!streamSpeaker&&result.state==='speak'&&!result.action;
  if(streamed){lastReply=result.speechText;$('#replay').hidden=false;streamSpeaker.add(result.speechText,true);}
  await renderResult({...result,reaction,voiceEndedAt:request.voiceEndedAt},ticket,streamed||streamFailed);
  if(turns.current(ticket))lastRequest=null;
 }catch(error){if(!turns.current(ticket))return;stopSpeech();polling=false;clearTimeout(pollTimer);clearTimeout(softWaitTimer);errorView(error);$('#retry').hidden=false;}
 finally{if(activeRequest?.id===request.id)activeRequest=null;if(turns.current(ticket)){busy=false;controls();}}
}
function cancelActiveRequest(){
 const active=activeRequest;if(!active)return;
 activeRequest=null;active.controller.abort();
 cancellationBarrier=api(`/v1/sessions/${active.sessionId}/turns/${active.id}/cancel`,{method:'POST',body:{}}).then(()=>true).catch(error=>{apiLog('error','cancel request',error.message,true);return false;});
}
function interruptConversation(){
 cancelActiveRequest();
 turns.invalidate();recordVersion++;polling=false;clearTimeout(pollTimer);clearTimeout(softWaitTimer);
 liveTranscript?.cancel();liveTranscript=null;recorder.cancel();recording=recordingPending=busy=false;
 stopSpeech();lastRequest=null;$('#retry').hidden=true;controls();log('interrupted · previous reply suppressed');
}
function noSpeech(){
 recordVersion++;liveTranscript?.cancel();liveTranscript=null;recorder.cancel();recording=recordingPending=false;
 face('idle','didn’t hear you · tap to try');controls();log('no speech detected · nothing submitted');
}
const endOfSpeech=new EndOfSpeech();
const recorder=new VoiceRecorder(level=>{send({type:'muse-level',level});if(recording){const now=performance.now();if(endOfSpeech.sample(level,now)){log('finished speaking · silence detected');void finishRecording();}else if(endOfSpeech.noInput(now))noSpeech();}},()=>finishRecording(),text=>{liveTranscript?.cancel();liveTranscript=null;recordVersion++;recording=recordingPending=false;controls();errorView(new Error(text));},(chunk,rate)=>liveTranscript?.push(chunk,rate));
async function startRecording(){
 if(busy||recording||recordingPending)return;
 if(!connected){try{await status();await session();}catch(error){errorView(error);return;}}
 stopSpeech();endOfSpeech.reset();$('#error').textContent='';recordingPending=true;controls();face('listen','listening…');const version=++recordVersion;
 liveTranscript?.cancel();let lastPartial='';
 liveTranscript=new RealtimeTranscriber({onPartial:text=>{if(version===recordVersion&&text!==lastPartial){lastPartial=text;endOfSpeech.partial(text,performance.now());apiLog('transcript','',text);}},onFailure:reason=>{if(version===recordVersion)log(`${reason} · recording upload fallback available`);}});
 try{const started=await recorder.start();if(version!==recordVersion||!started)return;recordingPending=false;recording=true;face('listen','listening…');$('#hint').textContent='Listening. Pause when done, or tap Jolly to send (60-second maximum).';log('recording started');}
 catch(error){if(version!==recordVersion)return;liveTranscript?.cancel();liveTranscript=null;recordingPending=false;errorView(new Error(error.name==='NotAllowedError'?'Microphone permission denied. Allow microphone access in browser settings, then tap Jolly again.':error.message));}
 finally{controls();}
}
async function finishRecording(){
 if(recordingPending){recordVersion++;liveTranscript?.cancel();liveTranscript=null;recorder.cancel();recordingPending=false;face('idle','tap to talk');controls();return;}
 if(!recording)return;
 if(!endOfSpeech.hasSpeech){noSpeech();return;}
 voiceEndedAt=endOfSpeech.lastVoice??performance.now();
 recording=false;busy=true;face('think','thinking…');controls();
 const stream=liveTranscript,version=recordVersion;
 try{
  const audio=await recorder.finish();let text;
  const finalizedAt=performance.now();
  try{text=await stream.finish();log(`live transcript finalized · ${Math.round(performance.now()-finalizedAt)} ms after recording`);}
  catch{if(version!==recordVersion)return;log('live transcription failed · uploading recording to Meta');}
  if(version!==recordVersion)return;
  liveTranscript=null;busy=false;message('user',text||'[voice message]');
  await submit(text?{text,id:crypto.randomUUID(),voiceEndedAt}:{audio,id:crypto.randomUUID(),voiceEndedAt});
 }catch(error){if(version===recordVersion){busy=false;errorView(error);controls();}}
 finally{stream?.cancel();if(liveTranscript===stream)liveTranscript=null;}
}
async function tap(){
 if(decisionBusy){log('save verification is running · waiting for its result');return;}
 if(recording||recordingPending){await finishRecording();return;}
 if(streamSpeaker?.blocked){await streamSpeaker.resume();return;}
 if(speechPlayer.current?.blocked){await speechPlayer.resume();return;}
 if(busy||speechPlayer.current||streamSpeaker){interruptConversation();await startRecording();return;}
 if(pending&&(currentView.state==='approval'||pending.status!=='pending')){speak(`${pending.event.title}, from ${pending.event.start} until ${pending.event.end}, ${pending.event.timeZone}. Review the event beside the watch to approve.`,{state:'approval'});return;}
 await startRecording();
}
window.addEventListener('message',event=>{if(event.source!==watch.contentWindow||event.origin!==location.origin)return;if(event.data?.type==='muse-ready')send(currentView);if(event.data?.type==='muse-tap')void tap();});
$('#stop').onclick=finishRecording;
$('#text-form').onsubmit=event=>{event.preventDefault();const text=$('#text').value.trim();if(!text||busy||recording||recordingPending||(pending&&pending.status!=='pending'))return;$('#text').value='';message('user',text);void submit({text,id:crypto.randomUUID()});};
$('#retry').onclick=()=>{if(lastRequest)void submit(lastRequest);};
$('#replay').onclick=()=>{if(!busy&&!recording&&!recordingPending)speak(lastReply,{state:pending?'approval':'idle'});};
async function decision(value){
 if(!pending||busy||recording||recordingPending)return;stopSpeech();decisionBusy=true;busy=true;controls();$('#error').textContent='';face('working',value==='confirm'?'saving your event…':'cancelling…');
 try{const result=await api(`/v1/sessions/${sessionId}/actions/${pending.id}/decision`,{method:'POST',body:{decision:value}});await renderResult(result);}
 catch(error){try{actionView((await api(`/v1/sessions/${sessionId}/actions/${pending.id}`)).action);}catch{}errorView(error);}
 finally{decisionBusy=false;busy=false;controls();}
}
$('#confirm').onclick=()=>decision('confirm');$('#cancel').onclick=()=>decision('cancel');
$('#reset').onclick=async()=>{if(busy||recording||recordingPending)return;stopSpeech();busy=true;controls();try{if(sessionId)await api(`/v1/sessions/${sessionId}`,{method:'DELETE'});sessionId=null;sessionStorage.removeItem('muse-session');actionView(null);lastRequest=null;$('#retry').hidden=true;$('#replay').hidden=true;$('#conversation').replaceChildren();$('#error').textContent='';await session();face('sleep','tap on me to wake up');$('#hint').textContent='A fresh conversation. Tap Jolly to start.';}catch(error){errorView(error);}finally{busy=false;controls();}};
async function calendarOperation(operation){
 if(calendarBusy||busy||recording||recordingPending)return;
 calendarBusy=true;controls();$('#phone-error').hidden=true;
 try{await operation();}
 catch(error){$('#phone-error').textContent='Google Calendar isn’t available right now. Please try again later.';$('#phone-error').hidden=false;apiLog('error','Calendar connection',error.message,true);}
 finally{calendarBusy=false;controls();}
}
$('#connect-calendar').onclick=()=>calendarOperation(async()=>{
 stopCalendarWatch();$('#consent').hidden=true;
 const signIn=window.open('about:blank','_blank');
 if(signIn)signIn.opener=null;
 let opened=false;
 try{
  const info=await status();
  if(info.mode==='mock'||!info.calendarConfigured)throw new Error('Calendar OAuth unavailable; see backend setup documentation.');
  const {url}=await api('/v1/integrations/google/connect',{method:'POST',body:{}});
  const parsed=new URL(url);if(parsed.origin!=='https://accounts.google.com')throw new Error('Unexpected consent destination');
  $('#calendar-status').textContent='awaiting Google sign-in';
  if(signIn&&!signIn.closed){
   signIn.location.replace(url);opened=true;
   calendarWatchUntil=Date.now()+600000;calendarWatch=setTimeout(checkCalendarConnection,1500);
   $('#service-status').textContent='waiting for Google sign-in…';
  }else{
   $('#consent').href=url;$('#consent').hidden=false;
   $('#service-status').textContent='continue with Google below';
  }
 }finally{if(!opened)signIn?.close();}
});
let calendarWatch=null,calendarWatchUntil=0;
function stopCalendarWatch(){clearTimeout(calendarWatch);calendarWatch=null;calendarWatchUntil=0;}
async function checkCalendarConnection(){
 if(Date.now()>calendarWatchUntil){stopCalendarWatch();$('#service-status').textContent='sign-in timed out · tap connect to try again';return;}
 try{const result=await status();if(result.calendar==='connected'){stopCalendarWatch();log('Google Calendar connected');return;}}catch{ /* Retry transient status failures until the consent window expires. */ }
 if(calendarWatchUntil)calendarWatch=setTimeout(checkCalendarConnection,2500);
}
$('#consent').onclick=()=>{stopCalendarWatch();calendarWatchUntil=Date.now()+600000;calendarWatch=setTimeout(checkCalendarConnection,1500);};
window.addEventListener('pagehide',stopCalendarWatch);
$('#refresh-calendar').onclick=()=>calendarOperation(()=>status());
$('#disconnect-calendar').onclick=()=>calendarOperation(async()=>{
 stopCalendarWatch();await api('/v1/integrations/google',{method:'DELETE'});
 $('#consent').hidden=true;await status();log('Google Calendar disconnected');
});
window.addEventListener('focus',()=>{void status().catch(()=>{});});
$('#spoken').onchange=()=>{if(!$('#spoken').checked){stopSpeech();rest();}};
function discardRecording(){if(!decisionBusy){cancelActiveRequest();turns.invalidate();polling=false;clearTimeout(pollTimer);clearTimeout(softWaitTimer);busy=false;}if(recording||recordingPending||liveTranscript){recordVersion++;liveTranscript?.cancel();liveTranscript=null;recorder.cancel();recording=recordingPending=busy=false;face('idle','recording discarded');$('#hint').textContent='Recording stopped. Streamed audio may already have reached Meta; no request was submitted to the agent.';controls();}stopSpeech();if(!decisionBusy)rest();controls();}
document.addEventListener('visibilitychange',()=>{if(document.hidden)discardRecording();});window.addEventListener('pagehide',discardRecording);
try{
 await status();
 if(sessionId){try{await api(`/v1/sessions/${sessionId}/events`);}catch(error){if(error.status!==404)throw error;sessionId=null;sessionStorage.removeItem('muse-session');sessionStorage.removeItem('muse-action');}}
 await session();const actionId=sessionStorage.getItem('muse-action');if(actionId){try{actionView((await api(`/v1/sessions/${sessionId}/actions/${actionId}`)).action);if(pending)face('approval','review pending event');}catch{sessionStorage.removeItem('muse-action');}}
 $('#hint').textContent=pending?'A previous proposal is ready for review.':'Tap Jolly to start a real conversation.';log('backend connected');
}catch(error){connected=false;$('#connection').textContent='○ backend unavailable';errorView(error);controls();}
