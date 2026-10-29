export function createBookingSupport({api,onCall,canReview=()=>true,onChange=()=>{},uuid=()=>crypto.randomUUID()}) {
 const state={profile:null,readiness:null,calls:[],busy:false,error:'',notice:''};
 let reminderAttempt;
 const emit=()=>onChange(state);
 async function run(fn){if(state.busy)return;state.busy=true;state.error='';state.notice='';emit();try{return await fn();}catch(e){state.error=e.message;}finally{state.busy=false;emit();}}
 return {state,
 refresh(){return run(async()=>{const values=await Promise.allSettled([api('/v1/booking-profile'),api('/v1/readiness'),api('/v1/tasks')]);if(values[0].status==='fulfilled')state.profile=values[0].value.profile;if(values[1].status==='fulfilled')state.readiness=values[1].value;if(values[2].status==='fulfilled')state.calls=values[2].value.calls;const error=values.find(r=>r.status==='rejected');if(error)throw error.reason;});},
 saveProfile(profile){return run(async()=>{state.profile=(await api('/v1/booking-profile',{method:'PUT',body:profile})).profile;state.notice='Usual booking saved. Calls still require your approval.';});},
 removeProfile(){return run(async()=>{await api('/v1/booking-profile',{method:'DELETE'});state.profile=null;state.notice='Usual booking removed.';});},
 review(call){return run(async()=>{if(!canReview())throw Error('Finish the current approval first.');const current=(await api(`/v1/sessions/${call.sessionId}/calls/${call.id}`)).callAction;if(!canReview())throw Error('Finish the current approval first.');onCall(current);});},
 retry(call,window){return run(async()=>{if(!canReview())throw Error('Finish the current approval first.');const result=await api(`/v1/sessions/${call.sessionId}/calls/${call.id}/retry`,{method:'POST',body:{window}});if(!canReview()){state.notice='Your new proposal is saved in Tasks for review.';return;}onCall(result.callAction);state.notice='Review the new call before approving. No call has been placed.';});},
 remind(call,dueAt,timeZone){return run(async()=>{const signature=JSON.stringify([call.id,dueAt,timeZone]);if(reminderAttempt?.signature!==signature)reminderAttempt={signature,id:uuid()};await api(`/v1/sessions/${call.sessionId}/calls/${call.id}/reminder`,{method:'POST',body:{id:reminderAttempt.id,dueAt,timeZone}});state.notice='Booking reminder saved.';});},
 later(call,dueAt,timeZone){return run(async()=>{const signature=JSON.stringify(['later',call.id,dueAt,timeZone]);if(reminderAttempt?.signature!==signature)reminderAttempt={signature,id:uuid()};await api('/v1/reminders',{method:'POST',body:{id:reminderAttempt.id,title:`Review booking with ${call.booking.destinationName}`.slice(0,160),dueAt,timeZone,sourceCallId:call.id}});state.notice='Follow-up reminder saved. No call will be placed automatically.';});}
 };
}
export function setupBookingSupport(options){
 const el=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
 const panel=el('details');panel.className='daily-support';panel.append(el('summary','Booking setup & follow-through'));
 const feedback=el('p');feedback.setAttribute('role','status');const refresh=el('button','Refresh bookings and readiness');refresh.type='button';
 const form=el('form'),fields={};form.append(el('h2','My usual haircut'));
 const definitions=[['destinationName','Barber or business','text'],['phoneNumber','Phone number with country code','tel'],['purpose','Service','text'],['customerName','Booking name','text'],['durationMinutes','Duration in minutes','number'],['timeZone','Timezone','text'],['preferredStart','Earliest time','time'],['preferredEnd','Latest time','time']];
 for(const [key,label,type] of definitions){const wrap=el('label',label),input=el('input');input.type=type;input.required=true;input.id='booking-'+key;if(type==='number'){input.min='5';input.max='240';}wrap.append(input);form.append(wrap);fields[key]=input;}
 const dayNodes=[];const days=el('fieldset');days.append(el('legend','Preferred days'));for(const [index,name] of ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].entries()){const label=el('label',name),input=el('input');input.type='checkbox';input.value=String(index+1);label.append(input);days.append(label);dayNodes.push(input);}form.append(days);
 fields.timeZone.value=Intl.DateTimeFormat().resolvedOptions().timeZone;fields.purpose.value='haircut';fields.durationMinutes.value='30';
 const save=el('button','Save usual booking');save.type='submit';const remove=el('button','Remove saved profile');remove.type='button';form.append(save,remove,el('p','Saving a business does not enable its number or place a call. Ask Mochi to find alternatives if you do not have a usual barber; review their details before saving.'));
 const ready=el('div'),results=el('div');panel.append(feedback,refresh,form,ready,results);
 let controller,profileVersion,editing=false;
 form.addEventListener('input',()=>{editing=true;});
 const zone=Intl.DateTimeFormat().resolvedOptions().timeZone;
 const dates=new Map();
 function dateField(label,key){const wrap=el('label',label),input=el('input');input.type='datetime-local';input.value=dates.get(key)||'';input.addEventListener('input',()=>dates.set(key,input.value));wrap.append(input);return {wrap,input};}
 function render(state){
  feedback.textContent=state.error||state.notice;refresh.disabled=state.busy;save.disabled=state.busy;remove.disabled=state.busy||!state.profile;
  if(!editing&&state.profile&&state.profile.updatedAt!==profileVersion){for(const [key] of definitions)fields[key].value=Array.isArray(state.profile[key])?state.profile[key].join(','):state.profile[key];for(const input of dayNodes)input.checked=state.profile.preferredDays.includes(Number(input.value));profileVersion=state.profile.updatedAt;}
  ready.replaceChildren();if(state.readiness){ready.append(el('h2','Demo readiness'),el('p',`Build ${state.readiness.revision} · ${state.readiness.configurationReady?'Configuration ready':'Setup needs attention'} · live/device acceptance remains unverified`));for(const check of state.readiness.checks)ready.append(el('p',`${check.title}: ${check.status.replaceAll('_',' ')}. ${check.detail}`));const usage=state.readiness.usage;ready.append(el('p',`${usage.callAttempts}/${usage.callLimit} call attempts today (UTC). This is not a monetary spending cap.`));}
  // Keep in-flight controls intact; restore their values when results rerender afterward.
  if(state.busy)return;
  results.replaceChildren();results.append(el('h2','Booking follow-through'));
  for(const call of state.calls.filter(c=>c.followUp).slice(0,10)){
   const card=el('section');card.className='daily-row';card.append(el('h3',call.booking.destinationName),el('p',call.followUp.message));
   if(call.bookedSlot&&['booked','rescheduled'].includes(call.outcome))card.append(el('p',`${call.booking.purpose} · ${new Date(call.bookedSlot.start).toLocaleString()} · ${call.booking.timeZone}`));
   const review=el('button','Review result and Calendar');review.type='button';review.onclick=()=>void controller.review(call);card.append(review);
   if(call.followUp.canAddReminder||call.followUp.canRetry||call.followUp.needsVerification){const {wrap,input}=dateField(`Remind me (${zone})`,`${call.sessionId}:${call.id}:reminder`),button=el('button',call.followUp.canAddReminder?'Save appointment reminder':'Remind me to follow up');button.type='button';button.onclick=()=>{const due=new Date(input.value);if(!Number.isFinite(due.getTime())){feedback.textContent='Choose a reminder time.';return;}void (call.followUp.canAddReminder?controller.remind(call,due.toISOString(),zone):controller.later(call,due.toISOString(),zone));};card.append(wrap,button);}
   if(call.followUp.canRetry){const start=dateField(`Try again: availability from (${zone})`,`${call.sessionId}:${call.id}:start`),end=dateField(`Until (${zone})`,`${call.sessionId}:${call.id}:end`),button=el('button','Prepare another call for review');button.type='button';button.onclick=()=>{const a=new Date(start.input.value),b=new Date(end.input.value);if(!Number.isFinite(a.getTime())||!Number.isFinite(b.getTime())||a<=new Date()||b<=a){feedback.textContent='Choose a future availability window.';return;}void controller.retry(call,{start:a.toISOString(),end:b.toISOString()});};card.append(start.wrap,end.wrap,button);}
   results.append(card);
  }
 }
 controller=createBookingSupport({...options,onChange:render});refresh.onclick=()=>void controller.refresh();panel.addEventListener('toggle',()=>{if(panel.open)void controller.refresh();});
 form.onsubmit=async event=>{event.preventDefault();const value=Object.fromEntries(definitions.map(([key])=>[key,fields[key].value.trim()]));value.durationMinutes=Number(value.durationMinutes);value.preferredDays=dayNodes.filter(input=>input.checked).map(input=>Number(input.value));await controller.saveProfile(value);if(!controller.state.error){editing=false;profileVersion=controller.state.profile?.updatedAt;}};
 remove.onclick=async()=>{await controller.removeProfile();if(!controller.state.error){editing=false;profileVersion=undefined;for(const [key]of definitions)fields[key].value='';for(const input of dayNodes)input.checked=false;fields.timeZone.value=zone;}};
 document.querySelector('#phone-home').append(panel);render(controller.state);return controller;
}
