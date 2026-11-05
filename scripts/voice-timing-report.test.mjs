import test from 'node:test';import assert from 'node:assert/strict';import {timingReport} from './voice-timing-report.mjs';
import {clientDiagnosticRecord} from '../server/observability/event-schema.mjs';
test('bounded routing metadata survives safe logging and comparison groups retain failed turns',()=>{
 const row={event:'voice_timing',timingStage:'turn_complete',routingPolicy:'bounded-follow-up-v1',routingObservation:'no_backend_observed',observedDelegations:0,language:'en',boundary:'transcript_quiet_estimate',timingOutcome:'answered_candidate',candidateAudioMs:500};
 const safe=clientDiagnosticRecord({...row,transcript:'SECRET',routingReason:'SECRET'});
 assert.equal(safe.routingPolicy,row.routingPolicy);assert.equal(safe.observedDelegations,0);assert.doesNotMatch(JSON.stringify(safe),/SECRET/);
 const report=timingReport([safe,{...row,routingPolicy:'backend-first',routingObservation:'backend_observed',observedDelegations:2,candidateAudioMs:1500},{...row,language:'es',timingOutcome:'timed_out',candidateAudioMs:undefined}]);
 assert.equal(report.schemaVersion,2);
 const direct=report.routingGroups['bounded-follow-up-v1/no_backend_observed/en/transcript_quiet_estimate'];assert.equal(direct.candidateAudio.p50Ms,500);
 const delegated=report.routingGroups['backend-first/backend_observed/en/transcript_quiet_estimate'];assert.equal(delegated.observedDelegations,2);
 const failed=report.routingGroups['bounded-follow-up-v1/no_backend_observed/es/transcript_quiet_estimate'];assert.equal(failed.outcomes.timed_out,1);assert.equal(failed.candidateAudio.samples,0);
 assert.ok(report.limitations.some(line=>line.includes('not proof')));
 const invalid=clientDiagnosticRecord({...row,routingPolicy:'SECRET',routingObservation:'SECRET',observedDelegations:'SECRET'});assert.doesNotMatch(JSON.stringify(timingReport([invalid])),/SECRET/);
});
test('reports independent attempts and languages, including failures and missing/overlapping boundaries',()=>{
 const event=(attempt,details)=>({session_id:'private-session',data:{type:'diagnostic',event:'voice_timing',attemptId:attempt,details:{timingStage:'turn_complete',turnIndex:1,offsetMs:2000,language:'en',boundary:'transcript_quiet_estimate',...details}}});
 const report=timingReport({events:[event('a',{timingOutcome:'answered_candidate',candidateAudioMs:1000}),event('b',{timingOutcome:'timed_out'}),event('c',{timingOutcome:'answered_candidate',language:'es',candidateAudioMs:3000}),event('d',{timingOutcome:'answered_candidate',boundaryOverlapMs:200})]});
 assert.equal(report.turns,4);assert.equal(report.candidateAudio.samples,2);assert.equal(report.candidateAudio.p50Ms,1000);assert.equal(report.candidateAudio.p95Ms,3000);assert.equal(report.overlappingBoundary,1);assert.equal(report.withoutObservedCandidateAudio,2);assert.equal(report.groups['es/transcript_quiet_estimate'].candidateAudio.samples,1);assert.deepEqual(report.timeline.map(r=>r.callIndex),[1,2,3,4]);assert.doesNotMatch(JSON.stringify(report),/private-session/);
});
test('no measurements means unknown, never a zero-millisecond success',()=>{const report=timingReport([{data:{type:'conversation.item.input_audio_transcription.completed',text:'Private student words'}}]);assert.equal(report.candidateAudio.p50Ms,null);assert.equal(report.candidateAudio.samples,0);assert.doesNotMatch(JSON.stringify(report),/Private student/);});
test('report cannot echo unexpected private strings hidden in diagnostic fields',()=>{
 const report=timingReport([{event:'voice_timing',timingStage:'turn_complete',timingOutcome:'private words',mode:'private words',language:'private words',durationMs:'private words',contextDurations:{profile:20,history:'private words',name:'private words'}}]);assert.doesNotMatch(JSON.stringify(report),/private words/);assert.deepEqual(report.timeline[0].contextDurations,{profile:20});
});
