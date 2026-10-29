import {providerSignInURL} from './services.mjs';

// Network state is independent of the voice/booking flow. Failed reminder creation
// retains its client ID so an explicit retry cannot create a second reminder.
export function createDailySupport({api,getSession,onDraft,canReview=()=>true,onChange=()=>{},uuid=()=>crypto.randomUUID()}){
 const state={briefing:null,reminders:[],drafts:[],status:null,busy:false,error:'',notice:''};
 let reminderAttempt=null;
 const emit=()=>onChange(state);
 async function operation(fn){
  if(state.busy)return;
  state.busy=true;state.error='';state.notice='';emit();
  try{return await fn();}catch(error){state.error=error.message||'Could not finish. Please try again.';}
  finally{state.busy=false;emit();}
 }
 async function lists(){
  const results=await Promise.allSettled([api('/v1/reminders'),api('/v1/drafts')]);
  if(results[0].status==='fulfilled')state.reminders=results[0].value.reminders||[];
  if(results[1].status==='fulfilled')state.drafts=results[1].value.drafts||[];
  const failed=results.filter(result=>result.status==='rejected');
  if(failed.length)throw failed[0].reason;
 }
 const review=action=>{
  if(!canReview()){state.notice='Finish the current approval first. This email draft remains in Today.';emit();return false;}
  onDraft(action);return true;
 };
 return {state,
  refresh(timeZone){return operation(async()=>{
   const results=await Promise.allSettled([api(`/v1/briefing?timeZone=${encodeURIComponent(timeZone)}`),api('/v1/status'),lists()]);
   if(results[0].status==='fulfilled')state.briefing=results[0].value;
   if(results[1].status==='fulfilled')state.status=results[1].value;
   const failed=results.find(result=>result.status==='rejected');if(failed)throw failed.reason;
  });},
  addReminder(input){return operation(async()=>{
   const signature=JSON.stringify(input);
   if(reminderAttempt?.signature!==signature)reminderAttempt={signature,id:uuid(),saved:false};
   if(!reminderAttempt.saved){await api('/v1/reminders',{method:'POST',body:{...input,id:reminderAttempt.id}});reminderAttempt.saved=true;}
   state.notice='Reminder saved.';await lists();reminderAttempt=null;return true;
  });},
  updateReminder(id,changes){return operation(async()=>{await api(`/v1/reminders/${encodeURIComponent(id)}`,{method:'PATCH',body:changes});await lists();});},
  removeReminder(id){return operation(async()=>{await api(`/v1/reminders/${encodeURIComponent(id)}`,{method:'DELETE'});await lists();});},
  prepareDraft(input){return operation(async()=>{
   if(!canReview())throw Error('Finish the current approval before preparing another draft.');
   const sessionId=await getSession();
   const result=await api(`/v1/sessions/${sessionId}/drafts`,{method:'POST',body:input});
   if(!result.gmailDraftAction)throw Error('The server did not return an email draft to review.');
   state.drafts=[result.gmailDraftAction,...state.drafts.filter(d=>d.id!==result.gmailDraftAction.id)];
   review(result.gmailDraftAction);return true;
  });},
  reviewDraft(action){return operation(async()=>{
   if(!canReview())throw Error('Finish the current approval before reviewing this draft.');
   const {action:current}=await api(`/v1/sessions/${action.sessionId}/drafts/${action.id}`);
   if(!current)throw Error('This email draft is unavailable. Refresh Today.');
   review(current);
  });},
  enableDrafts(openWindow){
   if(state.busy)return;
   const popup=openWindow();if(popup)popup.opener=null;
   return operation(async()=>{
    try{
     if(!popup)throw Error('Allow popups to continue with Google.');
     const {url}=await api('/v1/integrations/gmail/connect',{method:'POST',body:{drafts:true}});
     popup.location.href=providerSignInURL('gmail',url);
     state.notice='Finish Google consent, then refresh Today. Jolly saves drafts only; it never sends email.';
    }catch(error){popup?.close();throw error;}
   });
  }
 };
}

