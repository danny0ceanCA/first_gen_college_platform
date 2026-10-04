import test from 'node:test';
import assert from 'node:assert/strict';
import {voiceSession} from './profile-voice.mjs';
import {resolveScope,beforeScopeRequest} from '../src/conversationScope.mjs';
const students=[{id:'one',name:'Sofia'},{id:'two',name:'Sofia'}];
test('unconfirmed parent sessions offer routing only and omit private history',()=>{
 for(const mode of ['finance','admissions','planning']){
  const session=voiceSession({role:'parent',mode,language:'en',routeConversations:true,students,profile:{name:'PRIVATE PROFILE'},memory:[{summary:'PRIVATE HISTORY'}]},{});
  assert.deepEqual(session.tools.map(t=>t.name),['request_conversation_target','set_conversation_language']);
  assert.deepEqual(session.tools[0].parameters.properties.scope.enum,['family','student:one','student:two']);
  assert.match(session.instructions,/duplicated|ambiguous/);
  assert.match(session.instructions,/spoken choice automatically/);
  assert.match(session.tools[0].description,/no on-screen confirmation is needed/);
  assert.doesNotMatch(session.instructions,/tell the parent to confirm the on-screen selection/);
  assert.doesNotMatch(session.instructions,/PRIVATE PROFILE|PRIVATE HISTORY/);
 }
});
test('confirmed family scope retains specialist tools and applies clear spoken switches automatically',()=>{
 const session=voiceSession({role:'parent',mode:'finance',language:'es',routeConversations:true,targetConfirmed:true,scopeRestart:true,studentId:null,students,profile:{}},{});
 assert.deepEqual(session.tools.map(t=>t.name),['lookup_financial_aid','request_conversation_target','set_conversation_language']);
 assert.match(session.instructions,/general family questions/);
 assert.match(session.instructions,/Do not greet or introduce yourself again/);
});
test('target IDs are validated and switch utterances stay out of previous summaries',()=>{
 assert.equal(resolveScope('family',students),null);
 assert.equal(resolveScope('student:two',students),'two');
 assert.equal(resolveScope('student:foreign',students),undefined);
 assert.equal(resolveScope('Sofia',students),undefined);
 const turns=[{role:'user',text:'Costs for Sofia?'},{role:'assistant',text:'Discuss costs.'},{role:'user',text:'Now Mateo has different circumstances.'},{role:'assistant',text:'Please confirm Mateo.'}];
 assert.deepEqual(beforeScopeRequest(turns),turns.slice(0,2));
});
