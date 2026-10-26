'use strict';
// Local amplitude analysis only: no recorder, upload, or connection to the backend.
class MuseMicrophone {
 constructor(onStatus=()=>{}){this.onStatus=onStatus;this.generation=0;this.status='off';this.level=0;this.bands=Array(9).fill(0);}
 stop(){
  this.generation++;this.stream?.getTracks().forEach(track=>track.stop());
  this.source?.disconnect();this.analyser?.disconnect();
  if(this.context&&this.context.state!=='closed')void this.context.close().catch(()=>{});
  this.stream=this.source=this.analyser=this.context=null;
  this.level=0;this.bands.fill(0);this.status='off';
 }
 async start(){
  this.stop();const generation=this.generation;
  const Audio=window.AudioContext||window.webkitAudioContext;
  if(typeof navigator==='undefined'||!navigator.mediaDevices?.getUserMedia||!Audio){this.status='unavailable';this.onStatus(this.status);return;}
  this.status='pending';this.onStatus(this.status);
  try{
   const context=new Audio();this.context=context;
   // Resume during the user-triggered start when possible; never route input to speakers.
   const resumed=context.resume();void resumed.catch(()=>{});
   const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:false},video:false});
   if(generation!==this.generation){stream.getTracks().forEach(track=>track.stop());return;}
   this.stream=stream;await resumed;
   if(generation!==this.generation)return;
   const analyser=context.createAnalyser();analyser.fftSize=1024;analyser.smoothingTimeConstant=.65;
   this.source=context.createMediaStreamSource(stream);this.source.connect(analyser);this.analyser=analyser;
   this.samples=new Float32Array(analyser.fftSize);this.spectrum=new Uint8Array(analyser.frequencyBinCount);
   stream.getAudioTracks().forEach(track=>track.addEventListener('ended',()=>{
    if(generation!==this.generation)return;this.stop();this.status='unavailable';this.onStatus(this.status);
   }));
   this.status='active';this.onStatus(this.status);
  }catch(error){
   if(generation!==this.generation)return;
   this.stop();this.status=error?.name==='NotAllowedError'?'denied':'unavailable';this.onStatus(this.status);
  }
 }
 sample(){
  if(this.status!=='active'||!this.analyser)return;
  this.analyser.getFloatTimeDomainData(this.samples);this.analyser.getByteFrequencyData(this.spectrum);
  let sum=0;for(const value of this.samples)sum+=value*value;
  const rms=Math.sqrt(sum/this.samples.length),target=Math.min(1,Math.max(0,(rms-.003)*14));
  this.level+=(target-this.level)*(target>this.level?.55:.2);
  for(let i=0;i<9;i++){
   const low=120*Math.pow(4200/120,i/9),high=120*Math.pow(4200/120,(i+1)/9);
   const first=Math.max(1,Math.floor(low*this.analyser.fftSize/this.context.sampleRate));
   const last=Math.min(this.spectrum.length,Math.ceil(high*this.analyser.fftSize/this.context.sampleRate));
   let energy=0;for(let bin=first;bin<last;bin++)energy+=this.spectrum[bin]/255;
   const amplitude=last>first?Math.min(1,energy/(last-first)*2)*this.level:0;
   this.bands[i]+=(amplitude-this.bands[i])*.35;
  }
 }
}
