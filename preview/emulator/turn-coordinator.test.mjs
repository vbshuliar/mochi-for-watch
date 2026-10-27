import test from 'node:test';
import assert from 'node:assert/strict';
import {TurnCoordinator} from './turn-coordinator.mjs';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
test('interrupting a request suppresses its result and serializes the next request',async()=>{
 const turns=new TurnCoordinator(),slow=deferred(),calls=[];
 const old=turns.begin(),first=turns.run(old,()=>{calls.push('first');return slow.promise;});
 await Promise.resolve();const next=turns.begin();
 const second=turns.run(next,async()=>{calls.push('second');return 'new reply';});
 await Promise.resolve();assert.deepEqual(calls,['first']);
 slow.resolve('old reply');assert.equal(await first,undefined);assert.equal(await second,'new reply');assert.deepEqual(calls,['first','second']);
});
test('rapid interruptions skip queued obsolete requests',async()=>{
 const turns=new TurnCoordinator(),slow=deferred();
 const first=turns.run(turns.begin(),()=>slow.promise);await Promise.resolve();
 let staleCalled=false;const stale=turns.run(turns.begin(),()=>{staleCalled=true;});
 const latest=turns.run(turns.begin(),async()=>42);slow.resolve(0);
 await first;await stale;assert.equal(await latest,42);assert.equal(staleCalled,false);
});
test('errors release the queue and hiding the page revokes all callbacks',async()=>{
 const turns=new TurnCoordinator(),slow=deferred(),ticket=turns.begin();
 const old=turns.run(ticket,()=>slow.promise);await Promise.resolve();turns.invalidate();
 slow.reject(new Error('offline'));await assert.rejects(old,/offline/);assert.equal(turns.current(ticket),false);
 assert.equal(await turns.run(turns.begin(),async()=> 'recovered'),'recovered');
});
