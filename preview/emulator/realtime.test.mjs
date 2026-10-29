import {test} from 'node:test';import assert from 'node:assert/strict';
import {PCMStream,RealtimeTranscriber} from './realtime.mjs';
test('stream resampling preserves duration across uneven chunks',()=>{
 for(const rate of [16000,24000,44100,48000]){
  const encoder=new PCMStream();let bytes=0;
  for(let i=0;i<rate;i+=137)bytes+=encoder.encode(new Float32Array(Math.min(137,rate-i)).fill(.25),rate).byteLength;
  assert.equal(bytes,48000);
 }
});
function fixture(){const sent=[],partials=[];let closed=false;
 const socket={bufferedAmount:0,send:data=>sent.push(data),close:()=>{closed=true;}};
 const stream=new RealtimeTranscriber({origin:'http://localhost',createSocket:()=>socket,onPartial:text=>partials.push(text)});
 const receive=data=>socket.onmessage({data:JSON.stringify(data)});
 return {stream,sent,partials,receive,socket,isClosed:()=>closed};
}
test('audio queues until ready, partials do not resolve, end follows final audio',async()=>{
 const f=fixture();f.stream.push(new Float32Array(100),24000);assert.equal(f.sent.length,0);
 f.receive({type:'ready'});assert.equal(f.sent[0].byteLength,200);f.receive({type:'partial',text:'hello'});assert.deepEqual(f.partials,['hello']);
 f.stream.push(new Float32Array(20),24000);const done=f.stream.finish();assert.equal(f.sent[1].byteLength,40);assert.deepEqual(JSON.parse(f.sent[2]),{type:'end'});
 f.receive({type:'final',text:'Hello Tuck.'});assert.equal(await done,'Hello Tuck.');assert(f.isClosed());
});
test('cancel and provider disconnect reject without submitting partial text',async()=>{
 const f=fixture();f.receive({type:'ready'});f.receive({type:'partial',text:'unfinished'});f.stream.cancel();await assert.rejects(f.stream.finish(),/cancelled/);
 const g=fixture();g.socket.onclose();await assert.rejects(g.stream.finish(),/before the final/);
});
test('stopping before the handshake still sends the queued audio before end',async()=>{
 const f=fixture();f.stream.push(new Float32Array(10),24000);const done=f.stream.finish();f.receive({type:'ready'});assert.equal(f.sent[0].byteLength,20);assert.deepEqual(JSON.parse(f.sent[1]),{type:'end'});f.receive({type:'final',text:'hi'});assert.equal(await done,'hi');
});
