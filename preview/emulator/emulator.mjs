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
const serviceViews=setupServices(enabled=>calendarOperation(async()=>{await api('/v1/integrations/google',{method:'PATCH',body:{enabled}});await status();log(`Calendar ${enabled?'enabled':'disabled'}`);}),{api,refresh:status});
let calendarBusy=false,callRecoveryPending=sessionStorage.getItem('muse-action-kind')==='calls'&&!!sessionStorage.getItem('muse-action');
let backgroundCall=null,queuedCompletion=null,savedForeground=null,callRestoreBusy=false;
const callScope=()=>`muse-calls:${location.origin}:${sessionId}`;
const foregroundApproval=()=>!!savedForeground||!!pending&&(!pending.booking||pending.status==='pending');
function dialogueIdle(){return !document.hidden&&!callRestoreBusy&&!busy&&!decisionBusy&&!recording&&!recordingPending&&!speechPlayer.current&&!streamSpeaker&&!foregroundApproval();}
function renderCallWidget(){
 const call=backgroundCall;
 $('#call-indicator').hidden=!call;
 if(!call)return;
 $('#call-indicator').textContent=activeCall(call)?`◌ ${call.progress?.text||'Booking call in progress'} · review`:'◉ Call update · review';
 $('#call-indicator').onclick=()=>{callDeadline=Date.now()+540000;monitorCall();actionView(backgroundCall,true);};
}
function announceCall(call){
 if(!call||activeCall(call))return;
 const key=`${callScope()}:seen:${call.id}:${call.status}:${call.outcome||''}`;
 if(sessionStorage.getItem(key))return;
 queuedCompletion=call;
 flushCompletion();
}
function localBookingTime(instant){
 const parts=new Intl.DateTimeFormat('en-GB',{weekday:'short',day:'numeric',month:'short',hour:'numeric',minute:'2-digit',hour12:true}).formatToParts(new Date(instant));
 const value=type=>parts.find(part=>part.type===type)?.value||'';
 return `${value('weekday')}, ${value('day')} ${value('month')} · ${value('hour')}:${value('minute')} ${value('dayPeriod').toLowerCase()}`;
}
function flushCompletion(){
 if(!queuedCompletion||!dialogueIdle())return;
 const call=queuedCompletion;queuedCompletion=null;
 sessionStorage.setItem(`${callScope()}:seen:${call.id}:${call.status}:${call.outcome||''}`,'1');
 const booked=call.status==='completed'&&call.outcome==='booked';
 $('#call-card-title').textContent=booked?'booking confirmed':call.status==='uncertain'?'booking unverified':'call finished';
 $('#call-card-detail').textContent=booked?`${call.booking.destinationName}\n${call.booking.purpose}`:call.summary||'No booking has been confirmed. Review the call for details.';
 $('#call-card-date').textContent=booked&&call.bookedSlot?localBookingTime(call.bookedSlot.start):'';
 $('#call-card-date').hidden=!booked||!call.bookedSlot;
 $('#call-card').hidden=false;$('.watch-shell').classList.toggle('has-call-card',true);
 $('#call-card-review').onclick=()=>{ $('#call-card').hidden=true;$('.watch-shell').classList.toggle('has-call-card',false);actionView(call,true);};
 $('#call-card-dismiss').onclick=()=>{$('#call-card').hidden=true;$('.watch-shell').classList.toggle('has-call-card',false);face('idle','tap to talk');};
 face(booked?'happy':'idle',booked?'booking confirmed':'call update');
 clearTimeout(idleTimer);idleTimer=setTimeout(()=>{if(dialogueIdle())face('idle','tap to talk');},2400);
}
function updateBackgroundCall(call,notify=false){
 const wasActive=activeCall(backgroundCall)&&backgroundCall.id===call.id;
 backgroundCall=call;
 sessionStorage.setItem(`${callScope()}:active`,call.id);
 renderCallWidget();
 if(!callDeadline)callDeadline=Date.now()+540000;
 monitorCall();
 if(!activeCall(call)&&(notify||wasActive))announceCall(call);
}
async function restoreSavedAction(){
 callRestoreBusy=true;
 try{await restoreSavedActionInternal();}finally{callRestoreBusy=false;controls();}
}
async function restoreSavedActionInternal(){
 const backgroundId=sessionStorage.getItem(`${callScope()}:active`);
 if(backgroundId){try{const result=await api(`/v1/sessions/${sessionId}/calls/${backgroundId}`);updateBackgroundCall(result.callAction,true);}catch{ $('#call-indicator').hidden=false;$('#call-indicator').textContent='Call status unavailable · retry';$('#call-indicator').onclick=()=>restoreSavedAction();}}
 else{try{const result=await api(`/v1/sessions/${sessionId}/calls`);const active=result.calls?.find(activeCall);if(active)updateBackgroundCall(active);}catch{/* A saved foreground proposal can still be restored. */}}
 const actionId=sessionStorage.getItem('muse-action');if(!actionId){callRecoveryPending=false;controls();return;}
 const kind=sessionStorage.getItem('muse-action-kind');
 try{
  const restored=await api(`/v1/sessions/${sessionId}/${['documents','calls'].includes(kind)?kind:'actions'}/${actionId}`);
  callRecoveryPending=false;actionView(restored.callAction||restored.action);
  if(foregroundApproval())face('approval','tap to review');
 }catch(error){
  if(kind==='calls'&&error.status!==404){callRecoveryPending=true;controls();throw new Error('Couldn’t restore your call status. Reload to check again before starting another conversation.');}
  callRecoveryPending=false;sessionStorage.removeItem('muse-action');
 }
}
let callTimer=null,callAbort=null,callDeadline=0;
const uncertainCalls=new Set();
const activeCall=call=>!!call?.booking&&['starting','queued','in_progress'].includes(call.status);
function stopCallUpdates(){clearTimeout(callTimer);callTimer=null;callAbort?.abort();callAbort=null;}
function monitorCall(){
 stopCallUpdates();
 if(!activeCall(backgroundCall)||document.hidden||Date.now()>callDeadline)return;
 const call=backgroundCall;
 callTimer=setTimeout(async()=>{
  callAbort=new AbortController();
  try{const result=await api(`/v1/sessions/${call.sessionId}/calls/${call.id}`,{signal:callAbort.signal});if(backgroundCall?.id!==call.id)return;updateBackgroundCall(result.callAction,true);}
  catch{if(backgroundCall?.id===call.id){$('#action-note').textContent='Call status temporarily unavailable. Checking again; Jolly will not redial automatically.';monitorCall();}}
 },3000);
}
window.addEventListener('pagehide',stopCallUpdates);
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopCallUpdates();else{callDeadline=Date.now()+540000;monitorCall();flushCompletion();}});
async function callCommand(command){
 const call=pending?.booking?pending:backgroundCall;
 if(!call||decisionBusy)return;
 if(command==='calendar'&&savedForeground)return;
 if(command==='confirm'&&(call.status!=='pending'||uncertainCalls.has(call.id)))return;
 if(command==='confirm'||command==='cancel'||command==='calendar'){if(busy||recording||recordingPending)return;stopSpeech();}
 stopCallUpdates();decisionBusy=true;controls();
 const path=`/v1/sessions/${call.sessionId}/calls/${call.id}`;
 try{
  if(command==='refresh')actionView((await api(path)).callAction);
  else{
   if(command==='confirm'){uncertainCalls.add(call.id);sessionStorage.setItem('muse-call-attempt',call.id);}
   const decision=['confirm','cancel'].includes(command);
   const result=await api(`${path}/${decision?'decision':command}`,{method:'POST',body:decision?{decision:command}:{}});
   if(command==='stop'){if(result.callAction)updateBackgroundCall(result.callAction);}else await renderResult(result);
  }
 }catch(error){try{actionView((await api(path)).callAction);}catch{}$('#action-note').textContent='Couldn’t verify the call update. Refresh its status; no automatic redial will occur.';if(['confirm','cancel','calendar'].includes(command))errorView(error);}
 finally{decisionBusy=false;callDeadline=Date.now()+540000;controls();monitorCall();flushCompletion();}
}

