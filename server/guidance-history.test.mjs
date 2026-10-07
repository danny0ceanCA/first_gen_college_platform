import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {fixture} from './family-fixture.mjs';
import {createGuidanceRepository,guidanceConfig,validateGuidanceEvent,purgeGuidanceHistory,bindGuidanceIdentity,backfillGuidanceIdentities,attachSummarySegments,validateSummarySegments,deferSummaryAttribution,createGuidanceHandler} from './guidance-history.mjs';
import {createHistoryRepository} from './history.mjs';
import {createLifecycleRepository} from './account-lifecycle.mjs';
import {guidanceHistory} from '../src/guidanceHistory.mjs';
import {createProfileVoiceHandler} from './profile-voice.mjs';
import {createSummaryHandler} from './conversation-summary.mjs';
import {productionConfigIssues} from './production-config.mjs';
import {guidanceReport} from './guidance-report.mjs';
const config=guidanceConfig('test-model','voice',{instructions:'Synthetic policy',tools:[]},{APPLICATION_REVISION:'test'});
const student={id:'s',name:'Synthetic student',stage:'10th grade'};
async function setup(){const f=await fixture();const c=await f.pool.connect();await c.query(await readFile(new URL('./migrations/015_guidance_history.sql',import.meta.url),'utf8'));c.release();await f.run('owner',{action:'save-student',student});await f.run('other',{action:'save-student',student});return {...f,repo:createGuidanceRepository(f.pool)};}
const start=(sessionId=crypto.randomUUID(),overrides={})=>({sessionId,segmentId:crypto.randomUUID(),topic:'planning',role:'parent',language:'en',targetKind:'student',studentId:'s',...overrides});
const event=scope=>({eventId:crypto.randomUUID(),sessionId:scope.sessionId,segmentId:scope.segmentId,name:'voice.connected',sequence:1,occurredAt:new Date().toISOString(),payload:{}});
const summary=(id='summary')=>({id,studentId:'s',mode:'planning',date:new Date().toISOString(),summary:'Synthetic summary',sources:[]});

test('sessions and segments stay private; retries and reordered events deduplicate safely',async()=>{
 const {pool,repo}=await setup();try{
  const scope=start();await repo.begin('owner',scope,config);await repo.begin('owner',scope,config);
  assert.equal((await pool.query('SELECT * FROM origen_guidance_segments')).rows.length,1);
  await assert.rejects(repo.event('other',event(scope)),{status:404});
  const first=event(scope);await repo.event('owner',first);await repo.event('owner',first);
  await assert.rejects(repo.event('owner',{...first,payload:{},name:'response.started'}),{status:409});
  await assert.rejects(repo.event('owner',{...first,eventId:crypto.randomUUID()}),{status:409});
  await repo.event('owner',{...event(scope),sequence:3,name:'response.started'});
  await repo.event('owner',{...event(scope),sequence:2,name:'response.finished',payload:{status:'completed'}});
  const report=await repo.report('owner');assert.equal(report.sessionCount,1);assert.equal(report.connectedCount,1);assert.equal((await repo.report('other')).sessionCount,0);
  const aggregate=await guidanceReport(pool);assert.equal(aggregate.logicalSessions,1);assert.equal(aggregate.sessionsWithClientConnection,1);assert.doesNotMatch(JSON.stringify(aggregate),/owner|studentId|sessionId/);
  assert.equal((await pool.query("SELECT * FROM origen_guidance_events WHERE producer='browser'")).rows.length,3);
 }finally{await pool.end();}
});

