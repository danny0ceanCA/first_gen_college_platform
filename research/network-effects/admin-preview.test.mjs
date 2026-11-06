import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {replayPreviewReport} from './admin-preview.mjs';
import {openStore} from './store.mjs';
import {verificationVersion,verificationContextHash} from './verification-contracts.mjs';
import {createNetworkEffectsRepository,migrateNetworkEffects} from '../../server/network-effects/repository.mjs';
import {createPGlitePool} from '../../server/network-effects/pglite-test-pool.mjs';

const runtime=new URL('./.local/pg-test-runtime/node_modules/@electric-sql/pglite/dist/index.js',import.meta.url);
const PGlite=existsSync(runtime)?(await import(runtime.href)).PGlite:null;
const pgTest=(name,fn)=>test(name,{skip:!PGlite&&'Requires the isolated PGlite test runtime.'},fn);
const source=(id,text,extra={})=>({id,version:1,accountId:'preview-fictional-family',studentId:'preview-student',reporter:'student',language:'en',kind:'transcript',recordedAt:'2026-11-01T10:00:00.000Z',text,synthetic:true,...extra});
const extraction=(input,status,extra={})=>({schemaVersion:1,items:[{key:'result',episodeKey:'getting-help',topic:'finding_help',barrier:null,kind:'outcome',status,statement:input.text,quote:input.text,reportedBy:input.reporter,language:input.language,occurredAt:null,linksTo:null,corrects:null,...extra}]});
const report=records=>({kind:'network-effects-verification-calibration',schemaVersion:1,records});
async function setup(t){
 const db=new PGlite(),pool=createPGlitePool(db);await migrateNetworkEffects(pool);
 t.after(()=>db.close());return createNetworkEffectsRepository(pool);
}
function fixtureStore(t){const store=openStore({path:':memory:'});t.after(()=>store.close());return store;}
function seed(store,input,actual){const queued=store.ingest(input,'preview-fixture-history'),job=store.claim({jobId:queued.id});store.complete(job,actual,3);}
function record(store,input,initial,{decision='kept',final=initial,retry=false}={}){
 const queued=store.ingest(input,verificationVersion),context=store.contextFor(input);
 const issues=['revised','needs_review'].includes(decision)?[{type:'relationship',quote:input.text,detail:'The saved interpretation requires this evidence relationship.',itemKey:initial.items[0]?.key||null}]:[];
 const base={schemaVersion:1,version:verificationVersion,initial,contextHash:verificationContextHash(input,context),reasons:decision==='skipped'?[]:['sample']};
 const step={stage:'verification',model:'fictional-model',responseId:'resp_fictional',durationMs:17,sent:true,outcome:'completed',errorCode:null,usage:{inputTokens:20,outputTokens:10},reasoningTokens:3};
 let job=store.claim({jobId:queued.id});
 if(retry){
  store.recordVerification(job,{...base,decision:'pending',final:null,issues:[],steps:[]});
  store.recordVerification(job,{...base,decision:'failed',final:null,issues:[],steps:[{...step,outcome:'failed',errorCode:'provider_timeout'}]});
  store.failure(job,{code:'provider_timeout'},{maxAttempts:3,retryDelayMs:0});job=store.claim({jobId:queued.id});
 }
 const audit={...base,decision,final:['pending','failed','needs_review'].includes(decision)?null:final,issues,steps:decision==='skipped'||decision==='pending'?[]:[step]};
 if(decision!=='skipped')store.recordVerification(job,{...base,decision:'pending',final:null,issues:[],steps:[]});
 if(decision!=='pending')store.recordVerification(job,audit);
 const valid=['kept','revised','skipped'].includes(decision),errorCode=decision==='needs_review'?'verification_needs_review':valid||decision==='pending'?null:'provider_timeout';
 if(valid)store.complete(job,audit.final,25);
 else if(decision!=='pending')store.failure(job,{code:errorCode},{maxAttempts:job.attempts});
 return {source:input,initial,actual:valid?audit.final:null,valid,errorCode,audit,durationMs:25,history:store.getVerification(job.id),pipeline:store.state({accountId:input.accountId,studentId:input.studentId})};
}

pgTest('preview replays saved correction audits with their original canonical context and source',async t=>{
 const store=fixtureStore(t),repository=await setup(t);
 const prior=source('preview-prior','The office accepted my request.');seed(store,prior,extraction(prior,'positive'));
 const current=source('preview-correction','Correction: the request was received, but it has not been accepted.',{recordedAt:'2026-11-02T10:00:00.000Z'});
 const initial=extraction(current,'pending'),target=`${prior.id}@1#result`;
 const entry=record(store,current,initial,{decision:'revised',final:extraction(current,'pending',{corrects:target,linksTo:target})});
 await replayPreviewReport(repository,report([entry]));
 const jobs=await repository.listJobs({pageSize:50}),job=jobs.items.find(job=>job.sourceId===current.id),saved=await repository.getVerification(job.id);
 assert.deepEqual(saved.source,current);assert.deepEqual(saved.attempts[0].audit,entry.audit);
 const state=await repository.state(),episode=state.episodes[0];
 assert.equal(episode.items.find(item=>item.id===target).state,'superseded');
 assert.equal(episode.items.find(item=>item.sourceId===current.id).corrects,target);
 assert.equal(episode.outcomeState,'pending');assert.equal(saved.attempts[0].audit.steps[0].durationMs,17);
 assert.equal(state.reviews.length,0);
});

