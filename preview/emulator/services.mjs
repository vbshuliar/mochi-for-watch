const catalog={
 calendar:{name:'Google Calendar',title:'Calendar',description:'Let Jolly access your calendar to view meetings, find free time and add events.',access:['View meetings and free time','Add events with your approval']},
 instagram:{name:'Instagram',title:'Instagram',description:'Let Jolly help with Instagram posts, comments and replies.',access:['View posts and comments','Draft replies for approval']},
 facebook:{name:'Facebook Pages',title:'Facebook Pages',description:'Let Jolly follow page activity and help with replies.',access:['View page activity','Help draft replies']},
 notion:{name:'Notion',title:'Notion Workspace',description:'Let Jolly turn ideas and email summaries into Notion pages.',access:['Choose a destination page','Create pages with your approval']},
 gmail:{name:'Gmail',title:'Gmail Inbox',description:'Let Jolly find and summarize your email. It cannot send or delete messages.',access:['Find and summarise emails','Read-only access']},
 search:{name:'web search',title:'Web Search',description:'Let Jolly search the web and bring back answers with sources.',access:['Search the web','Include sources']}
};
export function setupServices(onToggle,{api,refresh}={}){
 const $=s=>document.querySelector(s);let active=null,calendar='unknown',mode='live',trigger=null,homeScroll=0,enabled=true,blocked=false,webSearch=false,workspace={};
 const switches=[];

 const workspaceControls=document.createElement('div'),workspaceConnect=document.createElement('button'),workspaceDisconnect=document.createElement('button'),workspaceDestination=document.createElement('p'),workspaceSearch=document.createElement('form'),workspaceQuery=document.createElement('input'),workspaceFind=document.createElement('button'),workspacePages=document.createElement('div'),workspaceError=document.createElement('p');
 workspaceControls.hidden=true;workspaceConnect.className='phone-primary';workspaceDisconnect.textContent='Disconnect';workspaceQuery.placeholder='Find a shared Notion page';workspaceQuery.setAttribute('aria-label','Find a shared Notion page');workspaceQuery.maxLength=100;workspaceFind.textContent='Find pages';workspaceSearch.append(workspaceQuery,workspaceFind);workspaceControls.append(workspaceConnect,workspaceDisconnect,workspaceDestination,workspaceSearch,workspacePages,workspaceError);$('#service-detail').append(workspaceControls);
 async function operate(fn){if(blocked)return;blocked=true;workspaceConnect.disabled=workspaceDisconnect.disabled=workspaceFind.disabled=true;workspaceError.textContent='';try{await fn();}catch(e){workspaceError.textContent=e.message||'Could not finish. Please try again.';}finally{blocked=false;workspaceConnect.disabled=workspaceDisconnect.disabled=workspaceFind.disabled=false;}}
 workspaceConnect.onclick=()=>{if(blocked||!api)return;const provider=active,popup=window.open('about:blank','_blank');if(popup)popup.opener=null;operate(async()=>{try{const {url}=await api(`/v1/integrations/${provider}/connect`,{method:'POST',body:{}});const parsed=new URL(url);if(parsed.protocol!=='https:'||parsed.hostname!==(provider==='gmail'?'accounts.google.com':'api.notion.com'))throw Error('Invalid sign-in link');if(popup)popup.location.href=parsed.href;else throw Error('Allow popups and try again.');}catch(e){popup?.close();throw e;}});};
 workspaceDisconnect.onclick=()=>{const provider=active;if(!confirm('Disconnect this service?'))return;operate(async()=>{await api(`/v1/integrations/${provider}`,{method:'DELETE'});await refresh();});};
 workspaceSearch.onsubmit=e=>{e.preventDefault();operate(async()=>{const data=await api('/v1/integrations/notion/pages/search',{method:'POST',body:{query:workspaceQuery.value}});workspacePages.replaceChildren();for(const page of data.pages){const button=document.createElement('button');button.textContent=page.title;button.onclick=()=>operate(async()=>{await api('/v1/integrations/notion/destination',{method:'PUT',body:{id:page.id}});await refresh();});workspacePages.append(button);}if(data.hasMore)workspaceError.textContent='More pages available; narrow your search.';});};
 function syncSwitches(){for(const key of ['gmail','notion']){const row=$(`[data-service="${key}"]`)?.closest('.service-row');row?.classList.toggle('service-linked',workspace[key]==='connected');row?.querySelector('.service-dot')?.setAttribute('aria-label',workspace[key]==='connected'?'connected':'not connected');}const searchRow=$('[data-service="search"]')?.closest('.service-row');if(searchRow){searchRow.classList.toggle('service-linked',webSearch);const status=searchRow.querySelector('.service-dot');if(status)status.setAttribute('aria-label',webSearch?'available through Meta':'unavailable in this backend');}for(const {key,input} of switches){const ready=key==='calendar'&&(calendar==='connected'||calendar==='simulated');input.closest('.service-row').classList.toggle('service-linked',ready);input.checked=ready&&enabled;input.disabled=!ready||blocked;input.title=ready?'Allow Jolly to use this service':'Connect this service first';}}
 function render(){
  if(!active)return;
  const entry=catalog[active],isCalendar=active==='calendar',isWorkspace=['gmail','notion'].includes(active),linked=isCalendar?calendar==='connected':workspace[active]==='connected';
  $('#service-title').textContent=entry.title;
  $('#service-status').textContent=active==='search'&&webSearch?'available through Meta':isCalendar?(mode==='mock'?'just a practice calendar':linked?(enabled?'connected · enabled':'connected · disabled'):calendar==='unknown'?'let me check…':'not connected'):linked?'connected':'not connected';
  $('#service-status').classList.toggle('is-connected',linked||(active==='search'&&webSearch));
  $('#service-description').textContent=entry.description;
  $('#service-access').replaceChildren(...entry.access.map(text=>{const li=document.createElement('li');li.textContent=text;return li;}));
  $('#service-availability').textContent=active==='search'&&webSearch?'Ask Jolly for current information. No extra sign-in needed.':isCalendar?'Disconnect anytime. Your events stay unchanged.':isWorkspace?'Disconnect anytime. Existing email and pages stay unchanged.':'This connection isn’t available yet.';
  $('#calendar-detail-controls').hidden=!isCalendar;$('#planned-controls').hidden=isCalendar||isWorkspace||(active==='search'&&webSearch);workspaceControls.hidden=!isWorkspace;if(isWorkspace){workspaceConnect.textContent=linked?'Reconnect':active==='gmail'?'Connect with Google':'Connect with Notion';workspaceDisconnect.hidden=!linked;workspaceSearch.hidden=active!=='notion'||!linked;workspaceDestination.textContent=active==='notion'?(workspace.notionParent?`Save under: ${workspace.notionParent.title}`:'Choose where to save your pages.'):'';workspacePages.replaceChildren();}
  $('#connect-calendar').hidden=linked;$('#edit-calendar').hidden=!linked;
  if(!linked)$('#calendar-edit').hidden=true;
 }
 for(const button of document.querySelectorAll('[data-service]')){
  const row=button.closest('.service-row');
  const open=()=>{trigger=button;active=button.dataset.service;homeScroll=$('.phone-content').scrollTop;$('#phone-home').hidden=true;$('#service-detail').hidden=false;$('#calendar-edit').hidden=true;render();$('.phone-content').scrollTop=0;$('#service-title').focus({preventScroll:true});};
  button.onclick=open;
  row.classList.add('service-openable');
  if(['search','gmail','notion'].includes(button.dataset.service))continue;
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
 return {setBusy(value){blocked=value;syncSwitches();},update(value,nextMode,nextEnabled=true,nextWebSearch=false,nextWorkspace={}){workspace=nextWorkspace;webSearch=nextWebSearch;calendar=value;mode=nextMode;enabled=nextEnabled;syncSwitches();render();}};
}