test('late tool completion retains initiating segment and omits questions, source queries and text',async()=>{
 const {pool,repo}=await setup();try{
  const first=start();await repo.begin('owner',first,config);const id=await repo.startExecution('owner',first,config,'lookup_financial_aid');
  const second=start(first.sessionId,{topic:'finance'});await repo.begin('owner',second,config);
  await repo.event('owner',{...event(second),name:'guidance.configuration_applied'});
  await assert.rejects(repo.startExecution('owner',first,config,'lookup_financial_aid'),{status:409});
  await repo.finishExecution('owner',id,{status:'completed',durationMs:10,tool:'lookup_financial_aid',usage:{input_tokens:5,private:'DO NOT STORE'},sources:[{url:'https://studentaid.gov/understand-aid',title:'PRIVATE TEXT'},{url:'https://studentaid.gov/?name=PRIVATE'}]});
  await repo.finishExecution('owner',id,{status:'failed',durationMs:99});
  const execution=(await pool.query('SELECT * FROM origen_ai_executions')).rows[0];assert.equal(execution.segment_id,first.segmentId);assert.equal(execution.status,'completed');
  const tools=(await pool.query('SELECT * FROM origen_tool_calls')).rows;assert.equal(tools.length,1);assert.equal(tools[0].source_count,1);assert.doesNotMatch(JSON.stringify(tools),/PRIVATE|name=/);assert.deepEqual(execution.usage,{input_tokens:5});
 }finally{await pool.end();}
});

test('one display summary links several same-target topics; other targets and unresolved scopes are rejected',async()=>{
 const {pool,repo,run}=await setup();try{
  const first=start();await repo.begin('owner',first,config);const second=start(first.sessionId,{topic:'finance'});await repo.begin('owner',second,config);
  const attribution={sessionId:first.sessionId,segmentIds:[first.segmentId,second.segmentId],language:'es',configuration:config};
  const history=createHistoryRepository(pool);await history('owner',{action:'save',item:summary(),attribution});await history('owner',{action:'save',item:summary(),attribution});
  assert.equal((await pool.query('SELECT * FROM origen_conversation_summaries')).rows.length,1);assert.equal((await pool.query('SELECT * FROM origen_summary_segments')).rows.length,2);
  const unresolved=start(first.sessionId,{targetKind:'unresolved',studentId:null});await repo.begin('owner',unresolved,config);
  await assert.rejects(validateSummarySegments(pool,'owner',summary(),{sessionId:first.sessionId,segmentIds:[unresolved.segmentId]}),{status:409});
  await assert.rejects(validateSummarySegments(pool,'other',summary(),attribution),{status:404});
  await run('owner',{action:'delete-student',id:'s'});assert.equal((await pool.query('SELECT * FROM origen_summary_segments')).rows.length,0);assert.equal((await pool.query('SELECT * FROM origen_guidance_segments')).rows.length,1);
 }finally{await pool.end();}
});

test('deferred onboarding attribution attaches only after the matching reviewed profile is saved',async()=>{
 const {pool,repo,run}=await setup();try{
  const scope=start(undefined,{topic:'profile',targetKind:'unresolved',studentId:null,pendingStudentId:'new'});await repo.begin('owner',scope,config);
  const item={...summary(),studentId:'new',mode:'profile'},attribution={sessionId:scope.sessionId,segmentIds:[scope.segmentId],language:'en',configuration:config};
  await validateSummarySegments(pool,'owner',item,attribution);await deferSummaryAttribution(pool,'owner',item,attribution);
  await assert.rejects(validateSummarySegments(pool,'owner',{...item,studentId:'s'},attribution),{status:409});
  await run('owner',{action:'save-student',student:{...student,id:'new'}});await createHistoryRepository(pool)('owner',{action:'save',item});
  assert.equal((await pool.query('SELECT * FROM origen_summary_segments')).rows.length,1);assert.equal((await pool.query('SELECT * FROM origen_guidance_summary_intents')).rows.length,0);
  const segment=(await pool.query('SELECT * FROM origen_guidance_segments')).rows[0];assert.equal(segment.student_id,'new');assert.equal(segment.target_kind,'student');
 }finally{await pool.end();}
});