let currentView={type:'muse-state',state:'sleep',text:'tap on me to wake up'};
function send(message){watch.contentWindow?.postMessage(message,location.origin);}
function face(state,text){if(['think','listen','speak','loved'].includes(state)){$('#call-card').hidden=true;$('.watch-shell').classList.toggle('has-call-card',false);}if(affectionActive&&state==='think'){state='loved';text='aww, thank you!';}if(['transcribe','search','working'].includes(state)){state='think';text='thinking…';}if(currentView.state!==state||currentView.text!==text)log(`${state} · ${text||state}`);currentView={type:'muse-state',state,text,hearts:affectionActive};send(currentView);}
function log(text){apiLog('state','',text);}
function message(role,text){apiLog(role==='user'?'input':'reply','',text);}
function controls(){
 serviceViews.setBusy(calendarBusy||busy||recording||recordingPending);
 $('#send').disabled=callRecoveryPending||busy||recording||recordingPending||!connected||foregroundApproval()||!!(pending&&!pending.booking&&pending.status!=='pending');
 $('#reset').disabled=callRecoveryPending||busy||recording||recordingPending||activeCall(backgroundCall);
 $('#confirm').disabled=!!(pending?.booking&&(pending.status!=='pending'||uncertainCalls.has(pending.id)))||busy||recording||recordingPending||!pending||!!(pending.body&&pending.status!=='pending');
 $('#cancel').disabled=busy||recording||recordingPending||!pending||pending.status!=='pending';
 for(const id of ['stop-call','call-calendar','refresh-call','dismiss-document']){const button=$('#'+id);if(button)button.disabled=id==='stop-call'?decisionBusy:busy||recording||recordingPending||(id==='call-calendar'&&!!savedForeground);}
 $('#stop').hidden=!recording&&!recordingPending;
 $('#stop').textContent=recordingPending?'cancel microphone request':'finish talking';
 $('#connect-calendar').disabled=calendarBusy||busy||recording||recordingPending;
 $('#refresh-calendar').disabled=calendarBusy||busy||recording||recordingPending;
 $('#disconnect-calendar').disabled=calendarBusy||busy||recording||recordingPending;
 $('#edit-calendar').disabled=calendarBusy||busy||recording||recordingPending;
 $('#calendar-reconnect').disabled=calendarBusy||busy||recording||recordingPending;
 flushCompletion();
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
 list.append(row);while(list.children.length>200){const oldest=Array.from(list.children).find(item=>item.id!=='approval-log-row');if(!oldest)break;oldest.remove();}
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
 if(queuedCompletion&&dialogueIdle()){flushCompletion();return;}
 if(affectionActive){affectionActive=false;result={...result,reaction:null};}
 clearTimeout(idleTimer);
 if(foregroundApproval()){face('approval','review draft · tap to hear');return;}
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
function actionView(action,review=false){
 if(review&&action?.booking&&pending&&!pending.booking){savedForeground=pending;}
 if(!action&&savedForeground){action=savedForeground;savedForeground=null;}
 if(action?.booking&&action.status!=='pending'){updateBackgroundCall(action);if(!review){if(sessionStorage.getItem('muse-action')===action.id){sessionStorage.removeItem('muse-action');sessionStorage.removeItem('muse-action-kind');}if(pending?.booking)pending=null;$('#approval').hidden=!pending;controls();return;}}
 if(action?.booking&&sessionStorage.getItem('muse-call-attempt')===action.id)uncertainCalls.add(action.id);
 let dismiss=$('#dismiss-document');if(!dismiss){dismiss=document.createElement('button');dismiss.id='dismiss-document';dismiss.textContent='back to Jolly';dismiss.onclick=()=>{if(!busy){actionView(null);if(dialogueIdle())face('idle','tap to talk');}};$('#approval').append(dismiss);}dismiss.hidden=!((action?.body&&['uncertain','executing'].includes(action.status))||(action?.booking&&(action.status!=='pending'||uncertainCalls.has(action.id))));
 pending=action&&(action.booking||['pending','uncertain','executing'].includes(action.status))?action:null;
 for(const id of ['stop-call','call-calendar','refresh-call']){if($('#'+id))$('#'+id).hidden=true;}
 $('#confirm').hidden=!!pending?.booking&&pending.status!=='pending';
 $('#cancel').hidden=!!pending?.booking&&pending.status!=='pending';
 $('#approval').hidden=!pending;
 if(pending){let row=$('#approval-log-row');if(!row){row=document.createElement('li');row.id='approval-log-row';row.className='log-row';$('#api-log').append(row);}row.append($('#approval'));}
 if(!pending){sessionStorage.removeItem('muse-action');sessionStorage.removeItem('muse-action-kind');controls();return;}
 const persisted=savedForeground||pending;sessionStorage.setItem('muse-action',persisted.id);sessionStorage.setItem('muse-action-kind',persisted.booking?'calls':persisted.body?'documents':'actions');
 if(pending.booking){
  const booking=pending.booking;
  if(sessionStorage.getItem('muse-call-attempt')===pending.id)uncertainCalls.add(pending.id);
  const fmt=new Intl.DateTimeFormat(undefined,{timeZone:booking.timeZone,dateStyle:'medium',timeStyle:'short'});
  const windows=booking.windows??[booking.window];
  const availability=windows.map(window=>`${fmt.format(new Date(window.start))} → ${fmt.format(new Date(window.end))}`).join('\n');
  $('#event-title').textContent=`Call ${booking.destinationName} · ${booking.phoneNumber}`;
  $('#event-time').style.whiteSpace='pre-wrap';
  $('#event-time').textContent=`${booking.purpose}\nBooking for: ${booking.customerName}\n${availability}\n${booking.timeZone} · ${booking.durationMinutes} minutes\n${pending.calendarChecked?'Calendar checked for availability.':'Calendar has not been checked. Availability is unverified.'}\nStatus: ${pending.status.replaceAll('_',' ')}${pending.summary?'\n'+pending.summary:''}${pending.status==='completed'&&pending.outcome==='booked'&&pending.bookedSlot?'\nBooked: '+fmt.format(new Date(pending.bookedSlot.start))+' → '+fmt.format(new Date(pending.bookedSlot.end)):''}`;
  $('#action-note').textContent=pending.status==='pending'&&!uncertainCalls.has(pending.id)?'Jolly will call as your AI assistant and share these booking details only after you approve.':pending.status==='uncertain'||uncertainCalls.has(pending.id)&&pending.status==='pending'?'The result is unverified. Check with the business before another booking. Jolly will not redial automatically.':'Review the call update below. Calendar events are saved only with separate approval.';
  $('#confirm').textContent='approve and call';
  for(const [id,label,command,visible] of [['stop-call',pending.status==='uncertain'?'try stopping call':'stop call','stop',activeCall(pending)||pending.status==='uncertain'],['call-calendar','review Calendar event','calendar',pending.status==='completed'&&pending.outcome==='booked'],['refresh-call','refresh status','refresh',true]]){
   let button=$('#'+id);if(!button){button=document.createElement('button');button.id=id;button.textContent=label;button.onclick=()=>callCommand(command);$('#approval').append(button);}button.textContent=label;button.hidden=!visible;
  }
  if(!callDeadline)callDeadline=Date.now()+540000;
  controls();return;
 }
 if(pending.body){$('#event-title').textContent=pending.title;$('#event-time').textContent=`Save under: ${pending.parentTitle}\n\n${pending.body}`;$('#event-time').style.whiteSpace='pre-wrap';$('#action-note').textContent=pending.status==='pending'?'Review the full page before saving.':'The save is unverified. Check Notion; automatic retries are disabled.';$('#confirm').textContent='save to Notion';controls();return;}
 $('#event-time').style.whiteSpace='';
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
 if(result.callAction&&!result.action){actionView(result.callAction);}else if(result.documentAction){const authoritative=await api(`/v1/sessions/${sessionId}/documents/${result.documentAction.id}`);if(!valid())return;actionView(authoritative.action);}else if(result.action){const authoritative=await api(`/v1/sessions/${sessionId}/actions/${result.action.id}`);if(!valid())return;actionView(authoritative.action);}else actionView(null);
 message('assistant',result.speechText);displayData(result.data);
 if(result.sources?.length){
  const row=document.createElement('li');row.className='log-row';
  const details=document.createElement('details'),summary=document.createElement('summary');
  summary.textContent=`sources · ${result.sources.length} references`;details.append(summary);
  for(const source of result.sources){try{const url=new URL(source.url);if(!['https:','http:'].includes(url.protocol)||url.username||url.password)continue;const link=document.createElement('a');link.href=url.href;link.textContent=source.title;link.target='_blank';link.rel='noopener noreferrer';link.style.display='block';details.append(link);}catch{}}
  row.append(details);$('#api-log').append(row);
 }
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
 if(linked)$('#consent').hidden=true;serviceViews.update(result.calendar,result.mode,result.calendarEnabled!==false,result.webSearch===true,result);controls();return result;}
async function session(){if(!sessionId){const created=await api('/v1/sessions',{method:'POST',body:{timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone||'Europe/London'}});sessionId=created.id;sessionStorage.setItem('muse-session',sessionId);}return sessionId;}
async function poll(since,ticket){
 if(!polling||!sessionId||!turns.current(ticket))return;
 try{const {events}=await api(`/v1/sessions/${sessionId}/events`);const latest=events.filter(event=>Date.parse(event.at)>=since).at(-1);if(polling&&turns.current(ticket)&&currentView.state!=='speak'&&currentView.text!=='still thinking · tap to interrupt'&&latest&&['transcribe','think','search','working'].includes(latest.state)){face(latest.state,latest.statusText);}}catch{/* Main request reports failures; polling is only presentation. */}
 if(polling&&turns.current(ticket))pollTimer=setTimeout(()=>poll(since,ticket),1400);
}
async function submit(request){
 if(callRecoveryPending||busy||foregroundApproval())return;
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
 finally{if(activeRequest?.id===request.id)activeRequest=null;if(turns.current(ticket)){busy=false;controls();flushCompletion();}}
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
 if(callRecoveryPending||busy||recording||recordingPending||foregroundApproval())return;
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
 if(callRecoveryPending){face('approval','reload to restore call');return;}
 if(decisionBusy){log('save verification is running · waiting for its result');return;}
 if(savedForeground)actionView(null);
 if(pending?.booking&&pending.status==='pending'){speak(`Call to ${pending.booking.destinationName}. Review the phone number and booking details beside the watch.`,{state:'approval'});return;}
 if(recording||recordingPending){await finishRecording();return;}
 if(streamSpeaker?.blocked){await streamSpeaker.resume();return;}
 if(speechPlayer.current?.blocked){await speechPlayer.resume();return;}
 if(busy||speechPlayer.current||streamSpeaker){interruptConversation();await startRecording();return;}
 if(foregroundApproval()&&(currentView.state==='approval'||pending.status!=='pending')){if(pending.body){speak(`Your draft ${pending.title} is ready. Review the full page beside the watch before saving.`,{state:'approval'});return;}speak(`${pending.event.title}, from ${pending.event.start} until ${pending.event.end}, ${pending.event.timeZone}. Review the event beside the watch to approve.`,{state:'approval'});return;}
 await startRecording();
}
window.addEventListener('message',event=>{if(event.source!==watch.contentWindow||event.origin!==location.origin)return;if(event.data?.type==='muse-ready')send(currentView);if(event.data?.type==='muse-tap')void tap();});
$('#stop').onclick=finishRecording;
$('#text-form').onsubmit=event=>{event.preventDefault();const text=$('#text').value.trim();if(!text||busy||recording||recordingPending||foregroundApproval())return;$('#text').value='';message('user',text);void submit({text,id:crypto.randomUUID()});};
$('#retry').onclick=()=>{if(lastRequest)void submit(lastRequest);};
$('#replay').onclick=()=>{if(!busy&&!recording&&!recordingPending)speak(lastReply,{state:pending?'approval':'idle'});};
async function decision(value){
 if(pending?.booking){await callCommand(value);return;}
 if(!pending||busy||recording||recordingPending)return;stopSpeech();decisionBusy=true;busy=true;controls();$('#error').textContent='';face('working',value==='confirm'?'saving your event…':'cancelling…');
 try{const result=await api(`/v1/sessions/${sessionId}/${pending.booking?'calls':pending.body?'documents':'actions'}/${pending.id}/decision`,{method:'POST',body:{decision:value}});await renderResult(result);}
 catch(error){try{actionView((await api(`/v1/sessions/${sessionId}/${pending.booking?'calls':pending.body?'documents':'actions'}/${pending.id}`)).action);}catch{}errorView(error);}
 finally{decisionBusy=false;busy=false;controls();}
}
$('#confirm').onclick=()=>decision('confirm');$('#cancel').onclick=()=>decision('cancel');
$('#reset').onclick=async()=>{if(busy||recording||recordingPending||activeCall(backgroundCall))return;stopSpeech();busy=true;controls();try{if(sessionId)await api(`/v1/sessions/${sessionId}`,{method:'DELETE'});backgroundCall=null;queuedCompletion=null;savedForeground=null;renderCallWidget();sessionId=null;sessionStorage.removeItem('muse-session');actionView(null);lastRequest=null;$('#retry').hidden=true;$('#replay').hidden=true;$('#conversation').replaceChildren();$('#error').textContent='';await session();face('sleep','tap on me to wake up');$('#hint').textContent='A fresh conversation. Tap Jolly to start.';}catch(error){errorView(error);}finally{busy=false;controls();flushCompletion();}};
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
 await session();await restoreSavedAction();
 $('#hint').textContent=pending?'A previous proposal is ready for review.':'Tap Jolly to start a real conversation.';log('backend connected');
}catch(error){connected=false;$('#connection').textContent='○ backend unavailable';errorView(error);controls();}
