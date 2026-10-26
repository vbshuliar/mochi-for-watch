import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { encodeWav } from './audio.mjs';
for (const rate of [16000,48000]) test(`WAV preserves duration at ${rate} Hz`, async()=>{
 const blob=encodeWav([new Float32Array(rate).fill(.5)],rate);
 const view=new DataView(await blob.arrayBuffer());
 assert.equal(blob.type,'audio/wav');assert.equal(view.byteLength,32044);
 assert.equal(view.getUint32(24,true),16000);assert.equal(view.getUint16(22,true),1);
 assert.equal(view.getInt16(44,true),16383);
});
test('WAV clamps loud input without integer wraparound',async()=>{
 const view=new DataView(await encodeWav([Float32Array.of(-2,2)],16000).arrayBuffer());
 assert.equal(view.getInt16(44,true),-32768);assert.equal(view.getInt16(46,true),32767);
});
test('worklet flushes final partial buffer and stops collecting',async()=>{
 let Processor; const messages=[];
 class Base {constructor(){this.port={postMessage:m=>messages.push(m)};}}
 vm.runInNewContext(await readFile(new URL('./pcm-worklet.js',import.meta.url),'utf8'),{AudioWorkletProcessor:Base,Float32Array,registerProcessor:(_,p)=>Processor=p});
 const processor=new Processor();processor.process([[new Float32Array(2200).fill(.25)]]);
 processor.port.onmessage({data:'finish'});processor.process([[new Float32Array(128)]]);
 assert.deepEqual(messages.filter(m=>m.samples).map(m=>m.samples.length),[2048,152]);
 assert.equal(messages.at(-1).done,true);
});
