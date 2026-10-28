const catalog={
 calendar:{name:'Google Calendar',title:'Calendar',description:'Let Jolly access your calendar to view meetings, find free time and add events.',access:['View meetings and free time','Add events with your approval']},
 instagram:{name:'Instagram',title:'Instagram',description:'Let Jolly help with Instagram posts, comments and replies.',access:['View posts and comments','Draft reply suggestions']},
 facebook:{name:'Facebook Pages',title:'Facebook Pages',description:'Let Jolly follow page activity and help with replies.',access:['View page activity','Help draft replies']},
 notion:{name:'Notion',title:'Notion Workspace',description:'Let Jolly turn ideas and email summaries into Notion pages.',access:['Choose a destination page','Create pages with your approval']},
 gmail:{name:'Gmail',title:'Gmail Inbox',description:'Let Jolly find and summarize your email. It cannot send or delete messages.',access:['Find and summarise emails','Read-only access']},
 search:{name:'web search',title:'Web Search',description:'Let Jolly search the web and bring back answers with sources.',access:['Search the web','Include sources']}
};
const providers=['gmail','notion','instagram','facebook'];
const socialProviders=['instagram','facebook'];
export function providerSignInURL(provider,url){
 const host={gmail:'accounts.google.com',notion:'api.notion.com',instagram:'www.facebook.com',facebook:'www.facebook.com'}[provider];
 const parsed=new URL(url);
 if(!host||parsed.protocol!=='https:'||parsed.hostname!==host||parsed.username||parsed.password||parsed.port)throw Error('Invalid sign-in link');
 return parsed.href;
}
export function setupServices(onToggle,{api,refresh}={}){
 const $=s=>document.querySelector(s);
 let active=null,calendar='unknown',mode='live',trigger=null,homeScroll=0,enabled=true,externalBusy=false,operationBusy=false,webSearch=false,workspace={};
 const switches=[],errors={},pages={},accounts={},pendingSignIn=new Set();
 const busy=()=>externalBusy||operationBusy;
 const controls=document.createElement('div'),connect=document.createElement('button'),disconnect=document.createElement('button'),destination=document.createElement('p'),search=document.createElement('form'),query=document.createElement('input'),find=document.createElement('button'),choices=document.createElement('div'),error=document.createElement('p'),reload=document.createElement('button');
 controls.className='service-provider-controls';controls.hidden=true;connect.className='phone-primary';disconnect.className='phone-secondary service-disconnect';reload.className='phone-secondary';destination.className='service-destination';search.className='service-page-search';find.className='phone-secondary';choices.className='service-choices';error.className='service-feedback';disconnect.textContent='Disconnect';query.placeholder='Find a shared Notion page';query.setAttribute('aria-label','Find a shared Notion page');query.maxLength=100;find.textContent='Find pages';reload.textContent='Refresh accounts';error.setAttribute('role','status');search.append(query,find);controls.append(connect,disconnect,destination,search,reload,choices,error);$('#service-detail').append(controls);
 async function operate(provider,fn){
  if(busy()||!api)return;
  operationBusy=true;errors[provider]='';syncSwitches();render();
  try{await fn();}catch(e){errors[provider]=e.message||'Could not finish. Please try again.';}
  finally{operationBusy=false;syncSwitches();render();}
 }
 async function loadAccounts(provider){
  const data=await api(`/v1/integrations/${provider}/accounts`);
  accounts[provider]=data.accounts;
  pendingSignIn.delete(provider);
 }
 connect.onclick=()=>{
  if(busy()||!api)return;
  const provider=active,popup=window.open('about:blank','_blank');
  if(popup)popup.opener=null;
  void operate(provider,async()=>{
   try{
    if(!popup)throw Error('Allow popups and try again.');
    const {url}=await api(`/v1/integrations/${provider}/connect`,{method:'POST',body:{}});
    popup.location.href=providerSignInURL(provider,url);pendingSignIn.add(provider);
   }catch(e){popup?.close();throw e;}
  });
 };
 disconnect.onclick=()=>{
  if(busy())return;const provider=active;
  if(!confirm('Disconnect this service?'))return;
  void operate(provider,async()=>{await api(`/v1/integrations/${provider}`,{method:'DELETE'});delete accounts[provider];delete pages[provider];pendingSignIn.delete(provider);await refresh();});
 };
 search.onsubmit=e=>{
  e.preventDefault();const provider=active,searchQuery=query.value;
  void operate(provider,async()=>{
   const data=await api('/v1/integrations/notion/pages/search',{method:'POST',body:{query:searchQuery}});
   pages.notion=data.pages;errors.notion=data.pages.length?(data.hasMore?'More pages available; narrow your search.':''):'No shared pages found. Share a page with Jolly in Notion and try again.';
  });
 };
 reload.onclick=()=>{const provider=active;void operate(provider,async()=>{await refresh();await loadAccounts(provider);});};
 function syncSwitches(){
  for(const key of providers){const row=$(`[data-service="${key}"]`)?.closest('.service-row');row?.classList.toggle('service-linked',workspace[key]==='connected');row?.querySelector('.service-dot')?.setAttribute('aria-label',workspace[key]==='connected'?'connected':'not connected');}
  const searchRow=$('[data-service="search"]')?.closest('.service-row');
  if(searchRow){searchRow.classList.toggle('service-linked',webSearch);searchRow.querySelector('.service-dot')?.setAttribute('aria-label',webSearch?'available through Meta':'unavailable');}
  for(const {input} of switches){const ready=calendar==='connected'||calendar==='simulated';input.closest('.service-row').classList.toggle('service-linked',ready);input.checked=ready&&enabled;input.disabled=!ready||busy();input.title=ready?'Allow Jolly to use this service':'Connect this service first';}
 }
 function render(){
  if(!active)return;
  const provider=active,entry=catalog[provider],isCalendar=provider==='calendar',isProvider=providers.includes(provider),isSocial=socialProviders.includes(provider),linked=isCalendar?calendar==='connected':workspace[provider]==='connected';
  $('#service-title').textContent=entry.title;
  $('#service-status').textContent=provider==='search'?(webSearch?'available through Meta':'unavailable'):isCalendar?(mode==='mock'?'just a practice calendar':linked?(enabled?'connected · enabled':'connected · disabled'):calendar==='unknown'?'let me check…':'not connected'):linked?'connected':'not connected';
  $('#service-status').classList.toggle('is-connected',linked||(provider==='search'&&webSearch));
  $('#service-description').textContent=entry.description;
  $('#service-access').replaceChildren(...entry.access.map(text=>{const li=document.createElement('li');li.textContent=text;return li;}));
  $('#service-availability').textContent=provider==='search'?(webSearch?'Ask Jolly for current information. No extra sign-in needed.':'Web search is unavailable right now.'):isCalendar?'Disconnect anytime. Your events stay unchanged.':isSocial?'Choose an account after signing in. Disconnect anytime.': 'Disconnect anytime. Existing email and pages stay unchanged.';
  $('#calendar-detail-controls').hidden=!isCalendar;$('#planned-controls').hidden=true;controls.hidden=!isProvider;
  if(isProvider){
   connect.textContent=linked?'Reconnect':provider==='gmail'?'Connect with Google':provider==='notion'?'Connect with Notion':'Connect with Facebook';
   disconnect.hidden=!linked&&!accounts[provider];search.hidden=provider!=='notion'||!linked;reload.hidden=!isSocial;
   const selected=workspace.socialAccounts?.[provider];
   destination.textContent=provider==='notion'?(workspace.notionParent?`Save under: ${workspace.notionParent.title}`:'Choose where to save your pages.'):isSocial?(selected?`Selected account: ${selected.name}`:'Choose an account to finish connecting.') :'';
   choices.replaceChildren();
   for(const item of (isSocial?accounts[provider]:provider==='notion'?pages.notion:[])||[]){
    const button=document.createElement('button');button.className='service-choice';button.textContent=item.name||item.title;button.disabled=busy();
    if(isSocial)button.setAttribute('aria-pressed',String(selected?.id===item.id));
    button.onclick=()=>void operate(provider,async()=>{await api(isSocial?`/v1/integrations/${provider}/account`:'/v1/integrations/notion/destination',{method:'PUT',body:{id:item.id}});await refresh();});choices.append(button);
   }
   error.textContent=errors[provider]||(pendingSignIn.has(provider)&&!linked?'Finish sign-in in the opened tab. If you cancelled or access was denied, try connecting again.':isSocial&&accounts[provider]?.length===0?'No eligible accounts found. Check your account access and reconnect.':'');
   connect.disabled=disconnect.disabled=find.disabled=reload.disabled=query.disabled=busy()||!api;
  }
  $('#connect-calendar').hidden=linked;$('#edit-calendar').hidden=!linked;
  if(!linked)$('#calendar-edit').hidden=true;
 }
 function refreshSocial(){const provider=active;if(socialProviders.includes(provider))void operate(provider,()=>loadAccounts(provider));}
 for(const button of document.querySelectorAll('[data-service]')){
  const row=button.closest('.service-row');
  button.onclick=()=>{trigger=button;active=button.dataset.service;homeScroll=$('.phone-content').scrollTop;$('#phone-home').hidden=true;$('#service-detail').hidden=false;$('#calendar-edit').hidden=true;render();$('.phone-content').scrollTop=0;$('#service-title').focus({preventScroll:true});refreshSocial();};
  row.classList.add('service-openable');
  if(button.dataset.service!=='calendar')continue;
  const label=document.createElement('label');label.className='service-switch';
  const input=document.createElement('input');input.type='checkbox';input.setAttribute('role','switch');input.setAttribute('aria-label',`Enable ${catalog.calendar.name}`);
  const track=document.createElement('span');track.className='switch-track';track.setAttribute('aria-hidden','true');label.append(input,track);row.append(label);switches.push({input});
  input.onchange=()=>{const next=input.checked;void operate('calendar',()=>onToggle(next));};
 }
 window.addEventListener('focus',refreshSocial);
 $('#service-back').onclick=()=>{active=null;$('#service-detail').hidden=true;$('#phone-home').hidden=false;$('.phone-content').scrollTop=homeScroll;trigger?.focus({preventScroll:true});};
 $('#edit-calendar').onclick=()=>{$('#calendar-edit').hidden=!$('#calendar-edit').hidden;};
 $('#calendar-reconnect').onclick=()=>$('#connect-calendar').click();syncSwitches();
 return {setBusy(value){externalBusy=value;syncSwitches();render();},update(value,nextMode,nextEnabled=true,nextWebSearch=false,nextWorkspace={}){workspace=nextWorkspace;webSearch=nextWebSearch;calendar=value;mode=nextMode;enabled=nextEnabled;syncSwitches();render();}};
}
