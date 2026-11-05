import test from 'node:test';
import assert from 'node:assert/strict';
import {voiceBinderTopics,spokenBinderTopic} from './voiceBinderTopics.mjs';
test('automatic divider following highlights immediately without waiting for a specialist reload',async()=>{
 const shown=[];let switches=0,turn=1;
 const control=voiceBinderTopics({getTurn:()=>turn,canApply:()=>true,getGuide:()=> 'planning',followGuide:false,highlight:topics=>{shown.push(topics);return true;},switchGuide:()=>{switches++;return new Promise(()=>{});}});
 assert.equal(await control.update(['applications'],1),true);assert.equal(switches,0);assert.deepEqual(shown.at(-1),['applications']);
 turn=2;assert.equal(await control.update(['costs'],1),false);assert.deepEqual(shown.at(-1),['applications']);control.stop();assert.equal(await control.update(['costs'],2),false);
});

test('a new specialty waits for its teaching update and does not replace a newer topic',async()=>{
 let turn=1,guide='planning',release;const shown=[],changes=[];
 const control=voiceBinderTopics({getTurn:()=>turn,canApply:()=>true,getGuide:()=>guide,highlight:topics=>{shown.push(topics);return true;},switchGuide:async(next,topic)=>{changes.push([next,topic]);await new Promise(resolve=>{release=resolve;});guide=next;return true;}});
 let complete=false;const pending=control.update(['applications'],1).then(()=>{complete=true;});
 await new Promise(resolve=>setTimeout(resolve,0));assert.equal(complete,false);assert.deepEqual(changes,[['admissions','applications']]);
 turn=2;control.stop();release();await pending;assert.deepEqual(shown,[['applications']]);
});

for(const [words,topic] of [['Help me with my PIQs','applications'],['Quiero hablar de mi ensayo','applications'],['What is financial aid?','costs'],['Necesito ayuda financiera','costs'],['Let us discuss transfer','transfer'],['Mis cr\u00e9ditos universitarios','transfer'],['Compare majors','options'],['opciones universitarias','options'],['My essay about financial aid',null],['Tell me more',null]])test(`local divider hint: ${words}`,()=>assert.equal(spokenBinderTopic(words),topic));
