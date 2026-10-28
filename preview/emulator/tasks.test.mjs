import test from 'node:test';
import assert from 'node:assert/strict';
import {taskGroups,installTaskSwipe} from './tasks.mjs';
test('recent activity uses terminal time, excludes unknown age and future tasks',()=>{
 const now=200000000;
 const groups=taskGroups([
  {id:'old',status:'completed',finishedAt:now-86400001},
  {id:'fresh',status:'completed',finishedAt:now-100},
  {id:'unknown',status:'completed',startedAt:now-100},
  {id:'future',status:'completed',finishedAt:now+100},
  {id:'running',status:'in_progress'},
  {id:'verify',status:'uncertain'},
 ],{id:'approval',status:'pending',event:{start:'2099-01-01'}},now);
 assert.deepEqual(groups['Recently completed'].map(t=>t.id),['fresh']);
 assert.deepEqual(groups['In progress'].map(t=>t.id),['running']);
 assert.deepEqual(groups['Needs you'].map(t=>t.id),['verify','approval']);
});
test('horizontal swipe changes page and swallows generated click; vertical scrolling does not',()=>{
 const listeners={},pages=[];installTaskSwipe({addEventListener:(name,fn)=>listeners[name]=fn},page=>pages.push(page));
 listeners.pointerdown({clientX:180,clientY:100});listeners.pointerup({clientX:40,clientY:105});
 let prevented=false,stopped=false;listeners.click({preventDefault(){prevented=true;},stopImmediatePropagation(){stopped=true;}});
 assert.deepEqual(pages,['tasks']);assert.ok(prevented&&stopped);
 listeners.pointerdown({clientX:40,clientY:105});listeners.pointerup({clientX:45,clientY:200});assert.equal(pages.length,1);
 listeners.pointerdown({clientX:40,clientY:100});listeners.pointerup({clientX:180,clientY:105});assert.deepEqual(pages,['tasks','jolly']);
});
test('fresh call collection status wins over an open review snapshot',()=>{
 const now=Date.now(),booking={destinationName:'Salon'};
 const groups=taskGroups([{id:'same',booking,status:'completed',finishedAt:now}],{id:'same',booking,status:'in_progress'},now);
 assert.equal(groups['In progress'].length,0);assert.equal(groups['Recently completed'].length,1);
 const expired=taskGroups([{id:'same',booking,status:'expired',finishedAt:now}],{id:'same',booking,status:'pending'},now);
 assert.equal(expired['Needs you'].length,0);assert.equal(expired['Recently completed'].length,1);
});