test('issuer mapping, account export/closure and retention cover operational history',async()=>{
 const {pool,repo}=await setup();try{
  await assert.rejects(backfillGuidanceIdentities(pool,'https://tenant.example/'),{status:409});await backfillGuidanceIdentities(pool,'https://tenant.example/',true);await bindGuidanceIdentity(pool,'owner','https://tenant.example/');
  await assert.rejects(bindGuidanceIdentity(pool,'owner','https://other.example/'),{status:403});
  const scope=start();await repo.begin('owner',scope,config);await repo.event('owner',event(scope));
  const life=createLifecycleRepository(pool);const data=await life('owner',{action:'export'});assert.equal(data.guidance.origen_guidance_sessions.length,1);assert.equal(data.guidance.origen_account_identities.length,1);
  await life('owner',{action:'delete',confirmation:'DELETE'});assert.equal((await pool.query('SELECT * FROM origen_guidance_events')).rows.length,0);assert.equal((await pool.query('SELECT * FROM origen_account_identities')).rows.length,1);
  const other=start();await repo.begin('other',other,config);await pool.query('UPDATE origen_guidance_sessions SET started_at=$1 WHERE id=$2',[new Date('2020-01-01'),other.sessionId]);await purgeGuidanceHistory(pool);assert.equal((await pool.query('SELECT * FROM origen_guidance_sessions')).rows.length,0);
 }finally{await pool.end();}
});

test('event allowlist rejects private content, stale clocks and forged ownership fields',()=>{
 const base=event(start());assert.deepEqual(validateGuidanceEvent(base),base);
 for(const bad of [{...base,accountId:'other'},{...base,payload:{transcript:'private'}},{...base,occurredAt:'2020-01-01'},{...base,name:'arbitrary'},{...base,sequence:-1},{...base,segmentId:'not-uuid'}])assert.throws(()=>validateGuidanceEvent(bad),{status:400});
});

test('database constraints reject a segment from a different session even within one account',async()=>{
 const {pool,repo}=await setup();try{
  const first=start(),second=start();await repo.begin('owner',first,config);await repo.begin('owner',second,config);
  const owner=(await pool.query("SELECT id FROM origen_accounts WHERE auth0_subject='owner'")).rows[0].id;
  await assert.rejects(pool.query("INSERT INTO origen_ai_executions(account_id,id,session_id,segment_id,configuration_id,operation,status) VALUES($1,$2,$3,$4,$5,'voice','started')",[owner,crypto.randomUUID(),first.sessionId,second.segmentId,config.id]));
  await assert.rejects(repo.event('owner',event({...first,segmentId:second.segmentId})),{status:404});
 }finally{await pool.end();}
});

test('client preserves topic attribution, freezes queued events and resets target scope without resetting sequence',async()=>{
 const captured=[];const client=guidanceHistory(async body=>captured.push(body));const first=start(),second=start(first.sessionId);client.accept(first);const saved=client.attribution();const pending=client.event('voice.connected');client.accept(second);await pending;
 assert.equal(captured[0].segmentId,first.segmentId);assert.deepEqual(saved.segmentIds,[first.segmentId]);assert.deepEqual(client.attribution().segmentIds,[first.segmentId,second.segmentId]);
 client.resetScope();assert.equal(client.attribution(),undefined);const third=start(first.sessionId);client.accept(third);await client.event('response.started');assert.deepEqual(client.attribution().segmentIds,[third.segmentId]);assert.equal(captured[1].sequence,2);
 client.reset();assert.equal(client.event('voice.connected'),undefined);
});

test('disabled collection and preview requests cannot create operational history',async()=>{
 const {pool}=await setup();try{
  let status,body;const send={writeHead(s){status=s;},end(text){body=JSON.parse(text);}};
  const make=authorized=>Object.assign(Readable.from(['{}']),{url:'/api/guidance-history',method:'POST',headers:{'content-type':'application/json'},origenAuthorized:authorized,origenIdentity:{sub:'owner'}});
  await createGuidanceHandler(pool,{})(make(true),send,()=>assert.fail());assert.equal(body.enabled,false);
  await createGuidanceHandler(pool,{GUIDANCE_HISTORY_ENABLED:'true'})(make(false),send,()=>assert.fail());assert.equal(status,401);assert.equal((await pool.query('SELECT * FROM origen_guidance_sessions')).rows.length,0);
 }finally{await pool.end();}
});

