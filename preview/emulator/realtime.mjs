export class PCMStream {
 constructor(){this.phase=0;this.sum=0;this.count=0;this.rate=null;}
 encode(samples,rate){
  if(this.rate!==null&&this.rate!==rate)throw new Error('Microphone sample rate changed');this.rate=rate;
  const values=[];
  for(const sample of samples){this.sum+=sample;this.count++;this.phase+=24000;
   if(this.phase>=rate){const value=Math.max(-1,Math.min(1,this.sum/this.count));while(this.phase>=rate){values.push(value<0?value*32768:value*32767);this.phase-=rate;}this.sum=0;this.count=0;}
  }
  const bytes=new ArrayBuffer(values.length*2),view=new DataView(bytes);values.forEach((value,i)=>view.setInt16(i*2,value,true));return bytes;
 }
}
export class RealtimeTranscriber {
 constructor({onPartial=()=>{},onFailure=()=>{},createSocket=url=>new WebSocket(url),origin=location.origin}={}){
  this.onPartial=onPartial;this.onFailure=onFailure;this.queue=[];this.queuedBytes=0;this.encoder=new PCMStream();this.ready=false;this.ended=false;this.closed=false;
  this.result=new Promise((resolve,reject)=>{this.resolve=resolve;this.reject=reject;});
  void this.result.catch(()=>{});
  this.timer=setTimeout(()=>this.fail(new Error('Live transcription connection timed out')),10000);
  try{this.socket=createSocket(origin.replace(/^http/,'ws')+'/api/v1/realtime');
   this.socket.onmessage=event=>{try{const data=JSON.parse(event.data);
    if(data.type==='ready'){this.ready=true;if(!this.ended)clearTimeout(this.timer);this.flush();}
    else if(data.type==='partial'&&typeof data.text==='string')this.onPartial(data.text);
    else if(data.type==='final'&&typeof data.text==='string'&&data.text.trim()&&this.ended){this.resolve(data.text);this.dispose();}
    else if(data.type==='error')this.fail(new Error('Live transcription unavailable'));
   }catch{this.fail(new Error('Invalid live transcript'));}};
   this.socket.onerror=()=>this.fail(new Error('Live transcription connection failed'));
   this.socket.onclose=()=>{if(!this.closed)this.fail(new Error('Live transcription ended before the final transcript'));};
  }catch(error){this.fail(error);}
 }
 push(samples,rate){
  if(this.closed||this.ended)return;
  try{const bytes=this.encoder.encode(samples,rate);this.queue.push(bytes);this.queuedBytes+=bytes.byteLength;
   if(this.queuedBytes>48000*10)throw new Error('Live transcription is not keeping up');this.flush();
  }catch(error){this.fail(error);}
 }
 flush(){
  if(!this.ready||this.closed)return;
  if(this.socket.bufferedAmount>256000){this.fail(new Error('Live transcription is not keeping up'));return;}
  for(const bytes of this.queue)this.socket.send(bytes);this.queue=[];this.queuedBytes=0;
  if(this.ended&&!this.endSent){this.endSent=true;this.socket.send(JSON.stringify({type:'end'}));}
 }
 finish(){
  if(!this.closed&&!this.ended){this.ended=true;clearTimeout(this.timer);this.timer=setTimeout(()=>this.fail(new Error('Final transcript timed out')),10000);this.flush();}
  return this.result;
 }
 fail(error){if(this.closed)return;this.reject(error);this.dispose();this.onFailure(error.message);}
 cancel(){if(this.closed)return;this.reject(new Error('Recording cancelled'));this.dispose();}
 dispose(){this.closed=true;clearTimeout(this.timer);this.queue=[];this.queuedBytes=0;if(this.socket){this.socket.onmessage=this.socket.onclose=this.socket.onerror=null;this.socket.close();}}
}
