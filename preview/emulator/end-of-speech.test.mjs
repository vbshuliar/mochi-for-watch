import test from 'node:test';
import assert from 'node:assert/strict';
import {EndOfSpeech} from './end-of-speech.mjs';
test('silence alone and isolated noise do not submit',()=>{
 const detector=new EndOfSpeech();
 for(let t=0;t<5000;t+=100)assert.equal(detector.sample(t===200?.2:0,t),false);
});
test('sentence pauses are allowed; trailing silence submits exactly once',()=>{
 const detector=new EndOfSpeech();
 for(let t=0;t<=1000;t+=100)assert.equal(detector.sample(t<500||t===1000?.2:0,t),false);
 for(let t=1100;t<2100;t+=100)assert.equal(detector.sample(0,t),false);
 assert.equal(detector.sample(0,2100),true);
 assert.equal(detector.sample(0,2200),false);
 detector.reset();assert.equal(detector.sample(0,5000),false);
});
test('short recognized answers end without needing a long utterance',()=>{
 const d=new EndOfSpeech();d.sample(0,0);d.sample(.2,100);d.partial('No.',150);
 assert.equal(d.sample(0,950),false);assert.equal(d.sample(0,1000),true);
});
test('incomplete phrases get time to continue and recent partials settle first',()=>{
 const d=new EndOfSpeech();for(let t=0;t<=400;t+=100)d.sample(.2,t);d.partial('Tomorrow at',450);
 assert.equal(d.sample(0,1400),false);d.sample(.2,1500);d.partial('Tomorrow at three',1600);
 assert.equal(d.sample(0,2200),false);assert.equal(d.sample(0,2400),true);
});
test('no-input timeout is local and reset clears prior speech',()=>{
 const d=new EndOfSpeech();d.sample(0,0);assert.equal(d.noInput(7999),false);assert.equal(d.noInput(8000),true);
 d.sample(.2,8100);d.partial('hello',8100);assert.equal(d.noInput(8200),false);
 d.reset();assert.equal(d.hasSpeech,false);assert.equal(d.transcript,'');
});
