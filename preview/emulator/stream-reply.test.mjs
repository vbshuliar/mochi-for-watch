import test from 'node:test';
import assert from 'node:assert/strict';
import {streamReply,SentenceSpeaker} from './stream-reply.mjs';
import {localIntent} from './local-intents.mjs';
test('local commands are narrow and never treat approval or factual questions as shortcuts',()=>{
 assert.equal(localIntent('Repeat that!'),'repeat');assert.equal(localIntent('Stop talking.'),'stop');
 for(const text of ['yes','cancel my meeting','what time is it','how are you','repeat that tomorrow','stop the meeting'])assert.equal(localIntent(text),null);
});
test('reply reader delivers text before final and rejects a broken stream',async()=>{
 const events=[];const fetcher=async()=>new Response('{"type":"text","text":"Hello. "}\n{"type":"result","result":{"speechText":"Hello. Again."}}\n');
 const result=await streamReply('s',{text:'hi',id:'t'},{fetcher,onText:t=>events.push(t)});assert.deepEqual(events,['Hello. ']);assert.equal(result.speechText,'Hello. Again.');
 await assert.rejects(streamReply('s',{text:'hi',id:'t'},{fetcher:async()=>new Response('{"type":"text","text":"Hello"}\n'),onText(){}}),/ended early/);
});
test('sentence prefetch overlaps playback, never plays out of order, and stops on interruption',async()=>{
 const requests=[],players=[];let ends=0;
 class Player{constructor(options){this.options=options;players.push(this);}async play(text,callbacks){this.text=text;this.callbacks=callbacks;await this.options.fetchAudio();}stop(){this.stopped=true;}}
 const speaker=new SentenceSpeaker({onStart(){},onBlocked(){},onEnd(){ends++;},onError:e=>assert.fail(e.message)},{Player,fetcher:async(_url,init)=>{requests.push({text:JSON.parse(init.body).text,signal:init.signal});return new Response('audio');}});
 speaker.add('First sentence. Second sentence');await new Promise(r=>setImmediate(r));assert.equal(players[0].text,'First sentence.');
 speaker.add('First sentence. Second sentence.',true);assert.equal(requests.length,2);assert.equal(players.length,1);
 players[0].callbacks.onEnd();await new Promise(r=>setImmediate(r));assert.equal(players[1].text,'Second sentence.');players[1].callbacks.onEnd();assert.equal(ends,1);
 speaker.stop();assert(requests.every(r=>r.signal.aborted));
});