test('authenticated voice start captures configuration and returns attribution while preview remains unrecorded',async()=>{
 const {pool}=await setup();try{
  const env={OPENAI_API_KEY:'test',AUTH0_DOMAIN:'tenant.example',GUIDANCE_HISTORY_ENABLED:'true'};
  const handler=createProfileVoiceHandler(env,async()=>new Response('v=0\r\nsynthetic-answer'),()=>{},pool);const scope=start();
  const req=Object.assign(Readable.from([JSON.stringify({sdp:'v=0',language:'en',role:'parent',mode:'planning',studentId:'s'})]),{url:'/api/profile-voice',method:'POST',headers:{origin:'http://127.0.0.1:5173',host:'127.0.0.1:5173','content-type':'application/json','x-origen-session':scope.sessionId,'x-origen-segment':scope.segmentId},origenAuthorized:true,origenIdentity:{sub:'owner'}});
  let result,status;await handler(req,{writeHead(s){status=s;},end(text){result=JSON.parse(text);}},()=>assert.fail());assert.equal(status,200);assert.equal(result.guidance.segmentId,scope.segmentId);
  const rows=(await pool.query('SELECT * FROM origen_ai_configurations')).rows;assert.equal(rows.length,1);assert.doesNotMatch(JSON.stringify(rows),/Synthetic student|sdp|instructions/);
 }finally{await pool.end();}
});

test('summaries retain model provenance after call end and retries do not regenerate them',async()=>{
 const {pool,repo}=await setup();try{
  const scope=start();await repo.begin('owner',scope,config);await repo.event('owner',{...event(scope),name:'voice.ended',payload:{reason:'completed'}});
  let calls=0;const handler=createSummaryHandler({OPENAI_API_KEY:'test',GUIDANCE_HISTORY_ENABLED:'true'},async()=>{calls++;return new Response(JSON.stringify({status:'completed',model:'synthetic-model-1',usage:{input_tokens:15,output_tokens:20},output:[{content:[{type:'output_text',text:'Synthetic summary'}]}]}));},pool);
  const input={...summary(),language:'es',turns:[{role:'user',text:'Synthetic question'}],guidance:{sessionId:scope.sessionId,segmentIds:[scope.segmentId]}};
  const call=async()=>{let status;const req=Object.assign(Readable.from([JSON.stringify(input)]),{url:'/api/conversation-summary',method:'POST',headers:{origin:'http://127.0.0.1:5173',host:'127.0.0.1:5173','content-type':'application/json'},origenAuthorized:true,origenIdentity:{sub:'owner'}});await handler(req,{writeHead(s){status=s;},end(){}},()=>assert.fail());return status;};
  assert.equal(await call(),200);assert.equal(await call(),200);assert.equal(calls,1);
  const execution=(await pool.query('SELECT * FROM origen_ai_executions')).rows[0];assert.equal(execution.operation,'summary');assert.equal(execution.resolved_model,'synthetic-model-1');assert.equal(execution.status,'completed');assert.equal((await pool.query('SELECT * FROM origen_summary_segments')).rows[0].language,'es');
 }finally{await pool.end();}
});

test('production collection requires an owner and reproducible build revision',()=>{
 const env={AUTH0_DOMAIN:'tenant.example',AUTH0_AUDIENCE:'https://api.example',ALLOWED_ORIGINS:'https://app.example',DATABASE_URL:'postgresql://user@db.example/origen',OPENAI_API_KEY:'test',GUIDANCE_HISTORY_ENABLED:'true'};
 assert.ok(productionConfigIssues(env).some(issue=>issue.startsWith('GUIDANCE_DATA_OWNER')));assert.ok(productionConfigIssues(env).some(issue=>issue.startsWith('APPLICATION_REVISION')));
 assert.deepEqual(productionConfigIssues({...env,GUIDANCE_DATA_OWNER:'designated-owner',APPLICATION_REVISION:'synthetic-revision'}),[]);
 assert.ok(productionConfigIssues({...env,GUIDANCE_LEGACY_ISSUER:'https://other.example/'}).some(issue=>issue.startsWith('GUIDANCE_LEGACY_ISSUER')));
});
