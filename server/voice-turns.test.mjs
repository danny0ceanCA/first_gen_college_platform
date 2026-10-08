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

for(const transcriptFirst of [false,true])test(`empty interruption resumes once, transcript first: ${transcriptFirst}`,()=>{
 const events=[],turns=voiceTurns(e=>events.push(e));
 turns.request();turns.created();turns.speechStarted('noise');
 if(transcriptFirst)turns.transcript('noise','');
 turns.beginDone('cut',false,true);turns.completed();
 if(!transcriptFirst){assert.equal(events.length,1);turns.transcript('noise','');}
 assert.equal(events.length,2);
 turns.created();turns.speechStarted('noise2');turns.beginDone('cut2',false,true);turns.completed();turns.transcript('noise2','');
 assert.equal(events.length,2,'repeated noise cannot cause an endless recovery loop');
});
for(const transcriptFirst of [false,true])test(`spoken interruption gets ordinary reply, transcript first: ${transcriptFirst}`,()=>{
 const events=[],recoveries=[],turns=voiceTurns(e=>events.push(e),()=>recoveries.push(true));
 turns.request();turns.created();turns.speechStarted('user');
 if(transcriptFirst)turns.transcript('user','What is Common App?');
 turns.beginDone('cut',false,true);turns.completed();
 if(!transcriptFirst)turns.transcript('user','What is Common App?');
 assert.equal(events.length,2);assert.equal(recoveries.length,0);
});

test('lookup status stays outside history and serializes the final answer',()=>{
 const events=[],turns=voiceTurns(e=>{events.push(e);return `event-${events.length}`;});
 assert.equal(turns.progress('Checking sources.'),false);
 turns.request();turns.beginDone('lookup',true);
 assert.equal(turns.progress('Checking sources.'),true);
 assert.equal(events[1].response.conversation,'none');
 assert.deepEqual(events[1].response.input,[]);
 assert.equal(turns.progress('Again.'),false);
 assert.equal(turns.progressEvent({type:'response.created',response:{id:'status',metadata:{topic:'origen_lookup_progress'}}}),true);
 assert.equal(turns.progressEvent({type:'response.output_audio_transcript.done',response_id:'status',transcript:'Checking sources.'}),true);
 turns.toolsCompleted();assert.equal(events.length,2);
 turns.progressEvent({type:'response.done',response:{id:'status'}});
 assert.equal(events.length,3);
 assert.deepEqual(events[2],{type:'response.create'});
});

test('speaking interrupts status and delays the answer until transcription arrives',()=>{
 const events=[],turns=voiceTurns(e=>{events.push(e);return `event-${events.length}`;});
 turns.request();turns.beginDone('lookup',true);turns.progress('Checking.');
 turns.speechStarted('user');
 turns.progressEvent({type:'response.created',response:{id:'status',metadata:{topic:'origen_lookup_progress'}}});
 assert.deepEqual(events[2],{type:'response.cancel',response_id:'status'});
 turns.toolsCompleted();turns.progressEvent({type:'response.done',response:{id:'status'}});
 assert.equal(events.length,3);
 turns.transcript('user','One more question');assert.equal(events.length,4);
});

test('a rejected status update releases the answer without ending the conversation',()=>{
 const events=[],turns=voiceTurns(e=>{events.push(e);return `event-${events.length}`;});
 turns.request();turns.beginDone('lookup',true);turns.progress('Checking.');
 turns.toolsCompleted();
 assert.equal(turns.progressEvent({type:'error',error:{event_id:'event-2'}}),true);
 assert.equal(events.length,3);
 assert.equal(turns.progressEvent({type:'error',error:{event_id:'unrelated'}}),false);
});

