import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import pg from 'pg';
import {createResearchTraceWriter,researchTraceKeys,researchTraceData,createResearchCallObserver} from './research-trace.mjs';
import {processResearchJob} from './voice-research-worker.mjs';
import {diagnosticRecord} from './observability/event-schema.mjs';
import {retrievalFixture} from './history-retrieval-fixture.mjs';
import {createVoiceResearchJobsHandler} from './voice-research-jobs.mjs';
import {researchTraceReport} from './research-trace-report.mjs';

test('service correlation is deterministic and excludes raw call/job IDs and content',()=>{
 const sessionId=randomUUID(),jobId=randomUUID(),keys=researchTraceKeys(sessionId,jobId);
 assert.equal(keys.researchCallKey.length,32);assert.notEqual(keys.researchCallKey,keys.researchJobKey);
 assert.deepEqual(keys,researchTraceKeys(sessionId.toUpperCase(),jobId));
 const event=diagnosticRecord({event:'voice.research.lifecycle',...keys,researchStage:'attempt_finished',pass:'initial',queueMs:12,failureKind:'output_limit',question:'PRIVATE',sessionId,jobId,providerRequestId:'req_private'});
 assert.equal(event.researchCallKey,keys.researchCallKey);assert.equal(event.queueMs,12);
 assert.doesNotMatch(JSON.stringify(event),/PRIVATE|req_private|sessionId|jobId/);
 assert.deepEqual(researchTraceKeys('not-a-call','not-a-job'),{});
});

test('durable metadata strips secrets, messages, full tool output and reasoning',()=>{
 const data=researchTraceData({input:'secret',output:'raw',reasoning:'private',error:{message:'secret'},providerRequestId:'req_safe123',providerResponseId:'resp_safe123',providerStatus:'incomplete',incompleteReason:'max_output_tokens',actions:[{type:'search',status:'completed',query:'private',url:'https://private.example/token'}]});
 assert.deepEqual(data,{providerStatus:'incomplete',incompleteReason:'max_output_tokens',providerRequestId:'req_safe123',providerResponseId:'resp_safe123',actions:[{type:'search',status:'completed'}]});
});

test('request coverage is distinct from provider completion in durable and service diagnostics',()=>{
 const fields={requestStatus:'partial',requestedFactCount:4,missingFactCount:1,recoveryGapCount:1,conflictCount:0};
 const durable=researchTraceData({...fields,providerStatus:'completed',missingFactText:'private request'});
 assert.deepEqual(durable,{...fields,providerStatus:'completed'});
 const service=diagnosticRecord({event:'voice.research.lifecycle',researchStage:'completed',...fields,missingFactText:'private request'});
 for(const [key,value]of Object.entries(fields))assert.equal(service[key],value);
 assert.ok(!JSON.stringify(service).includes('private request'));
 assert.equal(researchTraceData({missingFactCount:9999}).missingFactCount,256);
 assert.deepEqual(researchTraceData({requestStatus:'model said everything is fine'}),{});
});

for(const language of ['en','es'])test(`${language}: provider attempts link to one call/job with safe completion evidence`,async()=>{
 const sessionId=randomUUID(),jobId=randomUUID(),writes=[],logs=[];let available=true;
 const db={async query(sql,args){if(sql.includes('RETURNING id,input')){if(!available)return {rows:[]};available=false;return {rows:[{id:jobId,session_id:sessionId,created_at:new Date(Date.now()-500),started_at:new Date(),input:{mode:'finance',language,question:language==='es'?'Matrícula publicada':'Published tuition',institution:'Test College'}}]};}writes.push({sql,args});return {rows:[{status:'running'}],rowCount:1};}};
 let clientRequestId,requestedOutputLimit;
 await processResearchJob(db,{ORIGEN_RESEARCH_BRIEFS:'false'},{log:e=>logs.push(e),request:async(url,options)=>{clientRequestId=options.headers['X-Client-Request-Id'];requestedOutputLimit=JSON.parse(options.body).max_output_tokens;return new Response(JSON.stringify({id:'resp_fixture',status:'completed',usage:{input_tokens:10,output_tokens:20},output:[{type:'web_search_call',status:'completed',action:{type:'search'}},{type:'message',content:[{type:'output_text',text:'Tuition is published. [1]',annotations:[{type:'url_citation',url:'https://test.edu/fees',title:'Fees',start_index:0,end_index:8}]}]}]}),{headers:{'x-request-id':'req_fixture'}});}});
 const events=writes.filter(w=>w.sql.startsWith('INSERT INTO origen_voice_research_trace_events')).map(w=>({jobId:w.args[1],sessionId:w.args[2],stage:w.args[3],data:w.args[5]}));
 assert.ok(events.length>=5);assert.ok(events.every(e=>e.jobId===jobId&&e.sessionId===sessionId));
 const attempt=events.find(e=>e.stage==='attempt_finished');assert.equal(attempt.data.providerRequestId,'req_fixture');assert.equal(attempt.data.providerResponseId,'resp_fixture');assert.equal(attempt.data.failureKind,'none');assert.equal(attempt.data.attemptId,clientRequestId);assert.match(clientRequestId,/^[a-f0-9-]{36}$/u);
 assert.ok(events.some(e=>e.stage==='completed'));assert.ok(logs.every(e=>e.researchCallKey&&e.researchJobKey));
 assert.equal(attempt.data.maxOutputTokens,requestedOutputLimit);assert.ok(requestedOutputLimit<=6000);assert.equal(attempt.data.maxToolCalls,2);assert.match(attempt.data.configurationHash,/^[a-f0-9]{64}$/u);
 assert.doesNotMatch(JSON.stringify(events),/Published tuition|Matrícula publicada|Tuition is published/);
});

