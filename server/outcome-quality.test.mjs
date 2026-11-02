import test from 'node:test';
import assert from 'node:assert/strict';
import {evidenceQualityReport,validateQualityRow,qualityRows} from './outcome-quality.mjs';
import {syntheticQualityRows,syntheticQualityOptions} from './fixtures/outcome-quality-cases.mjs';
import {outcomeDefinitions} from '../src/outcomeEvidence.mjs';
test('one episode is the unit; pending, unknown and declined reports remain in each denominator',()=>{
 const rows=syntheticQualityRows(),r=evidenceQualityReport(rows,syntheticQualityOptions);
 assert.equal(r.episodes,40);assert.deepEqual(r.metrics.recorded_answer,{count:20,denominator:40,rate:.5,suppressed:false});
 for(const metric of ['pending','explicit_outcome_decline','unknown_outcome'])assert.deepEqual(r.metrics[metric],{count:10,denominator:40,rate:.25,suppressed:false});
 assert.equal(r.metrics.revised_since_opt_in.count,10);assert.equal(r.provenance.student_account.count,40);assert.equal(r.provenance.coordinator_observations,'not_linked_to_private_episodes');
 assert.equal(r.coverage.outcomeSilence,'not_inferred');assert.equal(r.coverage.timeToOutcome,'not_estimated');assert.equal(r.coverage.allEligibleStudents,'not_measured');
});
test('small groups, small complements, repeated accounts and overflow never reveal cells',()=>{
 const rows=syntheticQualityRows(),check=r=>{assert.equal(r.episodes,null);assert.ok(Object.values(r.metrics).every(m=>m.count===null&&m.denominator===null&&m.rate===null));};
 check(evidenceQualityReport(rows.slice(0,9),syntheticQualityOptions));
 check(evidenceQualityReport(rows.map(r=>({...r,participantKey:rows[0].participantKey})),syntheticQualityOptions));
 check(evidenceQualityReport(rows,{...syntheticQualityOptions,limited:true}));
 const complement=evidenceQualityReport(rows.slice(0,29),syntheticQualityOptions);assert.equal(complement.status,'available');assert.equal(complement.metrics.recorded_answer.suppressed,true);
 assert.equal(evidenceQualityReport(rows,syntheticQualityOptions).metrics.contradictions.count,null);
});
test('duplicate episodes and forged denominator, prose, identifiers, rules and purposes are rejected',()=>{
 const rows=syntheticQualityRows();assert.throws(()=>evidenceQualityReport([...rows,rows[0]],syntheticQualityOptions));
 for(const patch of [{denominator:100},{statement:'Private note'},{studentId:'alex'},{permissionVersion:0},{purpose:'research'},{contractVersion:2},{ruleVersion:'newest_wins'},{definitionId:'success'},{knownDateCount:2},{window:{start:'2026-02-30',end:'2026-03-31',timeZone:'UTC'}}])assert.throws(()=>validateQualityRow({...rows[0],...patch}));
 assert.throws(()=>evidenceQualityReport(rows,{...syntheticQualityOptions,period:'2026-09'}));assert.throws(()=>evidenceQualityReport(rows,{...syntheticQualityOptions,definitionId:'waiver_approved'}));
});
test('correction and withdrawal produce fresh aggregates instead of retained success labels',()=>{
 const rows=syntheticQualityRows(),before=evidenceQualityReport(rows,syntheticQualityOptions),after=evidenceQualityReport(rows.slice(1),syntheticQualityOptions);
 assert.equal(after.episodes,before.episodes-1);assert.equal(after.metrics.recorded_answer.count,19);assert.equal(after.metrics.revised_since_opt_in.count,null);
 assert.doesNotMatch(JSON.stringify(after),/episodeKey|participantKey|recordedAt|trackingSince|successRate/);
 assert.deepEqual(evidenceQualityReport(rows,syntheticQualityOptions),before);
});
test('normalization derives assessment and denominator from permitted evidence instead of client conclusions',()=>{
 const row=syntheticQualityRows()[0],episode={id:row.episodeKey,version:1,definition_id:'document_submitted',definition_version:1,institution:'present',term:'present',cycle:'present',window_start:'2026-10-01',window_end:'2026-12-31',time_zone:'UTC',state:'current',valid_until:'2027-01-01',recorded_at:row.recordedAt};
 const evidence={id:'hashed-evidence',version:1,episode_id:episode.id,report_id:'hashed-report',report_version:1,response_state:'answered',claim_status:'pending',decision:null,event_on:null,time_zone:'UTC',recorded_at:row.recordedAt};
 const normalized=qualityRows({definitions:outcomeDefinitions,items:[{episodeKey:row.episodeKey,participantKey:row.participantKey,episode,permissionVersion:1,corrections:0,trackingSince:row.trackingSince,evidence:[evidence]}]},new Date(syntheticQualityOptions.cutoff));
 assert.equal(normalized[0].assessmentState,'student_reported');assert.equal(normalized[0].evidenceCount,1);assert.equal(normalized[0].knownDateCount,0);assert.ok(normalized[0].reasonCodes.includes('result_pending'));
});
