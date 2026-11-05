import test from 'node:test';
import assert from 'node:assert/strict';
import {voiceTargetResult} from './voiceTargetResult.mjs';
test('failed context load preserves the selected name without authorizing private context or another name loop',()=>{
 const result=voiceTargetResult(false,'Aiden');assert.equal(result.selectedName,'Aiden');assert.equal(result.status,'target_update_failed');
 assert.match(result.instruction,/Do not ask for the name again/);assert.match(result.instruction,/until context is confirmed/);assert.match(result.instruction,/late tool result/);
 assert.equal(voiceTargetResult(true,'Aiden').status,'target_confirmed');assert.equal(voiceTargetResult(true,'Aiden').selectedName,undefined);
});
