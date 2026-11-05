import test from 'node:test';
import assert from 'node:assert/strict';
import {createVoiceTiming,answerKind,parseContextTiming} from './voiceTiming.mjs';
function fixture(){let time=0;const rows=[];const t=createVoiceTiming({clock:()=>time,emit:r=>rows.push(r)});return {t,rows,at:n=>time=n,begin(id='u'){t.event({type:'input_audio_buffer.speech_started',item_id:id,liveBoundary:'transcript_observed'});time+=1100;t.event({type:'input_audio_buffer.speech_stopped',item_id:id});},say(id,text,topic){t.event({type:'response.created',response:{id,metadata:{topic}}});t.event({type:'response.output_audio_transcript.delta',response_id:id,delta:text});},end(id){t.event({type:'response.done',response:{id,status:'completed'}});t.event({type:'output_audio_buffer.stopped',response_id:id});}};}
test('routing observations count unique backend calls without claiming direct-answer correctness',()=>{
 const f=fixture();f.t.event({type:'session.created',session:{routingPolicy:'bounded-follow-up-v1'}});
 f.begin();f.say('r','A shorter explanation.');f.t.playback();f.end('r');
 const first=f.rows.find(r=>r.timingStage==='turn_complete');assert.equal(first.routingObservation,'no_backend_observed');assert.equal(first.observedDelegations,0);
 f.begin('next');
 for(const id of ['b1','b1','b2'])f.t.event({type:'origen.backend.started',response_id:id,item_id:'next'});
 f.t.event({type:'origen.backend.model_finished',response_id:'b1',outcome:'completed'});
 f.t.event({type:'origen.backend.model_finished',response_id:'b2',outcome:'completed'});
 f.say('next-r','Retrieved answer.');f.t.playback();f.end('next-r');
 const second=f.rows.filter(r=>r.timingStage==='turn_complete').at(-1);assert.equal(second.observedDelegations,2);assert.equal(second.routingObservation,'backend_observed');
 assert.doesNotMatch(JSON.stringify(f.rows),/Retrieved answer|shorter explanation|b1|b2/);f.t.stop();
});
test('guide changes mid-turn, missing metadata, uncorrelated backend events and Realtime are not classified as direct turns',()=>{
 for(const kind of ['update','missing','uncorrelated','earlier-uncorrelated','invalid']){
  const f=fixture();if(kind!=='missing')f.t.event({type:'session.created',session:{routingPolicy:kind==='invalid'?'PRIVATE WORDS':'bounded-follow-up-v1'}});
  if(kind==='earlier-uncorrelated')f.t.event({type:'origen.backend.started',response_id:'earlier'});
  f.begin();
  if(kind==='update'){f.t.sent({type:'session.update'});f.t.event({type:'session.updated',session:{routingPolicy:'backend-first'}});}
  if(kind==='uncorrelated')f.t.event({type:'origen.backend.started',response_id:'unknown'});
  f.t.stop();const row=f.rows.find(r=>r.timingStage==='turn_complete');assert.equal(row.routingObservation,'unavailable');
  if(kind==='update')assert.equal(row.routingPolicy,'mixed');assert.doesNotMatch(JSON.stringify(f.rows),/PRIVATE WORDS/);
 }
});
test('model, tool and speech latencies remain distinct; text alone is not playback',()=>{
 const f=fixture();f.begin();f.at(1200);f.t.event({type:'origen.backend.started',response_id:'b',item_id:'u'});
 f.at(2200);f.t.event({type:'origen.backend.model_finished',response_id:'b',outcome:'completed'});
 f.t.toolStart({call_id:'c',name:'recall_student_context'},'b');f.at(2300);f.t.sent({type:'conversation.item.create',item:{type:'function_call_output',call_id:'c',output:'private'}});
 f.at(2600);f.say('r','We discussed your transfer options.');assert.equal(f.rows.some(r=>r.timingStage==='candidate_audio'),false);
 f.at(2700);f.t.playback();f.end('r');f.t.stop();
 assert.equal(f.rows.find(r=>r.timingStage==='backend_model').durationMs,1000);
 assert.equal(f.rows.find(r=>r.timingStage==='history_tool').durationMs,100);
 const summary=f.rows.find(r=>r.timingStage==='turn_complete');assert.equal(summary.answerCandidateMs,1500);assert.equal(summary.candidateAudioMs,1600);assert.equal(summary.boundary,'transcript_quiet_estimate');
 assert.doesNotMatch(JSON.stringify(f.rows),/private|transfer options/);
});
for(const [ack,answer] of [['Sure.','You were considering two campuses.'],['Claro, un momento.','Estabas considerando dos universidades.']])test(`excludes acknowledgment and progress: ${ack}`,()=>{
 const f=fixture();f.begin();f.at(1200);f.say('a',ack);f.t.playback();f.end('a');assert.equal(f.rows.some(r=>r.timingStage==='answer_candidate'),false);
 f.at(1500);f.say('p','I am checking official sources now.','origen_lookup_progress');f.t.playback();f.end('p');assert.equal(f.rows.some(r=>r.timingStage==='answer_candidate'),false);
 f.at(2400);f.say('r',answer);f.t.playback();f.end('r');const row=f.rows.find(r=>r.timingStage==='turn_complete');assert.equal(row.firstAudioMs,100);assert.equal(row.candidateAudioMs,1300);
});
test('late work and interrupted utterances cannot produce a fast answer for the new turn',()=>{
 const f=fixture();f.begin('old');f.t.event({type:'origen.backend.started',response_id:'old-b',item_id:'old'});f.say('old-r','Previous answer.');
 f.begin('new');f.t.event({type:'origen.backend.model_finished',response_id:'old-b',outcome:'completed'});f.t.playback();f.end('old-r');
 assert.equal(f.rows.filter(r=>r.timingStage==='candidate_audio').length,0);f.t.stop();assert.deepEqual(f.rows.filter(r=>r.timingStage==='turn_complete').map(r=>r.timingOutcome),['interrupted','closed']);
 assert.equal(f.rows.find(r=>r.timingStage==='backend_model').turnIndex,1);
});
for(const outcome of ['failed','cancelled','incomplete','timed_out'])test(`records ${outcome} without success latency`,()=>{
 const f=fixture();f.begin();f.t.event({type:'origen.backend.started',response_id:'b',item_id:'u'});f.at(26100);f.t.event({type:'origen.backend.model_finished',response_id:'b',outcome});f.t.stop();
 const row=f.rows.find(r=>r.timingStage==='turn_complete');assert.equal(row.timingOutcome,outcome);assert.equal(row.candidateAudioMs,undefined);
});
test('openings, missing boundaries, duplicate stops, teardown and late callbacks do not invent measurements',()=>{
 const f=fixture();f.say('opening','Welcome back.');f.t.playback();f.end('opening');assert.equal(f.rows.length,0);
 f.t.event({type:'input_audio_buffer.speech_started',item_id:'u'});f.say('r','Student data.');f.t.playback();f.t.event({type:'input_audio_buffer.speech_stopped',item_id:'wrong'});f.t.stop();const count=f.rows.length;f.t.stop();f.t.playback();f.t.event({type:'input_audio_buffer.speech_started',item_id:'late'});assert.equal(f.rows.length,count);assert.equal(f.rows.find(r=>r.timingStage==='turn_complete').durationMs,undefined);
});
test('logging failure cannot change a conversation',()=>{const t=createVoiceTiming({emit(){throw Error('sink');}});assert.doesNotThrow(()=>{t.event({type:'input_audio_buffer.speech_started',item_id:'u'});t.stop();});});
test('classification is explicitly a heuristic, including an unclassified empty response',()=>{assert.equal(answerKind(''),'unclassified');assert.equal(answerKind('¡Sí, claro!'),'acknowledgment');assert.equal(answerKind('Anything','origen_farewell'),'progress');});
test('cleared audio without a response ID releases the old utterance before the next turn',()=>{
 const f=fixture();f.begin();f.say('old','Previous answer.');f.t.event({type:'output_audio_buffer.cleared'});f.begin('new');f.say('new-r','New answer.');f.t.playback();f.end('new-r');assert.equal(f.rows.find(r=>r.timingStage==='candidate_audio').turnIndex,2);
});
test('fast replies overlapping the estimated speech boundary are counted, not reported as zero latency',()=>{
 const f=fixture();f.t.event({type:'input_audio_buffer.speech_started',item_id:'u',liveBoundary:'transcript_observed'});f.at(500);f.say('r','Your earlier plan.');f.t.playback();f.at(1100);f.t.event({type:'input_audio_buffer.speech_stopped',item_id:'u'});f.end('r');const row=f.rows.find(r=>r.timingStage==='turn_complete');assert.equal(row.boundaryOverlapMs,600);assert.equal(row.candidateAudioMs,undefined);
});
test('only numeric, known server stages survive header parsing',()=>{assert.deepEqual(parseContextTiming('profile;dur=3.2, brief;dur=0.4, private_student;dur=99, history;desc="private", total;dur=40.1'),{profile:3.2,brief:0.4,total:40.1});});
test('an entire reply before the estimated boundary remains an overlap, never a missing or fast success',()=>{
 const f=fixture();f.t.event({type:'input_audio_buffer.speech_started',item_id:'u',liveBoundary:'transcript_observed'});f.at(500);f.say('r','Your earlier plan.');f.t.playback();f.end('r');assert.equal(f.rows.some(r=>r.timingStage==='turn_complete'),false);f.at(1100);f.t.event({type:'input_audio_buffer.speech_stopped',item_id:'u'});const row=f.rows.find(r=>r.timingStage==='turn_complete');assert.equal(row.boundaryOverlapMs,600);assert.equal(row.candidateAudioMs,undefined);
});
test('partial English and Spanish acknowledgment chunks do not become answer candidates',()=>{
 for(const chunks of [['Let',' me',' ch','eck.'],['Cl','aro,',' un',' mo','mento.']]){
  const f=fixture();f.begin();f.t.event({type:'response.created',response:{id:'r'}});
  for(const delta of chunks){f.t.event({type:'response.output_audio_transcript.delta',response_id:'r',delta});f.t.playback();}
  assert.equal(f.rows.some(r=>r.timingStage==='answer_candidate'),false);
 }
});

test('configuration acknowledgment duration is separate from turn/model timing and contains no profile',()=>{const f=fixture();f.t.event({type:'origen.configuration.applied',durationMs:2950});const row=f.rows.find(r=>r.timingStage==='configuration_ack');assert.equal(row.durationMs,2950);assert.equal(row.timingOutcome,'completed');const n=f.rows.length;f.t.event({type:'origen.configuration.applied',durationMs:-1});assert.equal(f.rows.length,n);});
