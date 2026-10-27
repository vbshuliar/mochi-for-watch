const catalog={
 calendar:{name:'Google Calendar',title:'Calendar',description:'Let Jolly access your calendar to view meetings, find free time and add events.',access:['View meetings and free time','Add events with your approval']},
 instagram:{name:'Instagram',title:'Instagram',description:'Let Jolly help with Instagram posts, comments and replies.',access:['View posts and comments','Draft replies for approval']},
 facebook:{name:'Facebook Pages',title:'Facebook Pages',description:'Let Jolly follow page activity and help with replies.',access:['View page activity','Help draft replies']},
 notion:{name:'Notion',title:'Notion Workspace',description:'Let Jolly find and save information in your Notion pages.',access:['Find pages and notes','Create or update pages with your approval']},
 gmail:{name:'Gmail',title:'Gmail Inbox',description:'Let Jolly help you catch up on email and draft replies.',access:['Find and summarise emails','Draft replies for your review']},
 search:{name:'web search',title:'Web Search',description:'Let Jolly search the web and bring back answers with sources.',access:['Search the web','Include sources']}
};
export function setupServices(onToggle){
 const $=s=>document.querySelector(s);let active=null,calendar='unknown',mode='live',trigger=null,homeScroll=0,enabled=true,blocked=false;
 const switches=[];
 function syncSwitches(){for(const {key,input} of switches){const ready=key==='calendar'&&(calendar==='connected'||calendar==='simulated');input.closest('.service-row').classList.toggle('service-linked',ready);input.checked=ready&&enabled;input.disabled=!ready||blocked;input.title=ready?'Allow Jolly to use this service':'Connect this service first';}}
 function render(){
  if(!active)return;
  const entry=catalog[active],isCalendar=active==='calendar',linked=isCalendar&&calendar==='connected';
  $('#service-title').textContent=entry.title;
  $('#service-status').textContent=isCalendar?(mode==='mock'?'just a practice calendar':linked?(enabled?'connected · enabled':'connected · disabled'):calendar==='unknown'?'let me check…':'not connected'):'not connected';
  $('#service-status').classList.toggle('is-connected',linked);
  $('#service-description').textContent=entry.description;
  $('#service-access').replaceChildren(...entry.access.map(text=>{const li=document.createElement('li');li.textContent=text;return li;}));
  $('#service-availability').textContent=isCalendar?'Disconnect anytime. Your events stay unchanged.':'This connection isn’t available yet.';
  $('#calendar-detail-controls').hidden=!isCalendar;$('#planned-controls').hidden=isCalendar;
  $('#connect-calendar').hidden=linked;$('#edit-calendar').hidden=!linked;
  if(!linked)$('#calendar-edit').hidden=true;
 }
 for(const button of document.querySelectorAll('[data-service]')){
  const row=button.closest('.service-row');
  const open=()=>{trigger=button;active=button.dataset.service;homeScroll=$('.phone-content').scrollTop;$('#phone-home').hidden=true;$('#service-detail').hidden=false;$('#calendar-edit').hidden=true;render();$('.phone-content').scrollTop=0;$('#service-title').focus({preventScroll:true});};
  button.onclick=open;
  row.classList.add('service-openable');
  const label=document.createElement('label');label.className='service-switch';
  const input=document.createElement('input');input.type='checkbox';input.setAttribute('role','switch');input.setAttribute('aria-label',`Enable ${catalog[button.dataset.service].name}`);
  const track=document.createElement('span');track.className='switch-track';track.setAttribute('aria-hidden','true');label.append(input,track);row.append(label);
  switches.push({key:button.dataset.service,input});
  input.onchange=async()=>{const next=input.checked;blocked=true;syncSwitches();try{await onToggle(next);}finally{blocked=false;syncSwitches();}};
 }
 $('#service-back').onclick=()=>{active=null;$('#service-detail').hidden=true;$('#phone-home').hidden=false;$('.phone-content').scrollTop=homeScroll;trigger?.focus({preventScroll:true});};
 $('#edit-calendar').onclick=()=>{$('#calendar-edit').hidden=!$('#calendar-edit').hidden;};
 $('#calendar-reconnect').onclick=()=>$('#connect-calendar').click();
 syncSwitches();
 return {setBusy(value){blocked=value;syncSwitches();},update(value,nextMode,nextEnabled=true){calendar=value;mode=nextMode;enabled=nextEnabled;syncSwitches();render();}};
}
