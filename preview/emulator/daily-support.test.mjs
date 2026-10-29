import test from 'node:test';
import assert from 'node:assert/strict';
import {createDailySupport} from './daily-support.mjs';
const base={getSession:async()=>'phone-session',onDraft(){},uuid:()=>'stable-id'};
const lists=path=>path==='/v1/reminders'?{reminders:[]}:path==='/v1/drafts'?{drafts:[]}:{mode:'live',gmailDraftsEnabled:true};

test('briefing refresh includes timezone and preserves source availability',async()=>{
 const calls=[];const controller=createDailySupport({...base,api:async path=>{calls.push(path);return path.startsWith('/v1/briefing')?{summary:'Calendar unavailable.',sources:{calendar:'unavailable'},timeZone:'America/New_York'}:lists(path);}});
 await controller.refresh('America/New_York');
 assert.ok(calls.includes('/v1/briefing?timeZone=America%2FNew_York'));assert.equal(controller.state.briefing.sources.calendar,'unavailable');
});
test('failed reminder creation retries the same client identifier',async()=>{
 const ids=[];let attempts=0;
 const controller=createDailySupport({...base,api:async(path,options)=>{if(options?.method==='POST'){ids.push(options.body.id);if(++attempts===1)throw Error('connection lost');return {reminder:options.body};}return lists(path);}});
 const input={title:'Call back',dueAt:'2026-11-01T12:00:00Z',timeZone:'Europe/London',recurrence:'none'};
 await controller.addReminder(input);assert.match(controller.state.error,/connection lost/);await controller.addReminder(input);assert.deepEqual(ids,['stable-id','stable-id']);
});
test('failed refresh after a successful reminder save never repeats the create',async()=>{
 let creates=0,reads=0;
 const controller=createDailySupport({...base,api:async(path,options)=>{if(options?.method==='POST'){creates++;return {};}if(path==='/v1/reminders'&&++reads===1)throw Error('read failed');return lists(path);}});
 const input={title:'Call back',dueAt:'2026-11-01T12:00:00Z',timeZone:'Europe/London',recurrence:'daily'};
 await controller.addReminder(input);await controller.addReminder(input);assert.equal(creates,1);
});
test('reminder update and deletion address only the selected record',async()=>{
 const writes=[];const controller=createDailySupport({...base,api:async(path,options)=>{if(options)writes.push({path,...options});return lists(path);}});
 await controller.updateReminder('one',{status:'completed'});await controller.removeReminder('two');
 assert.deepEqual(writes,[{path:'/v1/reminders/one',method:'PATCH',body:{status:'completed'}},{path:'/v1/reminders/two',method:'DELETE'}]);
});
test('email preparation preserves exact input and only opens server-reviewed action',async()=>{
 const calls=[],shown=[],action={id:'draft',sessionId:'phone-session',to:'a@example.test',subject:'Exact subject',body:'First line\nSecond line',status:'pending'};
 const controller=createDailySupport({...base,onDraft:d=>shown.push(d),api:async(path,options)=>{calls.push({path,...options});return {gmailDraftAction:action};}});
 const input={to:action.to,subject:action.subject,body:action.body};await controller.prepareDraft(input);
 assert.deepEqual(calls,[{path:'/v1/sessions/phone-session/drafts',method:'POST',body:input}]);assert.deepEqual(shown,[action]);assert.equal(controller.state.drafts[0].status,'pending');
});
test('foreground booking approval cannot be replaced by a daily email draft',async()=>{
 let calls=0;const controller=createDailySupport({...base,canReview:()=>false,api:async()=>{calls++;}});
 await controller.prepareDraft({to:'a@example.test',subject:'Subject',body:'Body'});assert.equal(calls,0);assert.match(controller.state.error,/current approval/);
});
test('approval opened during email preparation is retained and email stays in list',async()=>{
 let allowed=true;const shown=[],action={id:'draft',sessionId:'phone-session',to:'a@example.test'};
 const controller=createDailySupport({...base,canReview:()=>allowed,onDraft:d=>shown.push(d),api:async()=>{allowed=false;return {gmailDraftAction:action};}});
 await controller.prepareDraft({to:'a@example.test',subject:'Subject',body:'Body'});assert.equal(shown.length,0);assert.equal(controller.state.drafts[0].id,'draft');assert.match(controller.state.notice,/remains in Today/);
});
test('review loads authoritative draft from its originating device session',async()=>{
 const calls=[],shown=[],action={id:'draft',sessionId:'watch-session',to:'a@example.test',status:'uncertain'};
 const controller=createDailySupport({...base,onDraft:d=>shown.push(d),api:async path=>{calls.push(path);return {action};}});
 await controller.reviewDraft(action);assert.deepEqual(calls,['/v1/sessions/watch-session/drafts/draft']);assert.deepEqual(shown,[action]);
});
test('Gmail upgrade explicitly requests drafts and validates Google destination',async()=>{
 const calls=[],popup={location:{},close(){this.closed=true;}};
 const controller=createDailySupport({...base,api:async(path,options)=>{calls.push({path,...options});return {url:'https://accounts.google.com/o/oauth2/auth?scope=drafts'};}});
 await controller.enableDrafts(()=>popup);assert.deepEqual(calls,[{path:'/v1/integrations/gmail/connect',method:'POST',body:{drafts:true}}]);assert.equal(new URL(popup.location.href).hostname,'accounts.google.com');assert.equal(popup.opener,null);
 const bad=createDailySupport({...base,api:async()=>({url:'https://accounts.google.com.evil.test/'})});
 await bad.enableDrafts(()=>popup);assert.equal(popup.closed,true);assert.match(bad.state.error,/Invalid sign-in/);
});
test('double submit is ignored while a reminder mutation is in flight',async()=>{
 let finish,creates=0;const gate=new Promise(resolve=>finish=resolve);
 const controller=createDailySupport({...base,api:async(path,options)=>{if(options?.method==='POST'){creates++;await gate;}return lists(path);}});
 const first=controller.addReminder({title:'One'});await controller.addReminder({title:'One'});assert.equal(creates,1);finish();await first;
});