test('an incomplete provider response retains output-limit cause and token details',async()=>{
 const writes=[];const db={async query(sql,args){if(sql.includes('RETURNING id,input'))return {rows:[{id:randomUUID(),session_id:randomUUID(),input:{mode:'finance',language:'en',question:'Fees',institution:'Test'}}]};writes.push({sql,args});return {rows:[{status:'running'}],rowCount:1};}};
 await processResearchJob(db,{}, {log:()=>{},request:async()=>new Response(JSON.stringify({id:'resp_limit',status:'incomplete',incomplete_details:{reason:'max_output_tokens'},usage:{output_tokens:3000,output_tokens_details:{reasoning_tokens:2900}},output:[]}),{headers:{'x-request-id':'req_limit'}})});
 const attempt=writes.find(w=>w.args?.[3]==='attempt_finished').args[5];
 assert.equal(attempt.failureKind,'output_limit');assert.equal(attempt.incompleteReason,'max_output_tokens');assert.equal(attempt.reasoningTokens,2900);assert.equal(attempt.failureStage,'validation');
});

test('slow or failing trace storage is bounded and reports gaps without blocking the caller',async()=>{
 const logs=[];let release;const pending=new Promise(r=>release=r);
 const writer=createResearchTraceWriter({query:()=>pending},{sessionId:randomUUID(),jobId:randomUUID(),log:e=>logs.push(e),capacity:1});
 assert.equal(writer.record('claimed'),true);writer.record('completed');
 assert.equal(writer.stats().dropped,1);assert.equal(logs[0].event,'voice.research.trace_gap');
 release({rowCount:1});await writer.close();
});

test('observer keeps transcript and browser evidence distinct and clears playback association on scope change',async()=>{
 const rows=[],jobId=randomUUID(),sessionId=randomUUID();const observer=createResearchCallObserver({query:async(sql,args)=>{rows.push(args);return {rowCount:1};}},{subject:'fictional',sessionId});
 observer.observe({type:'origen.research.delivery',jobId,deliveryStage:'context_acknowledged',revision:2});
 observer.observe({type:'origen.research.speech_observed',jobId,speechOutcome:'acknowledgment_overlap',playbackObserved:false});
 observer.playback({idle:true,version:2});observer.reset();observer.playback({idle:true,version:3});await observer.close();
 assert.equal(rows.length,3);assert.equal(rows[0][5].evidenceKind,'server_observed');assert.equal(rows[1][5].evidenceKind,'transcript_observed');assert.equal(rows[2][5].evidenceKind,'browser_reported');assert.equal(rows[2][5].playbackIdle,true);
});

test('report exposes timings, delivery reasons and missing evidence without claiming heard speech',()=>{
 const job={id:randomUUID(),session_id:randomUUID(),status:'completed',queued_at:'2026-11-07T12:00:00Z',started_at:'2026-11-07T12:00:00.500Z'};
 const report=researchTraceReport({jobs:[job],events:[{id:randomUUID(),job_id:job.id,stage:'completed',received_at:job.started_at,data:{durationMs:21000,recoveryStatus:'not_needed'}}]});
 assert.equal(report.jobs[0].queueMs,500);assert.equal(report.jobs[0].workerCompletedMs,21000);assert.equal(report.jobs[0].initialPublishedMs,null);assert.equal(report.jobs[0].warnings.length,2);assert.match(report.interpretation,/do not prove/);
});

