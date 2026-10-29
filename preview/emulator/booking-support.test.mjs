import test from 'node:test';
import assert from 'node:assert/strict';
import {createBookingSupport} from './booking-support.mjs';
const call={id:'call',sessionId:'source',booking:{destinationName:'Salon'}};
test('retry proposes using source session and never calls approval endpoint',async()=>{
 const requests=[],reviews=[];const c=createBookingSupport({api:async(path,options)=>{requests.push([path,options]);return {callAction:{id:'new'}};},onCall:x=>reviews.push(x)});
 await c.retry(call,{start:'2030-01-01T12:00Z',end:'2030-01-01T14:00Z'});
 assert.equal(requests[0][0],'/v1/sessions/source/calls/call/retry');assert.equal(requests.length,1);assert.equal(reviews[0].id,'new');
});
test('existing approval blocks retry; intervening approval preserves new proposal for Tasks',async()=>{
 let allowed=false,writes=0,reviews=0;const c=createBookingSupport({canReview:()=>allowed,api:async()=>{writes++;allowed=false;return {callAction:{id:'new'}};},onCall:()=>reviews++});
 await c.retry(call,{});assert.equal(writes,0);allowed=true;await c.retry(call,{});assert.equal(writes,1);assert.equal(reviews,0);assert.match(c.state.notice,/saved in Tasks/);
});
test('booking reminder retries keep stable id and exact time, no inferred travel interval',async()=>{
 const requests=[];let failures=1;const c=createBookingSupport({uuid:()=> 'stable',api:async(path,options)=>{requests.push([path,options]);if(failures--)throw Error('lost response');return {};},onCall(){}});
 for(let n=0;n<2;n++)await c.remind(call,'2030-01-01T11:00:00Z','UTC');
 assert.equal(requests[0][0],'/v1/sessions/source/calls/call/reminder');assert.deepEqual(requests[0][1].body,requests[1][1].body);assert.equal(requests[0][1].body.dueAt,'2030-01-01T11:00:00Z');
});
test('profile save requires explicit action and read errors stay visible',async()=>{
 const methods=[];const c=createBookingSupport({api:async(path,options)=>{methods.push(options?.method||'GET');if(path==='/v1/readiness')throw Error('unavailable');return path==='/v1/tasks'?{calls:[]}:{profile:{destinationName:'Salon',updatedAt:1}};},onCall(){}});
 await c.refresh();assert.deepEqual(methods,['GET','GET','GET']);assert.match(c.state.error,/unavailable/);await c.saveProfile({destinationName:'Salon'});assert.equal(methods.at(-1),'PUT');
});

test('booking form retains each call dates after failed requests and retries identical reminder',async()=>{
 const {setupBookingSupport}=await import('./booking-support.mjs');
 const previous=globalThis.document;
 class Element {
  constructor(tag){this.tag=tag;this.children=[];this.value='';this.listeners={};}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=nodes;}
  setAttribute(){}
  addEventListener(name,fn){this.listeners[name]=fn;}
 }
 const home=new Element('div');
 globalThis.document={createElement:tag=>new Element(tag),querySelector:()=>home};
 const walk=node=>[node,...node.children.flatMap(walk)];
 const dates=()=>walk(home).filter(n=>n.type==='datetime-local');
 const click=async text=>{walk(home).find(n=>n.tag==='button'&&n.textContent===text).onclick();await new Promise(resolve=>setImmediate(resolve));};
 try {
  const requests=[];
  const calls=[{...call,followUp:{canAddReminder:true,canRetry:true,message:'Ready'}},{...call,id:'other',followUp:{canAddReminder:true,message:'Ready'}}];
  const controller=setupBookingSupport({uuid:()=> 'stable-id',onCall(){},api:async(path,options)=>{
   if(options?.method==='POST'){requests.push({path,...options});throw Error('response lost');}
   return path==='/v1/tasks'?{calls}:path==='/v1/booking-profile'?{profile:null}:null;
  }});
  await controller.refresh();
  const values=['2030-01-01T11:00','2030-01-02T12:00','2030-01-02T14:00','2030-01-03T11:00'];
  dates().forEach((input,i)=>{input.value=values[i];input.listeners.input();});
  await click('Save appointment reminder');
  assert.match(controller.state.error,/response lost/);
  assert.deepEqual(dates().map(n=>n.value),values);
  await click('Save appointment reminder');
  assert.deepEqual(requests[0],requests[1]);
  await click('Prepare another call for review');
  assert.equal(requests[2].path,'/v1/sessions/source/calls/call/retry');
  assert.deepEqual(dates().map(n=>n.value),values);
  await controller.refresh();
  assert.deepEqual(dates().map(n=>n.value),values);
 } finally {globalThis.document=previous;}
});
