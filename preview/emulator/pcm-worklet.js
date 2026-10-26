class PCMCollector extends AudioWorkletProcessor {
 constructor(){super();this.buffer=new Float32Array(2048);this.used=0;this.recording=true;this.port.onmessage=event=>{if(event.data==='finish'){this.recording=false;this.flush();this.port.postMessage({done:true});}};}
 flush(){if(!this.used)return;const samples=this.buffer.slice(0,this.used);this.port.postMessage({samples},[samples.buffer]);this.used=0;}
 process(inputs){
  if(!this.recording)return true;
  const channel=inputs[0]?.[0];if(!channel)return true;
  for(const sample of channel){this.buffer[this.used++]=sample;if(this.used===this.buffer.length)this.flush();}
  return true;
 }
}
registerProcessor('muse-pcm',PCMCollector);