test('poll failures and state changes are retained without recording every unchanged poll',async()=>{
 const rows=[],jobId=randomUUID();const observer=createResearchCallObserver({query:async(sql,args)=>{rows.push(args);return {rowCount:1};}},{subject:'fictional',sessionId:randomUUID()});
 for(let i=0;i<12;i++)observer.poll({jobId,status:'running',outcome:'completed',durationMs:20});
 observer.poll({jobId,outcome:'failed',httpStatus:503,durationMs:100});
 observer.poll({jobId,status:'completed',outcome:'completed',durationMs:20});await observer.close();
 assert.equal(rows.length,4);assert.equal(rows[2][5].httpStatus,503);assert.equal(rows[3][5].pollCount,14);
});

test('a post-claim database failure keeps its call/job correlation and persistence category',async()=>{
 const jobId=randomUUID(),sessionId=randomUUID(),logs=[];
 const db={async query(sql){if(sql.includes('RETURNING id,input'))return {rows:[{id:jobId,session_id:sessionId,input:{mode:'finance',question:'Fees',institution:'Test'}}]};if(sql.includes("status='failed',result="))throw Error('private database error');return {rows:[],rowCount:1};}};
 await assert.rejects(()=>processResearchJob(db,{}, {log:e=>logs.push(e),request:async()=>{throw Error('private network error');}}));
 const failure=logs.find(e=>e.failureStage==='persistence');assert.deepEqual({researchCallKey:failure.researchCallKey,researchJobKey:failure.researchJobKey},researchTraceKeys(sessionId,jobId));assert.doesNotMatch(JSON.stringify(logs),/private database error|private network error/);
});

for(const [label,response,expected] of [
 ['rate limit',()=>new Response('{}',{status:429,headers:{'x-request-id':'req_limited'}}),{failureKind:'rate_limited',failureStage:'http'}],
 ['malformed provider JSON',()=>new Response('not-json'),{failureStage:'body'}],
 ['network reset',()=>{throw Object.assign(Error('never log this private message'),{cause:{code:'ECONNRESET'}});},{failureStage:'request',networkFailure:'ECONNRESET'}],
])test(`failure metadata classifies ${label} without recording error text`,async()=>{
 const rows=[];const db={async query(sql,args){if(sql.includes('RETURNING id,input'))return {rows:[{id:randomUUID(),session_id:randomUUID(),input:{mode:'finance',question:'Fees',institution:'Test'}}]};rows.push(args);return {rows:[{status:'running'}],rowCount:1};}};
 await processResearchJob(db,{}, {log:()=>{},request:async()=>response()});
 const result=rows.find(args=>args?.[3]==='attempt_finished')[5];for(const [key,value] of Object.entries(expected))assert.equal(result[key],value);
 assert.doesNotMatch(JSON.stringify(rows),/never log this private message/);
});

