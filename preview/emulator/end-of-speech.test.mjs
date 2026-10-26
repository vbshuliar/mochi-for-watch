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
