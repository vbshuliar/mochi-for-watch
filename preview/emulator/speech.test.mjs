import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SpeechPlayer} from './speech.mjs';
const audioResponse=()=>new Response('ID3test',{headers:{'content-type':'audio/mpeg'}});
function fixture(fetchAudio=async()=>audioResponse()){
 let audio,revoked=0,starts=0,ends=0,errors=0;
 const player=new SpeechPlayer({fetchAudio,urls:{createObjectURL:()=> 'blob:test',revokeObjectURL:()=>revoked++},createAudio:()=>audio={pause(){},removeAttribute(){},load(){},async play(){this.onplaying();}}});
 const callbacks={onReady(){},onStart(){starts++;},onEnd(){ends++;},onError(){errors++;}};
 return {player,callbacks,get audio(){return audio;},stats:()=>({revoked,starts,ends,errors})};
}
test('playback follows actual audio and releases URL on completion',async()=>{
 const f=fixture();await f.player.play('hello',f.callbacks);assert.equal(f.stats().starts,1);f.audio.onended();assert.deepEqual(f.stats(),{revoked:1,starts:1,ends:1,errors:0});
});
test('interruption aborts fetch and never plays a late response',async()=>{
 let resolve,signal;const f=fixture((_url,init)=>{signal=init.signal;return new Promise(r=>resolve=r);});
 const pending=f.player.play('old reply',f.callbacks);f.player.stop();assert.equal(signal.aborted,true);resolve(audioResponse());await pending;assert.equal(f.stats().starts,0);assert.equal(f.stats().errors,0);
});
test('provider failure reports once without playing',async()=>{
 const f=fixture(async()=>new Response('{}',{status:502}));await f.player.play('hello',f.callbacks);assert.equal(f.stats().errors,1);assert.equal(f.stats().starts,0);
});
test('default fetch is not called with the player as its receiver',async t=>{
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});let calls=0;
 globalThis.fetch=function(){assert.equal(this,undefined);calls++;return Promise.resolve(audioResponse());};
 const player=new SpeechPlayer({createAudio:()=>({pause(){},removeAttribute(){},load(){},async play(){}}),urls:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}}});
 let error;await player.play('hello',{onReady(){},onStart(){},onEnd(){},onError:e=>{error=e;}});player.stop();assert.equal(error,undefined);assert.equal(calls,1);
});