test('PostgreSQL archive survives cleanup/restart, enforces ownership, and honors account deletion',{skip:!process.env.DATABASE_TEST_URL},async()=>{
 const url=new URL(process.env.DATABASE_TEST_URL);assert.ok(['localhost','127.0.0.1'].includes(url.hostname));
 const f=await retrievalFixture(),sessionId=randomUUID(),jobId=randomUUID();let worker,created=false;
 try{
  const account=(await f.owner.query("SELECT id FROM origen_accounts WHERE auth0_subject='reader'")).rows[0].id;
  await f.owner.query("INSERT INTO origen_voice_research_jobs(id,account_id,student_id,session_id,request_key,input) VALUES($1,$2,'alex',$3,'test',$4)",[jobId,account,sessionId,{mode:'finance',language:'es',question:'Fictional public lookup',institution:'Test',privateProfile:'must not archive this'}]);
  if(!(await f.owner.query("SELECT 1 FROM pg_roles WHERE rolname='origen_research_worker'")).rows.length){await f.owner.query('CREATE ROLE origen_research_worker LOGIN');created=true;}
  await f.owner.query(`GRANT USAGE ON SCHEMA ${f.schema} TO origen_research_worker`);
  await f.owner.query(`GRANT EXECUTE ON FUNCTION ${f.schema}.origen_current_account_id() TO origen_research_worker`);
  await f.owner.query(`GRANT SELECT,UPDATE,DELETE ON ${f.schema}.origen_voice_research_jobs TO origen_research_worker`);
  await f.owner.query(`GRANT SELECT,INSERT,UPDATE ON ${f.schema}.origen_voice_research_traces TO origen_research_worker`);
  await f.owner.query(`GRANT SELECT,INSERT ON ${f.schema}.origen_voice_research_trace_events TO origen_research_worker`);
  const workerUrl=new URL(url);workerUrl.username='origen_research_worker';workerUrl.password='';worker=new pg.Pool({connectionString:workerUrl.href,options:`-c search_path=${f.schema}`,max:1});
  await worker.query("UPDATE origen_voice_research_jobs SET status='running',started_at=now() WHERE id=$1",[jobId]);
  const writer=createResearchTraceWriter(worker,{jobId,sessionId});writer.record('attempt_finished',{providerRequestId:'req_saved',failureKind:'output_limit'});await writer.close();
  const ownObserver=createResearchCallObserver(f.db,{subject:'reader',sessionId});ownObserver.observe({type:'origen.research.delivery',jobId,revision:1,deliveryStage:'context_acknowledged'});await ownObserver.close();
  const otherObserver=createResearchCallObserver(f.db,{subject:'other',sessionId});otherObserver.observe({type:'origen.research.delivery',jobId,revision:99,deliveryStage:'reply_observed'});await otherObserver.close();
  await worker.query("UPDATE origen_voice_research_jobs SET status='completed',finished_at=now(),expires_at=now()-interval '1 second',result=$2 WHERE id=$1",[jobId,{text:'Verified fictional report [1]',sources:[{url:'https://test.edu/fees'}],providerReasoning:'must not archive this',parts:[{text:'duplicated'}]}]);
  assert.equal(await processResearchJob(worker,{}, {log:()=>{},request:()=>assert.fail('cleanup cannot call provider')}),false);
  await worker.end();worker=new pg.Pool({connectionString:workerUrl.href,options:`-c search_path=${f.schema}`,max:1});
  assert.equal((await worker.query('SELECT count(*)::int AS n FROM origen_voice_research_traces WHERE id=$1',[jobId])).rows[0].n,1);
  await assert.rejects(()=>worker.query('DELETE FROM origen_voice_research_traces WHERE id=$1',[jobId]),/permission denied/);
  await assert.rejects(()=>worker.query('SELECT * FROM origen_accounts'),/permission denied/);
  const handler=createVoiceResearchJobsHandler(f.db,{});
  async function read(sub,reports=false,cursor){let body,status;const req=Object.assign(Readable.from([]),{url:`/api/voice-research-jobs?diagnostics=1&sessionId=${sessionId}${reports?'&includeReports=1':''}${cursor?'&after='+encodeURIComponent(cursor.after)+'&afterId='+cursor.afterId:''}`,method:'GET',headers:{},origenAuthorized:true,origenIdentity:{sub}});await f.as(sub,()=>handler(req,{writeHead:s=>status=s,end:s=>body=JSON.parse(s)},()=>assert.fail()));assert.equal(status,200);return body;}
  const saved=await read('reader');assert.equal(saved.jobs[0].status,'completed');assert.ok(saved.events.some(e=>e.stage==='queue_cleaned'));assert.ok(saved.events.some(e=>e.data.providerRequestId==='req_saved'));
  assert.ok(saved.events.some(e=>e.data.deliveryStage==='context_acknowledged'));assert.ok(!saved.events.some(e=>e.data.requestRevision===99));
  assert.equal(saved.jobs[0].result_snapshot,undefined);
  const report=await read('reader',true);assert.equal(report.jobs[0].result_snapshot.text,'Verified fictional report [1]');assert.equal(report.jobs[0].request_snapshot.question,'Fictional public lookup');assert.doesNotMatch(JSON.stringify(report),/must not archive this|duplicated/);
  await f.owner.query("INSERT INTO origen_voice_research_trace_events(job_id,account_id,session_id,stage,received_at) SELECT $1,$2,$3,'delivery',date_trunc('second',clock_timestamp())+n*interval '1 microsecond' FROM generate_series(1,501) n",[jobId,account,sessionId]);
  const ids=[];let cursor;for(let page=0;page<4;page++){const result=await read('reader',false,cursor);ids.push(...result.events.map(e=>e.id));cursor=result.next;if(!cursor)break;}
  const total=(await f.owner.query('SELECT count(*)::int AS n FROM origen_voice_research_trace_events WHERE job_id=$1',[jobId])).rows[0].n;
  assert.equal(cursor,null);assert.equal(ids.length,total);assert.equal(new Set(ids).size,total,'microsecond cursor must not repeat events');
  assert.deepEqual((await read('other')).events,[]);
  await f.owner.query("DELETE FROM origen_accounts WHERE id=$1",[account]);assert.equal((await f.owner.query('SELECT count(*)::int AS n FROM origen_voice_research_traces WHERE id=$1',[jobId])).rows[0].n,0);
 }finally{await worker?.end();await f.close();if(created){const pool=new pg.Pool({connectionString:url.href});try{await pool.query('DROP ROLE origen_research_worker');}finally{await pool.end();}}}
});
