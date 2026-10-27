import {SpeechPlayer} from './speech.mjs';
const player=new SpeechPlayer(),button=document.querySelector('#play'),status=document.querySelector('#status');
button.onclick=()=>{
 button.disabled=true;status.textContent='requesting Jessica…';
 void player.play('hey, I’m Jolly. good to see you! what shall we do today?',{
  onReady:()=>{status.textContent='audio received · starting playback…';},
  onStart:()=>{status.textContent='playing Jessica · ElevenLabs';},
  onEnd:()=>{status.textContent='Jessica playback completed';button.disabled=false;},
  onError:error=>{status.textContent=`could not play Jessica: ${error.message}`;button.disabled=false;},
 });
};
window.addEventListener('pagehide',()=>player.stop());
