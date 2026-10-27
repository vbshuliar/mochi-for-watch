export function encodeWav(chunks,inputRate){
 const length=chunks.reduce((n,c)=>n+c.length,0),input=new Float32Array(length);let offset=0;
 for(const chunk of chunks){input.set(chunk,offset);offset+=chunk.length;}
 const rate=16000,count=Math.floor(length*rate/inputRate),buffer=new ArrayBuffer(44+count*2),view=new DataView(buffer);
 const text=(at,value)=>{for(let i=0;i<value.length;i++)view.setUint8(at+i,value.charCodeAt(i));};
 text(0,'RIFF');view.setUint32(4,36+count*2,true);text(8,'WAVE');text(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,count*2,true);
 for(let i=0;i<count;i++){
  const start=Math.floor(i*inputRate/rate),end=Math.max(start+1,Math.floor((i+1)*inputRate/rate));let value=0;
  for(let j=start;j<end&&j<input.length;j++)value+=input[j];value=Math.max(-1,Math.min(1,value/(end-start)));
  view.setInt16(44+i*2,value<0?value*32768:value*32767,true);
 }
 return new Blob([buffer],{type:'audio/wav'});
}
export class VoiceRecorder {
 constructor(onLevel,onLimit,onFailure,onChunk=()=>{}){this.onLevel=onLevel;this.onLimit=onLimit;this.onFailure=onFailure;this.onChunk=onChunk;this.generation=0;this.chunks=[];this.active=false;}
 async start(){
  this.cancel();const generation=this.generation;this.chunks=[];this.count=0;
  if(!navigator.mediaDevices?.getUserMedia||!window.AudioContext)throw new Error('Microphone recording is unavailable in this browser. You can type instead.');
  try{
   const context=new AudioContext({sampleRate:24000});this.context=context;
   const resumed=context.resume();void resumed.catch(()=>{});
   const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true},video:false});
   if(generation!==this.generation){stream.getTracks().forEach(track=>track.stop());return false;}
   this.stream=stream;await resumed;await context.audioWorklet.addModule(new URL('./pcm-worklet.js',import.meta.url));
   if(generation!==this.generation)return false;
   this.rate=context.sampleRate;this.source=context.createMediaStreamSource(stream);this.node=new AudioWorkletNode(context,'muse-pcm');this.gain=context.createGain();this.gain.gain.value=0;
   this.source.connect(this.node);this.node.connect(this.gain);this.gain.connect(context.destination);
   this.node.port.onmessage=event=>{
    if(generation!==this.generation)return;
    if(event.data.done){this.flushed?.();return;}
    const samples=event.data.samples;if(!(samples instanceof Float32Array))return;
    const remaining=Math.max(0,this.rate*60-this.count),chunk=samples.slice(0,remaining);
    if(chunk.length){this.chunks.push(chunk);this.count+=chunk.length;this.onChunk(chunk,this.rate);}
    let sum=0;for(const sample of samples)sum+=sample*sample;
    this.onLevel(Math.min(1,Math.max(0,(Math.sqrt(sum/samples.length)-.003)*14)));
    if(this.active&&this.count>=this.rate*60){this.active=false;this.onLimit();}
   };
   stream.getTracks().forEach(track=>track.addEventListener('ended',()=>{if(generation!==this.generation)return;this.cancel();this.onFailure('Microphone disconnected. Please record again.');}));
   this.active=true;return true;
  }catch(error){if(generation===this.generation)this.cancel();throw error;}
 }
 async finish(){
  if(!this.node)throw new Error('No recording to send.');
  this.active=false;
  try{
   await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Recording could not finish. Please record again.')),2000);this.flushed=()=>{clearTimeout(timeout);resolve();};this.node.port.postMessage('finish');});
   if(this.count<this.rate*.25)throw new Error('That was too short. Hold a thought for a moment, then try again.');
   return encodeWav(this.chunks,this.rate);
  }finally{this.cancel();}
 }
 cancel(){
  this.generation++;this.active=false;this.stream?.getTracks().forEach(track=>track.stop());this.source?.disconnect();this.node?.disconnect();this.gain?.disconnect();
  if(this.context&&this.context.state!=='closed')void this.context.close().catch(()=>{});
  this.stream=this.source=this.node=this.gain=this.context=null;this.chunks=[];this.onLevel(0);
 }
}