test('a missing transcription times out and releases the next real question',()=>{
 const events=[],missing=[],timers=new Map();let id=0;
 const turns=voiceTurns(event=>events.push(event),()=>{},{schedule:fn=>{timers.set(++id,fn);return id;},cancel:id=>timers.delete(id),onMissing:item=>missing.push(item)});
 turns.speechStarted('lost');turns.speechStopped('lost');
 turns.speechStarted('next');turns.speechStopped('next');turns.transcript('next','What is FAFSA?');
 assert.equal(events.length,0);assert.equal(timers.size,1);
 [...timers.values()][0]();assert.equal(events.length,1);assert.deepEqual(missing,['lost']);
});
test('transcription timeout starts after speech stops and is cancelled on completion or cleanup',()=>{
 const timers=new Map();let id=0;const turns=voiceTurns(()=>{},()=>{},{schedule:fn=>{timers.set(++id,fn);return id;},cancel:id=>timers.delete(id)});
 turns.speechStarted('long-answer');assert.equal(timers.size,0);
 turns.speechStopped('long-answer');assert.equal(timers.size,1);
 turns.transcript('long-answer','My student likes biology');assert.equal(timers.size,0);
 turns.speechStarted('pending');turns.speechStopped('pending');turns.stop();assert.equal(timers.size,0);
 assert.equal(turns.transcript('pending','late words'),false);
});

for(const transcriptFirst of [false,true])test(`noise during buffered audio resumes after generation already finished, transcript first: ${transcriptFirst}`,()=>{
 const events=[],recoveries=[],turns=voiceTurns(e=>events.push(e),()=>recoveries.push(true));
 turns.request();turns.created();turns.playback({type:'output_audio_buffer.started',response_id:'answer'});
 turns.beginDone('answer');turns.completed();
 turns.speechStarted('noise');
 if(transcriptFirst)turns.transcript('noise','');
 turns.playback({type:'output_audio_buffer.cleared',response_id:'answer'});
 if(!transcriptFirst)turns.transcript('noise','');
 assert.equal(events.length,2,'recover interrupted playback even though response.done arrived earlier');
 assert.equal(recoveries.length,1);
});

test('a real interruption during buffered playback answers the new question once',()=>{
 const events=[],recoveries=[],turns=voiceTurns(e=>events.push(e),()=>recoveries.push(true));
 turns.request();turns.created();turns.playback({type:'output_audio_buffer.started',response_id:'answer'});
 turns.beginDone('answer');turns.completed();turns.speechStarted('question');
 turns.transcript('question','What about community college?');
 turns.playback({type:'output_audio_buffer.cleared',response_id:'answer'});
 assert.equal(events.length,2);assert.equal(recoveries.length,0);
});

test('a missing transcript after cancellation releases one recovery after speech stops',()=>{
 const events=[],timers=[];
 const turns=voiceTurns(e=>events.push(e),()=>{},{schedule:fn=>{timers.push(fn);return timers.length;},cancel:()=>{}});
 turns.request();turns.created();turns.speechStarted('lost');turns.beginDone('answer',false,true);turns.completed();turns.speechStopped('lost');
 timers[0]();assert.equal(events.length,2);
});

test('normal playback drain, progress-audio cancellation and stop never replay an answer',()=>{
 const events=[],recoveries=[],turns=voiceTurns(e=>{events.push(e);return `e${events.length}`;},()=>recoveries.push(true));
 turns.request();turns.created();turns.playback({type:'output_audio_buffer.started',response_id:'answer'});
 turns.beginDone('answer');turns.completed();turns.playback({type:'output_audio_buffer.stopped',response_id:'answer'});
 assert.equal(events.length,1);
 turns.request();turns.beginDone('tool',true);turns.progress('Checking.');
 turns.progressEvent({type:'response.created',response:{id:'progress',metadata:{topic:'origen_lookup_progress'}}});
 turns.playback({type:'output_audio_buffer.started',response_id:'progress'});turns.speechStarted('noise');
 turns.playback({type:'output_audio_buffer.cleared',response_id:'progress'});turns.transcript('noise','');
 turns.progressEvent({type:'response.done',response:{id:'progress'}});
 turns.toolsCompleted();assert.equal(recoveries.length,0,'status audio is never an interrupted answer');
 const before=events.length;turns.stop();turns.playback({type:'output_audio_buffer.cleared'});assert.equal(events.length,before);
});

test('repeated noise during buffered playback cannot cause endless paid recovery replies',()=>{
 const events=[],turns=voiceTurns(e=>events.push(e));
 for(let i=0;i<2;i++){
  if(i===0)turns.request();turns.created();
  turns.playback({type:'output_audio_buffer.started',response_id:`answer${i}`});turns.beginDone(`answer${i}`);turns.completed();
  turns.speechStarted(`noise${i}`);turns.playback({type:'output_audio_buffer.cleared',response_id:`answer${i}`});turns.transcript(`noise${i}`,'');
 }
 assert.equal(events.length,2);
});