pgTest('preview preserves sequential context and saved skipped/kept decisions without duplicating prior jobs',async t=>{
 const store=fixtureStore(t),repository=await setup(t);
 const first=source('preview-sequence-one','I am waiting for the office to reply.');
 const before=record(store,first,extraction(first,'pending'),{decision:'skipped'});
 const second=source('preview-sequence-two','The office replied with the appointment time.',{recordedAt:'2026-11-02T10:00:00.000Z'});
 const after=record(store,second,extraction(second,'positive',{linksTo:`${first.id}@1#result`}));
 await replayPreviewReport(repository,report([before,after]));
 const jobs=await repository.listJobs({pageSize:50});assert.equal(jobs.total,2);
 for(const entry of [before,after]){
  const saved=await repository.getVerification(jobs.items.find(job=>job.sourceId===entry.source.id).id);
  assert.deepEqual(saved.attempts[0].audit,entry.audit);
 }
});

pgTest('preview preserves failed and unresolved checks without committing their candidates',async t=>{
 const store=fixtureStore(t),repository=await setup(t),entries=[];
 for(const [index,decision] of ['failed','needs_review','pending'].entries()){
  const input=source(`preview-held-${index}`,'I do not know whether the request was accepted.',{accountId:`preview-family-${index}`});
  entries.push(record(store,input,extraction(input,'unknown'),{decision}));
 }
 await replayPreviewReport(repository,report(entries));
 const state=await repository.state();assert.equal(state.episodes.length,0);
 const jobs=await repository.listJobs({pageSize:50});
 for(const entry of entries){
  const saved=await repository.getVerification(jobs.items.find(job=>job.sourceId===entry.source.id).id);
  assert.deepEqual(saved.attempts[0].audit,entry.audit);
  assert.equal(saved.job.status,entry.audit.decision==='pending'?'running':'failed');
 }
});

pgTest('preview retains retry attempt audits instead of overwriting the failed attempt',async t=>{
 const store=fixtureStore(t),repository=await setup(t),input=source('preview-retry','The office replied.');
 const entry=record(store,input,extraction(input,'positive'),{retry:true});
 await replayPreviewReport(repository,report([entry]));
 const job=(await repository.listJobs({pageSize:50})).items[0],saved=await repository.getVerification(job.id);
 assert.equal(saved.attempts.length,2);assert.equal(saved.job.status,'completed');
 assert.deepEqual(saved.attempts.map(item=>item.audit),entry.history.attempts.map(item=>item.audit));
});

pgTest('preview rejects a mismatched context hash rather than rewriting it',async t=>{
 const store=fixtureStore(t),repository=await setup(t),input=source('preview-hash','The office replied.');
 const entry=record(store,input,extraction(input,'positive'));
 entry.audit.contextHash='a'.repeat(64);entry.history.attempts[0].audit.contextHash=entry.audit.contextHash;
 await assert.rejects(replayPreviewReport(repository,report([entry])),/verification_context_changed/);
 assert.equal((await repository.state()).episodes.length,0);
});

test('preview rejects non-fictional prior evidence before touching a repository',async t=>{
 const store=fixtureStore(t),input=source('preview-source','I am waiting for a reply.');
 const entry=record(store,input,extraction(input,'pending'));
 entry.pipeline.sourceHistory.push(source('private-prior','Private record.',{synthetic:false}));
 const calls=[];const repository=new Proxy({},{get:(_,key)=>async()=>{calls.push(key);}});
 await assert.rejects(replayPreviewReport(repository,report([entry])),/preview_report_requires_fictional_calibration/);
 assert.deepEqual(calls,[]);
});

pgTest('preview retains legacy extraction report replay without requiring new verification audits',async t=>{
 const repository=await setup(t),input=source('preview-legacy','I am waiting for a reply.'),actual=extraction(input,'pending');
 await replayPreviewReport(repository,{kind:'network-effects-real-extraction-calibration',records:[{source:input,valid:true,actual,diagnostic:{durationMs:7}}]});
 const jobs=await repository.listJobs({pageSize:50});assert.equal(jobs.total,1);
 assert.equal((await repository.getVerification(jobs.items[0].id)).attempts.length,0);
 assert.equal((await repository.state()).episodes[0].outcomeState,'pending');
});
