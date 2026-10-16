import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {diagnosticRecord,clientDiagnosticRecord,createMetadata} from '../../server/observability/event-schema.mjs';
import {providerOperation,databaseQueryOperation} from '../../server/observability/dependencies.mjs';
import {createBoundedWriter} from '../../server/observability/logger.mjs';
import {recentConversationMemory} from '../../src/voiceMemory.mjs';
export const scenarios=Object.freeze([
 {id:'login-eligibility',fault:'rejected_credentials_or_permission',expected:'access_denied',recovery:'fresh_authorized_request',cleanup:'discard_synthetic_identity'},
 {id:'silent-voice-startup',fault:'negotiation_without_playback_receipt',expected:'playback_unknown',recovery:'new_client_playback_observation',cleanup:'discard_synthetic_call'},
 {id:'abrupt-interruption',fault:'client_reports_connection_loss',expected:'client_interruption',recovery:'fresh_connection_observation',cleanup:'discard_synthetic_call'},
 {id:'research-timeout',fault:'provider_timeout',expected:'provider_timeout',recovery:'synthetic_provider_returns',cleanup:'release_stub_provider'},
 {id:'summary-not-saved',fault:'storage_rejects_after_generation',expected:'storage_failure',recovery:'synthetic_storage_confirms_save',cleanup:'discard_synthetic_summary'},
 {id:'wrong-binder-scope',fault:'foreign_student_memory_candidate',expected:'scope_rejected',recovery:'matching_student_memory_only',cleanup:'discard_synthetic_binder'},
 {id:'permission-hangup-retry',fault:'failed_hangup_with_pending_retry',expected:'termination_retry',recovery:'supervisor_backlog_zero',cleanup:'discard_synthetic_call'},
 {id:'pool-exhaustion',fault:'database_connection_capacity',expected:'database_capacity',recovery:'synthetic_acquire_succeeds',cleanup:'release_synthetic_connection'},
 {id:'deletion-propagation',fault:'independent_ledger_unavailable',expected:'erasure_blocked',recovery:'replay_independent_ledger',cleanup:'erase_synthetic_references'},
 {id:'expired-backup-restore',fault:'restore_without_erasure_replay',expected:'restore_blocked',recovery:'block_then_replay_before_read',cleanup:'drop_synthetic_backup'},
 {id:'log-outage',fault:'sink_write_rejected',expected:'coverage_degraded',recovery:'fresh_sink_accepts_safe_record',cleanup:'close_synthetic_writer'},
]);
// Deterministic evidence interpreter, not an LLM evaluation or a claim about unobserved browser audio.
export function diagnose(events){
 const has=(event,outcome)=>events.some(e=>e.event===event&&(!outcome||e.outcome===outcome));
 if(events.some(e=>e.event==='api_request'&&[401,403].includes(e.httpStatus)))return 'access_denied';
 if(has('summary.generate.finished','completed')&&has('summary.save.finished','failed'))return 'storage_failure';
 if(events.some(e=>e.event==='provider.operation.finished'&&e.outcome==='failed'&&e.code==='timeout'))return 'provider_timeout';
 if(events.some(e=>e.event==='db.operation.finished'&&e.code==='postgres_53300'))return 'database_capacity';
 if(has('binder.scope.changed','failed'))return 'scope_rejected';
 if(has('permission.hangup.finished','failed')&&events.some(e=>e.event==='permission.supervisor.finished'&&e.backlog>0))return 'termination_retry';
 if(events.some(e=>e.event==='telemetry.gap'&&e.reason==='sink_failed'))return 'coverage_degraded';
 if(events.some(e=>e.event==='telemetry.gap'&&e.reason==='mapping_unavailable'))return 'erasure_blocked';
 if(events.some(e=>e.event==='telemetry.gap'&&e.reason==='mapping_expired'))return 'restore_blocked';
 if(events.some(e=>e.evidence==='client_reported'&&e.event==='connection_failure'))return 'client_interruption';
 if(events.some(e=>e.evidence==='server_observed'&&e.event==='provider.operation.finished'&&e.operation==='voice.negotiate'&&e.outcome==='completed'))return 'playback_unknown';
 return 'unknown';
}
export async function rehearse(id){
 const spec=scenarios.find(s=>s.id===id);if(!spec)throw Error('unknown_rehearsal');
 const started=performance.now(),events=[],marker='PRIVATE_REHEARSAL_CONTENT_37';
 const metadata=createMetadata({NODE_ENV:'test'}),emit=input=>events.push(diagnosticRecord({...input,message:marker,transcript:marker},{metadata}));
 if(id==='login-eligibility'){emit({event:'api_request',httpStatus:401,code:'authentication_required'});emit({event:'api_request',httpStatus:403,code:'permission_required'});}
 if(id==='silent-voice-startup')emit({event:'provider.operation.finished',operation:'voice.negotiate',outcome:'completed'});
 if(id==='abrupt-interruption')events.push(diagnosticRecord(clientDiagnosticRecord({event:'connection_failure',code:'connection_lost',message:marker}),{metadata}));
 if(id==='research-timeout')await assert.rejects(providerOperation('finance.lookup',async()=>{throw Object.assign(Error(marker),{name:'TimeoutError'});},{log:emit,detailed:false})('https://synthetic.invalid'));
 if(id==='summary-not-saved'){emit({event:'summary.generate.finished',outcome:'completed'});try{await {save:async()=>{throw Error(marker);}}.save();}catch{emit({event:'summary.save.finished',outcome:'failed',code:'storage_unavailable'});}}
 if(id==='wrong-binder-scope'){const found=recentConversationMemory([{studentId:'synthetic-other',date:new Date().toISOString(),summary:marker}],'synthetic-selected','planning');assert.equal(found.length,0);emit({event:'binder.scope.changed',outcome:'failed'});}
 if(id==='permission-hangup-retry'){emit({event:'permission.hangup.finished',outcome:'failed'});emit({event:'permission.supervisor.finished',outcome:'failed',backlog:1,oldestMs:31000});}
 if(id==='pool-exhaustion')await assert.rejects(databaseQueryOperation('history.save',async()=>{throw Object.assign(Error(marker),{code:'53300'});},{log:emit,detailed:false}));
 if(id==='deletion-propagation')emit({event:'telemetry.gap',reason:'mapping_unavailable'});
 if(id==='expired-backup-restore')emit({event:'telemetry.gap',reason:'mapping_expired'});
 if(id==='log-outage'){const write=createBoundedWriter(async()=>{throw Error(marker);},{onGap:()=>emit({event:'telemetry.gap',reason:'sink_failed'})});await write('synthetic');assert.equal(write.stats().failed,1);await write.close();}
 const evidenceMs=performance.now()-started,diagnosis=diagnose(events);assert.equal(diagnosis,spec.expected);assert.ok(!JSON.stringify(events).includes(marker));
 const recovered=[],record=input=>recovered.push(diagnosticRecord(input,{metadata}));
 if(id==='research-timeout'){const response=await providerOperation('finance.lookup',async()=>({ok:true,status:200,json:async()=>({synthetic:true})}),{log:record,detailed:false})('https://synthetic.invalid');await response.json();assert.ok(recovered.some(e=>e.outcome==='completed'));}
 else if(id==='pool-exhaustion'){assert.equal(await databaseQueryOperation('history.save',async()=>1,{log:record,detailed:false}),1);}
 else if(id==='wrong-binder-scope'){const memory=recentConversationMemory([{studentId:'synthetic-other',date:new Date().toISOString(),summary:marker},{studentId:'synthetic-selected',date:new Date().toISOString(),summary:'synthetic'}],'synthetic-selected','planning');assert.equal(memory.length,1);assert.equal(memory[0].studentId,'synthetic-selected');}
 else if(id==='log-outage'){let writes=0;const writer=createBoundedWriter(async()=>{writes++;});await writer('synthetic');assert.equal(writes,1);await writer.close();}
 else if(id==='permission-hangup-retry'){record({event:'permission.supervisor.finished',outcome:'completed',backlog:0,oldestMs:0});assert.equal(recovered[0].backlog,0);}
 else if(id==='silent-voice-startup'||id==='abrupt-interruption'){recovered.push(diagnosticRecord(clientDiagnosticRecord({event:'speech_segment',durationMs:100}),{metadata}));assert.equal(recovered[0].evidence,'client_reported');}
 else if(id==='login-eligibility')record({event:'api_request',httpStatus:200});
 else if(id==='summary-not-saved'){const store=new Map();store.set('synthetic-selected','synthetic');assert.equal(store.size,1);record({event:'summary.save.finished',outcome:'completed'});}
 assert.equal(diagnose(recovered),'unknown');
 return {version:1,scenario:id,level:'synthetic_contract',fault:spec.fault,diagnosis,expected:spec.expected,correct:true,unknown:diagnosis==='playback_unknown',evidenceMs:Number(evidenceMs.toFixed(3)),durationMs:Number((performance.now()-started).toFixed(3)),evidenceBytes:Buffer.byteLength(JSON.stringify(events)),providerRequests:0,costUsd:0,costScope:'no_external_calls',recovery:['deletion-propagation','expired-backup-restore'].includes(id)?'requires_separate_postgres_suite':'synthetic_component_contract_checked',cleanup:'in_memory_only',prohibitedDataObserved:false};
}
export async function runRehearsals(){const results=[];for(const s of scenarios)results.push(await rehearse(s.id));const negativeControls=[[],[{event:'api_request',httpStatus:200}],[{event:'summary.generate.finished',outcome:'completed'}]];return {version:1,mode:'synthetic_contract',results,correctDiagnoses:results.filter(r=>r.correct).length,incorrectDiagnoses:results.filter(r=>!r.correct).length,unknownConclusions:results.filter(r=>r.unknown).length,negativeControls:negativeControls.length,falsePositives:negativeControls.filter(events=>diagnose(events)!=='unknown').length,bytes:results.reduce((n,r)=>n+r.evidenceBytes,0),costUsd:0,boundaryEvidence:'separate_postgres_and_gvisor_suites_required'};}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{process.stdout.write(JSON.stringify(await runRehearsals())+'\n');}catch{process.stderr.write('Synthetic observability rehearsal failed.\n');process.exitCode=1;}}
