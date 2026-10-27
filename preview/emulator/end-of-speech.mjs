// Acoustic endpointing with conservative transcript hints, not semantic VAD.
export class EndOfSpeech {
 constructor(){this.reset();}
 reset(){this.lastSample=null;this.startedAt=null;this.voiceMs=0;this.lastVoice=null;this.finished=false;this.transcript='';this.partialAt=null;this.noiseFloor=0;}
 partial(text,now){if(text.trim()!==this.transcript){this.transcript=text.trim();this.partialAt=now;}}
 get hasSpeech(){return this.voiceMs>=250 || (this.voiceMs>=80 && !!this.transcript);}
 noInput(now){return !this.hasSpeech&&this.startedAt!==null&&now-this.startedAt>=8000;}
 sample(level,now){
  if(this.startedAt===null)this.startedAt=now;
  const elapsed=this.lastSample===null?0:Math.min(200,Math.max(0,now-this.lastSample));this.lastSample=now;
  if(this.finished)return false;
  // Learn quiet background only; never learn the user's voice as the noise floor.
  if(level<.07)this.noiseFloor+=.05*(level-this.noiseFloor);
  const threshold=Math.max(.07,this.noiseFloor*2.5);
  if(level>=threshold){this.voiceMs+=elapsed;this.lastVoice=now;}
  else if(this.voiceMs<250&&!this.transcript&&this.lastVoice!==null&&now-this.lastVoice>500)this.voiceMs=0;
  const incomplete=/\b(and|or|but|because|with|to|at|for|the|a|um|uh)\s*[,.…]*$/i.test(this.transcript);
  const silence=incomplete?1700:this.transcript?900:1100;
  const transcriptSettled=this.partialAt===null||now-this.partialAt>=300;
  if(this.hasSpeech&&this.lastVoice!==null&&now-this.lastVoice>=silence&&transcriptSettled){this.finished=true;return true;}
  return false;
 }
}
