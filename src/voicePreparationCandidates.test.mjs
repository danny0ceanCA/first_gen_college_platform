import test from 'node:test';
import assert from 'node:assert/strict';
import {voicePreparationCandidates} from './voicePreparationCandidates.mjs';
import {createVoicePreparation} from './voicePreparation.mjs';

const input={mode:'planning',language:'en',role:'parent',studentId:'elodie',routeConversations:true,targetConfirmed:true};
const students=[{id:'elodie',name:'Elodie'},{id:'aiden',name:'Aiden'},{id:'third',name:'Third'}];

test('a spoken second-student selection can reuse its context without exposing it to the neutral opening',async()=>{
 const cache=createVoicePreparation(),candidates=voicePreparationCandidates(input,students);
 assert.equal(candidates.length,3);
 for(const candidate of candidates)await cache.warm('parent',candidate,async()=>({preparedContextId:candidate.studentId||'neutral'}));
 assert.equal(cache.consumeReady('parent',{...input,studentId:undefined,targetConfirmed:false}),'neutral');
 assert.equal(cache.consumeReady('parent',{...input,studentId:'aiden',targetConfirmed:false}),undefined);
 assert.equal(cache.consumeReady('parent',{...input,studentId:'aiden'}),'aiden');
 assert.equal(cache.consumeReady('parent',input),'elodie');
 assert.equal(cache.consumeReady('parent',{...input,studentId:'third'}),undefined);
 cache.clear();
});

test('preparation stays bounded and cannot add an unknown selection or unnamed alternate',()=>{
 assert.deepEqual(voicePreparationCandidates({...input,studentId:'not-in-family'},students),[]);
 assert.deepEqual(voicePreparationCandidates(input,[students[0],{id:'blank',name:' '},{id:'elodie',name:'Duplicate'},students[1]]).map(scope=>scope.studentId),[undefined,'elodie','aiden']);
 assert.deepEqual(voicePreparationCandidates({...input,role:'student',routeConversations:false},students).map(scope=>scope.studentId),['elodie']);
});

test('warming the alternate does not weaken account, language, or invalidation guards',async()=>{
 const cache=createVoicePreparation(),candidate=voicePreparationCandidates(input,students)[2];
 await cache.warm('parent',candidate,async()=>({preparedContextId:'second-student'}));
 assert.equal(cache.consumeReady('someone-else',candidate),undefined);
 assert.equal(cache.consumeReady('parent',{...candidate,language:'es'}),undefined);
 cache.clear();
 assert.equal(cache.consumeReady('parent',candidate),undefined);
});
