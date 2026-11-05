import test from 'node:test';
import assert from 'node:assert/strict';
import {voiceTargetResult} from './voiceTargetResult.mjs';
import {voiceHandoff,confirmedTargetContinuation} from './voiceHandoff.mjs';
test('failed context load preserves the selected name without authorizing private context or another name loop',()=>{
 const result=voiceTargetResult(false,'Aiden');assert.equal(result.selectedName,'Aiden');assert.equal(result.status,'target_update_failed');
 assert.match(result.instruction,/Do not ask for the name again/);assert.match(result.instruction,/until context is confirmed/);assert.match(result.instruction,/late tool result/);
 assert.equal(voiceTargetResult(true,'Aiden').status,'target_confirmed');assert.equal(voiceTargetResult(true,'Aiden').selectedName,undefined);
});

test('confirmed selection and a restarted handoff share a single conditional continuation policy',()=>{
 const result=voiceTargetResult(true,'Aiden');
 assert.ok(result.instruction.includes(confirmedTargetContinuation));
 assert.match(result.instruction,/Only for a name-only selection with no pending question and no invitation already asked/);
 assert.match(result.instruction,/once, then listen/);
 assert.match(result.instruction,/If an invitation was already asked, leave the floor with the caller/);
 assert.match(result.instruction,/If the caller has started a question or concern, listen until they finish/);
 assert.match(result.instruction,/weave in only relevant brief details; skip a separate recap and generic invitation/);
 assert.match(result.instruction,/one main thread from the brief in one short sentence/);
 assert.match(result.instruction,/Keep the same relaxed pace through the question/);
 assert.match(result.instruction,/No second thanks, greeting, reassurance/);
 assert.match(result.instruction,/If no meaningful brief facts are available, omit the recap/);
 assert.match(result.instruction,/General-family scope never uses a student recap/);
 assert.match(result.instruction,/Ordinary context refreshes never replay this opening/);
 for(const request of ['Aiden','Aiden, what does tuition mean?','Aiden, ¿qué significa matrícula?']){
  const handoff=voiceHandoff(request);
  assert.ok(handoff.includes(confirmedTargetContinuation));
  assert.ok(handoff.endsWith(JSON.stringify(request)));
  assert.match(handoff,/then answer it directly/);
  assert.equal(handoff.split('invite their priority').length-1,1);
 }
});