export function setupDailySupport({api,getSession,onDraft,canReview}){
 const zone=Intl.DateTimeFormat().resolvedOptions().timeZone||'Europe/London';
 const el=(tag,text,cls)=>{const node=document.createElement(tag);if(text)node.textContent=text;if(cls)node.className=cls;return node;};
 const panel=el('details',null,'daily-support'),heading=el('summary','Today'),content=el('div',null,'daily-content');
 const summary=el('p','Your briefing, reminders and email drafts.'),sources=el('p',null,'daily-source-status'),items=el('div'),feedback=el('p');feedback.setAttribute('role','status');
 const refresh=el('button','Refresh Today','phone-secondary');refresh.type='button';
 panel.append(heading,content);content.append(summary,sources,items,refresh,feedback);
 const controls=[refresh];
 const field=(form,label,type,name,max)=>{const id=`daily-${name}`,caption=el('label',label),input=el(type==='textarea'?'textarea':'input');caption.htmlFor=id;input.id=id;input.name=name;if(type!=='textarea')input.type=type;if(max)input.maxLength=max;input.required=true;controls.push(input);form.append(caption,input);return input;};
 const reminderHeading=el('h2','Reminders'),reminders=el('div'),reminderForm=el('form');
 const title=field(reminderForm,'Remind me','text','reminder-title',160),due=field(reminderForm,`When (${zone})`,'datetime-local','reminder-due');
 const repeatLabel=el('label','Repeat'),repeat=el('select');repeat.id='daily-reminder-repeat';repeatLabel.htmlFor=repeat.id;
 for(const [value,label] of [['none','Once'],['daily','Daily'],['weekly','Weekly']]){const option=el('option',label);option.value=value;repeat.append(option);}
 controls.push(repeat);reminderForm.append(repeatLabel,repeat);
 const saveReminder=el('button','Save reminder','phone-secondary');controls.push(saveReminder);reminderForm.append(saveReminder);
 const draftHeading=el('h2','Gmail drafts'),draftInfo=el('p'),upgrade=el('button','Enable Gmail draft access','phone-secondary'),drafts=el('div'),draftForm=el('form');
 upgrade.type='button';controls.push(upgrade);
 const to=field(draftForm,'To','email','draft-to',254),subject=field(draftForm,'Subject','text','draft-subject',200),body=field(draftForm,'Message','textarea','draft-body',8000);
 const prepare=el('button','Review email draft','phone-secondary');controls.push(prepare);draftForm.append(prepare);
 content.append(reminderHeading,reminders,reminderForm,draftHeading,draftInfo,upgrade,drafts,draftForm);
 const format=(value,timeZone=zone)=>{const date=new Date(value);return Number.isNaN(date.getTime())?'Unknown time':new Intl.DateTimeFormat(undefined,{timeZone,dateStyle:'medium',timeStyle:'short'}).format(date);};
 let controller;
 function render(state){
  for(const control of controls)control.disabled=state.busy;
  feedback.textContent=state.error||state.notice;feedback.classList.toggle('daily-error',!!state.error);
  if(state.briefing){
   summary.textContent=(state.briefing.simulated?'Simulation · ':'')+state.briefing.summary;
   sources.textContent=`${state.briefing.date} · ${state.briefing.timeZone} · Updated ${format(state.briefing.generatedAt)}\n`+Object.entries(state.briefing.sources||{}).map(([key,value])=>`${key}: ${value}`).join(' · ');
   items.replaceChildren();
   for(const event of state.briefing.events||[])items.append(el('p',`${event.title} · ${/^\d{4}-\d{2}-\d{2}$/.test(event.start)?'All day':format(event.start,state.briefing.timeZone)}`));
   for(const email of state.briefing.emails||[])items.append(el('p',`${email.subject} — ${email.from}`));
  }
  reminders.replaceChildren();
  if(!state.reminders.length)reminders.append(el('p','No reminders.'));
  for(const reminder of state.reminders){
   const row=el('div',null,'daily-row');row.append(el('strong',reminder.title),el('p',`${format(reminder.dueAt,reminder.timeZone)} · ${reminder.timeZone} · ${reminder.recurrence} · ${reminder.status}`));
   const done=el('button',reminder.status==='completed'?'Mark pending':'Complete');done.type='button';done.disabled=state.busy;done.onclick=()=>void controller.updateReminder(reminder.id,{status:reminder.status==='completed'?'pending':'completed'});
   const change=el('input');change.type='datetime-local';change.setAttribute('aria-label',`New time for ${reminder.title} (${zone})`);change.disabled=state.busy;
   const snooze=el('button','Change time');snooze.type='button';snooze.disabled=state.busy;snooze.onclick=()=>{const time=new Date(change.value);if(!Number.isFinite(time.getTime())){feedback.textContent='Choose a valid reminder time.';return;}void controller.updateReminder(reminder.id,{dueAt:time.toISOString(),timeZone:zone});};
   const remove=el('button','Delete');remove.type='button';remove.disabled=state.busy;remove.onclick=()=>{if(window.confirm(`Delete reminder “${reminder.title}”?`))void controller.removeReminder(reminder.id);};
   row.append(done,change,snooze,remove);reminders.append(row);
  }
  const enabled=state.status?.gmailDraftsEnabled===true&&state.status?.mode==='live';
  draftInfo.textContent=state.status?.mode==='mock'?'Gmail drafts require live mode. Nothing will be saved or sent in this simulation.':enabled?'Review exact recipient, subject and message before saving. Jolly never sends email.':'Drafts need additional Google consent. Existing read-only Gmail access remains available.';
  upgrade.hidden=enabled;upgrade.disabled=state.busy||state.status?.mode!=='live';
  for(const input of [to,subject,body,prepare])input.disabled=state.busy||!enabled;
  drafts.replaceChildren();
  for(const draft of state.drafts){
   const row=el('div',null,'daily-row'),review=el('button',`${draft.subject} · ${draft.status==='completed'?'Saved in Gmail · not sent':draft.status==='uncertain'?'Save unverified':draft.status}`);review.type='button';review.disabled=state.busy;review.onclick=()=>void controller.reviewDraft(draft);row.append(el('p',`To: ${draft.to}`),review);drafts.append(row);
  }
 }
 controller=createDailySupport({api,getSession,onDraft,canReview,onChange:render});
 refresh.onclick=()=>void controller.refresh(zone);
 panel.addEventListener('toggle',()=>{if(panel.open)void controller.refresh(zone);});
 reminderForm.onsubmit=async event=>{event.preventDefault();const time=new Date(due.value);if(!Number.isFinite(time.getTime())){feedback.textContent='Choose a valid reminder time.';return;}if(await controller.addReminder({title:title.value.trim(),dueAt:time.toISOString(),timeZone:zone,recurrence:repeat.value})){title.value='';due.value='';}};
 draftForm.onsubmit=async event=>{event.preventDefault();await controller.prepareDraft({to:to.value.trim(),subject:subject.value,body:body.value});};
 upgrade.onclick=()=>void controller.enableDrafts(()=>window.open('about:blank','_blank'));
 window.addEventListener('focus',()=>{if(panel.open)void controller.refresh(zone);});
 document.querySelector('#phone-home').append(panel);render(controller.state);
 return controller;
}
