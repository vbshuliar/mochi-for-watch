// Require sustained voice before silence can finish a turn; ignore isolated clicks.
export class EndOfSpeech {
 constructor(){this.reset();}
 reset(){this.lastSample=null;this.voiceMs=0;this.lastVoice=null;this.finished=false;}
 sample(level,now){
  const elapsed=this.lastSample===null?0:Math.min(200,Math.max(0,now-this.lastSample));
  this.lastSample=now;
  if(this.finished)return false;
  if(level>=.07){this.voiceMs+=elapsed;this.lastVoice=now;}
  else if(this.voiceMs<250&&this.lastVoice!==null&&now-this.lastVoice>500){this.voiceMs=0;}
  if(this.voiceMs>=250&&this.lastVoice!==null&&now-this.lastVoice>=1100){this.finished=true;return true;}
  return false;
 }
}
