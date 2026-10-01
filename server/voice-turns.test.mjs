import {test} from 'node:test';
import assert from 'node:assert/strict';
import {voiceTurns} from '../src/voiceTurns.mjs';
test('silence and punctuation are ignored without a reply or deletion',()=>{
  const events=[], turns=voiceTurns(e=>events.push(e));
  for (const [id,text] of [['a',''],['b','  '],['c','...']]) assert.equal(turns.transcript(id,text),false);
  assert.deepEqual(events,[]);
});
test('English and Spanish replies trigger once and wait for active response completion',()=>{
  const events=[], turns=voiceTurns(e=>events.push(e));
  turns.request();
  assert.equal(turns.transcript('a','Sí, biología.'),true);
  assert.equal(turns.transcript('a','Sí, biología.'),false);
  assert.equal(events.length,1);
  turns.completed();assert.equal(events.length,2);
  turns.completed();assert.equal(events.length,2);
  turns.transcript('b','He enjoys math');assert.equal(events.length,3);
  turns.completed(true);assert.equal(events.length,4);
});

test('lookup continuation waits for an interrupted user transcript and ignores duplicate completion',()=>{
 const events=[],turns=voiceTurns(e=>events.push(e));
 turns.request();turns.created();
 assert.equal(turns.beginDone('lookup',true),true);
 turns.speechStarted('thanks');
 turns.toolsCompleted();
 assert.equal(events.length,1);
 assert.equal(turns.beginDone('lookup',true),false);
 turns.transcript('thanks','Thank you very much.');
 assert.equal(events.length,2);
 turns.created();turns.beginDone('answer');turns.completed();
 assert.equal(events.length,2);
});
test('speech during research queues one response until all tool outputs are ready',()=>{
 const events=[],turns=voiceTurns(e=>events.push(e));
 turns.request();turns.beginDone('lookup',true);
 turns.transcript('a','What about living at home?');
 turns.transcript('b','For next year.');
 assert.equal(events.length,1);
 turns.toolsCompleted();assert.equal(events.length,2);
});
test('active-response conflict waits for server completion rather than retrying or ending session',()=>{
 const events=[],turns=voiceTurns(e=>events.push(e));
 turns.request();
 assert.equal(turns.recover('conversation_already_has_active_response'),true);
 assert.equal(events.length,1);
 turns.beginDone('existing');turns.completed();assert.equal(events.length,2);
 assert.equal(turns.recover('invalid_api_key'),false);
});
