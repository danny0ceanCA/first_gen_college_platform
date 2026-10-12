import test from 'node:test';
import assert from 'node:assert/strict';
import {distinctConversationPoints} from '../src/binderKeyPoints.mjs';

test('recap display keeps the newest exact repeat without conflating topics, languages or personal notes',()=>{
 const point={id:'old',topic:'costs',kind:'explanation',language:'en',content:'FAFSA was discussed.',status:'suggested',origin:'conversation',summaryId:'old-call',conversationAt:'2026-10-01T12:00:00Z',updatedAt:'2026-10-01T12:00:00Z'};
 const newer={...point,id:'new',summaryId:'new-call',content:'  FAFSA was   discussed.  ',conversationAt:'2026-10-08T12:00:00Z'};
 const inputs=[point,newer,{...point,id:'mine',status:'saved',origin:'user',summaryId:null},{...point,id:'kept',status:'saved'},{...point,id:'other-topic',topic:'applications'},{...point,id:'spanish',language:'es'},{...point,id:'unsupported',summaryId:null}];
 assert.deepEqual(new Set(distinctConversationPoints(inputs).map(point=>point.id)),new Set(['new','other-topic','spanish']));
 assert.equal(inputs[0],point,'rendering never rewrites the saved notes');
});
