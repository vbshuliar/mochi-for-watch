import test from 'node:test';
import assert from 'node:assert/strict';
import {reactionFor} from './reactions.mjs';
test('direct compliments trigger the heart reaction',()=>{
 for(const text of ["you're so cute",'Mochi is adorable','You are really helpful','I love you, Mochi','Hey, Mochi, I really love you.','I absolutely love you','love you, Mochi','You’re the best!','good job Mochi'])assert.equal(reactionFor(text),'loved',text);
});
test('ordinary requests, third-party praise and negative phrases do not trigger hearts',()=>{
 for(const text of ['schedule lunch','my dog is cute',"you are not helpful","I don't think you are cute","I don't really love you",'what a wonderful day',''])assert.equal(reactionFor(text),null,text);
});
test('response and context select different conversational reactions',()=>{
 assert.equal(reactionFor('I passed my exam!','Congratulations, that’s wonderful!'),'delighted');
 assert.equal(reactionFor('I found an old coin.','Wow, what an unexpected find!'),'surprised');
 assert.equal(reactionFor('I want to try a hobby.','What do you enjoy doing?'),'curious');
 assert.equal(reactionFor('Use the other one.','Did you mean the earlier option?'),'confused');
 assert.equal(reactionFor('Tomorrow.','What time tomorrow?','clarify'),'curious');
 assert.equal(reactionFor('Hello Mochi!','hello, happy to see you'),'delighted');
});
test('serious context and workflow states override cheerful triggers',()=>{
 assert.equal(reactionFor('My dog died. You are so sweet.','I’m sorry to hear that.'),null);
 assert.equal(reactionFor('I never passed the exam.','Let’s try again.'),null);
 assert.equal(reactionFor('You are amazing','could not save','error'),null);
 assert.equal(reactionFor('Good job','add this event?','approval'),null);
 assert.equal(reactionFor('What is two plus two?','four'),null);
});
