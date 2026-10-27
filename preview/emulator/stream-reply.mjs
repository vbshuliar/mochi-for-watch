import {SpeechPlayer} from './speech.mjs';
export async function streamReply(sessionId,request,{signal,onText,fetcher=fetch}={}){
 const response=await fetcher(`/api/v1/sessions/${sessionId}/stream`,{method:'POST',headers:{'X-Muse-Emulator':'1','Content-Type':'application/json'},body:JSON.stringify({text:request.text,requestId:request.id}),signal});
 if(!response.ok)throw new Error('Could not start reply');
 const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',result;
 const line=text=>{if(!text.trim())return;const event=JSON.parse(text);if(event.type==='text')onText(event.text);else if(event.type==='result')result=event.result;else if(event.type==='error')throw Object.assign(new Error(event.message),{code:event.code});};
 try{while(true){const {done,value}=await reader.read();buffer+=done?decoder.decode():decoder.decode(value,{stream:true});if(buffer.length>100000)throw new Error('Reply too large');const lines=buffer.split('\n');buffer=lines.pop();for(const item of lines)line(item);if(done){if(buffer)line(buffer);break;}}if(!result)throw new Error('Reply ended early');return result;}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
// Prefetch bounded sentence clips while the previous sentence plays. Keep one
// speaking animation across clips; only finish once the full reply has arrived.
export class SentenceSpeaker{
 constructor(callbacks,{fetcher=(...args)=>fetch(...args),Player=SpeechPlayer}={}){this.callbacks=callbacks;this.fetcher=fetcher;this.Player=Player;this.sent='';this.queue=[];this.stopped=false;this.finished=false;this.playing=false;this.controller=new AbortController();}
 add(text,final=false){
  if(this.stopped||!text.startsWith(this.sent))return;
  let remaining=text.slice(this.sent.length);
  while(remaining){const match=/[.!?](?=\s)/.exec(remaining);let end=match?match.index+1:final?remaining.length:0;if(!end)break;
   const part=remaining.slice(0,end);this.sent+=part;remaining=remaining.slice(end);
   if(!part.trim())continue;if(this.queue.length>=16){this.stop();this.callbacks.onError(new Error('Reply too long'));return;}
   const ready=this.fetcher('/api/v1/speech',{method:'POST',headers:{'X-Muse-Emulator':'1','Content-Type':'application/json'},body:JSON.stringify({text:part.trim()}),signal:this.controller.signal}).then(async r=>{if(!r.ok)throw new Error('Voice unavailable');const blob=await r.blob();return ()=>new Response(blob,{headers:{'content-type':'audio/mpeg'}});});
   void ready.catch(()=>{});this.queue.push({text:part.trim(),ready});void this.pump();
  }
  if(final){this.finished=true;void this.pump();}
 }
 async pump(){
  if(this.playing||this.stopped)return;
  const next=this.queue.shift();if(!next){if(this.finished){this.finished=false;this.callbacks.onEnd();}return;}
  this.playing=true;
  this.player=new this.Player({fetchAudio:async()=>{const response=await next.ready;return response();}});
  await this.player.play(next.text,{onReady:()=>{},onStart:()=>{if(!this.stopped)this.callbacks.onStart();},onBlocked:()=>{if(!this.stopped)this.callbacks.onBlocked();},onEnd:()=>{this.playing=false;void this.pump();},onError:error=>{if(this.stopped)return;this.stop();this.callbacks.onError(error);}});
 }
 get blocked(){return this.player?.current?.blocked;}
 resume(){return this.player?.resume();}
 stop(){this.stopped=true;this.controller.abort();this.player?.stop();this.queue=[];}
}
