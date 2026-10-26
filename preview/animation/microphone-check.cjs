const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function fixture(getMedia){
 let level=0,stops=0,closes=0;
 const track={stop(){stops++;},addEventListener(){}};
 const stream={getTracks:()=>[track],getAudioTracks:()=>[track]};
 class AudioContext{
  constructor(){this.sampleRate=48000;this.state='running';}
  resume(){return Promise.resolve();}close(){closes++;this.state='closed';return Promise.resolve();}
  createMediaStreamSource(){return {connect(){},disconnect(){}};}
  createAnalyser(){return {fftSize:1024,frequencyBinCount:512,disconnect(){},getFloatTimeDomainData(data){data.fill(level);},getByteFrequencyData(data){data.fill(level?180:0);}};}
 }
 const ctx=vm.createContext({window:{AudioContext},navigator:{mediaDevices:{getUserMedia:getMedia||(()=>Promise.resolve(stream))}},Float32Array,Uint8Array});
 vm.runInContext(fs.readFileSync(__dirname+'/microphone.js','utf8'),ctx);const mic=vm.runInContext('new MuseMicrophone()',ctx);
 return {mic,stream,setLevel(v){level=v;},stops:()=>stops,closes:()=>closes};
}
test('bars reflect input and decay to silence; stopping releases hardware',async()=>{const f=fixture();await f.mic.start();assert.equal(f.mic.status,'active');f.mic.sample();assert(f.mic.bands.every(v=>v===0));f.setLevel(.05);for(let i=0;i<20;i++)f.mic.sample();assert(f.mic.bands.some(v=>v>.1));f.setLevel(0);for(let i=0;i<100;i++)f.mic.sample();assert(f.mic.bands.every(v=>v<.001));f.mic.stop();assert.equal(f.stops(),1);assert.equal(f.closes(),1);});
test('late permission grant after exit cannot leave microphone running',async()=>{let resolve;const f=fixture(()=>new Promise(r=>resolve=r));const pending=f.mic.start();f.mic.stop();resolve(f.stream);await pending;assert.equal(f.stops(),1);assert.equal(f.mic.status,'off');});
test('permission denial reports failure without synthetic activity',async()=>{const f=fixture(async()=>{throw Object.assign(new Error(),{name:'NotAllowedError'});});await f.mic.start();assert.equal(f.mic.status,'denied');assert(f.mic.bands.every(v=>v===0));assert.equal(f.closes(),1);});
