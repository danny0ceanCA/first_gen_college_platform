import test from 'node:test';import assert from 'node:assert/strict';
import {voiceContextTiming} from './voice-context-timing.mjs';
import {clientDiagnosticRecord,diagnosticRecord} from './observability/event-schema.mjs';
test('cache status is observable without recording identifiers or context',()=>{
 const t=voiceContextTiming({clock:()=>0});t.preparation('hit');assert.match(t.header(),/preparation;desc="hit"/);
 t.preparation('private student');assert.doesNotMatch(t.header(),/private student/);
});
test('context timing measures successful and failed work without changing results or errors',async()=>{
 let time=0;const rows=[];const t=voiceContextTiming({clock:()=>time,emit:r=>rows.push(r)});
 const result={secret:'Student name'};assert.equal(await t.measure('profile',async()=>{time+=30;return result;}),result);
 const failure=Error('Private query');await assert.rejects(t.measure('retrieval',async()=>{time+=900;throw failure;}),e=>e===failure);
 assert.equal(t.header(),'profile;dur=30.0, retrieval;dur=900.0, total;dur=930.0');assert.deepEqual(rows.map(r=>r.outcome),['completed','failed']);assert.doesNotMatch(JSON.stringify(rows),/Student|Private/);
});
test('timing telemetry keeps bounded measurements and drops supplied words and identifiers',()=>{
 const client=diagnosticRecord(clientDiagnosticRecord({event:'voice_timing',timingStage:'turn_complete',timingOutcome:'answered_candidate',turnIndex:2,offsetMs:999999999,candidateAudioMs:2100,boundary:'transcript_quiet_estimate',transcript:'Private name',requestReference:'secret'}));
 assert.equal(client.candidateAudioMs,2100);assert.equal(client.offsetMs,3600000);assert.equal(client.evidence,'client_reported');assert.doesNotMatch(JSON.stringify(client),/Private name|secret/);
 const invalid=clientDiagnosticRecord({event:'voice_timing',timingStage:'Private query',boundary:'name',candidateAudioMs:-5});assert.equal(invalid.timingStage,undefined);assert.equal(invalid.boundary,undefined);assert.equal(invalid.candidateAudioMs,undefined);
 const server=diagnosticRecord({event:'voice.context_timing',contextStage:'teachings',durationMs:15,outcome:'completed'});assert.equal(server.contextStage,'teachings');assert.equal(server.evidence,'server_observed');
});

test('timing classifier metadata is allowlisted without claiming semantic playback',()=>{
 const record=diagnosticRecord(clientDiagnosticRecord({event:'voice_timing',timingStage:'transcript_classified',timingTextKind:'incomplete_preamble',timingClassifierVersion:'preamble-v2',timingAudioEvidence:'audio_energy_after_transcript',preambleResponseCount:50000,transcript:'Private student details',responseId:'private-response'}));
 assert.equal(record.timingTextKind,'incomplete_preamble');assert.equal(record.timingClassifierVersion,'preamble-v2');assert.equal(record.timingAudioEvidence,'audio_energy_after_transcript');assert.equal(record.preambleResponseCount,10000);
 assert.doesNotMatch(JSON.stringify(record),/Private student|private-response/);
 const invalid=clientDiagnosticRecord({event:'voice_timing',timingTextKind:'Private student details',timingClassifierVersion:'secret',timingAudioEvidence:'answer_heard',preambleResponseCount:-1});
 assert.equal(invalid.timingTextKind,undefined);assert.equal(invalid.timingClassifierVersion,undefined);assert.equal(invalid.timingAudioEvidence,undefined);assert.equal(invalid.preambleResponseCount,undefined);
});
