// Audio never persists to disk; each turn owns its request and object URL.
export class SpeechPlayer {
 constructor({fetchAudio=(...args)=>fetch(...args),createAudio=()=>new Audio(),urls=URL}={}){Object.assign(this,{fetchAudio,createAudio,urls});this.current=null;}
 stop(){
  const turn=this.current;this.current=null;if(!turn)return;
  clearTimeout(turn.timeout);turn.controller.abort();
  if(turn.audio){turn.audio.onplaying=turn.audio.onended=turn.audio.onerror=null;turn.audio.pause();turn.audio.removeAttribute('src');turn.audio.load();}
  if(turn.url)this.urls.revokeObjectURL(turn.url);
 }
 async play(text,{onReady,onStart,onEnd,onError,onBlocked}){
  this.stop();const turn={controller:new AbortController()};this.current=turn;
  const finish=error=>{if(this.current!==turn)return;this.stop();if(error)onError(error);else onEnd();};
  turn.finish=finish;turn.onBlocked=onBlocked;
  turn.timeout=setTimeout(()=>finish(new Error('voice playback timed out')),Math.max(30000,text.length*160));
  try{
   const response=await this.fetchAudio('/api/v1/speech',{method:'POST',headers:{'X-Muse-Emulator':'1','Content-Type':'application/json'},body:JSON.stringify({text}),signal:turn.controller.signal});
   if(!response.ok||!response.headers.get('content-type')?.includes('audio/'))throw new Error('ElevenLabs speech unavailable');
   const blob=await response.blob();if(this.current!==turn)return;
   onReady(blob.size);turn.url=this.urls.createObjectURL(blob);turn.audio=this.createAudio();
   turn.audio.onplaying=()=>{if(this.current===turn)onStart();};
   turn.audio.onended=()=>finish();turn.audio.onerror=()=>finish(new Error('audio playback failed'));
   turn.audio.src=turn.url;await this.resume();
  }catch(error){finish(error);}
 }
 async resume(){
  const turn=this.current;if(!turn?.audio)return;
  turn.blocked=false;
  try{await turn.audio.play();}
  catch(error){
   if(this.current!==turn)return;
   if(error.name==='NotAllowedError'&&turn.onBlocked){turn.blocked=true;turn.onBlocked();}
   else turn.finish(error);
  }
 }
}
