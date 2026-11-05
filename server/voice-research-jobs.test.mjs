import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {retrievalFixture} from './history-retrieval-fixture.mjs';
import {createVoiceResearchJobsHandler} from './voice-research-jobs.mjs';
import {processResearchJob} from './voice-research-worker.mjs';
import {createProfileVoiceHandler} from './profile-voice.mjs';
import {createServer} from 'node:http';
import {createApp} from './index.mjs';
import {createPermissionRepository} from './guardian-permission.mjs';

test('a temporary database outage remains retryable; malformed polling IDs do not',async()=>{
 let connections=0,status;
 const handler=createVoiceResearchJobsHandler({connect:async()=>{connections++;throw Error('temporary database outage');}},{ORIGEN_BACKGROUND_RESEARCH:'true'});
 for(const [id,expected] of [[randomUUID(),503],['invalid',400]]){
  const req=Object.assign(Readable.from([]),{url:'/api/voice-research-jobs?id='+id,method:'GET',headers:{},origenAuthorized:true,origenIdentity:{sub:'fixture'}});
  await handler(req,{writeHead:n=>status=n,end:()=>{}},()=>assert.fail());assert.equal(status,expected);
 }
 assert.equal(connections,1);
});

test('full HTTP gateway supports authenticated polling/cancellation, CORS and account isolation',{skip:!process.env.DATABASE_TEST_URL},async()=>{
 const target=new URL(process.env.DATABASE_TEST_URL);assert.ok(['localhost','127.0.0.1'].includes(target.hostname));
 const f=await retrievalFixture();let server;
 try{
  for(const subject of ['reader','other'])await f.as(subject,()=>createPermissionRepository(f.db).account(subject,{action:'screen',ageBand:'18plus',audience:'grade9plus'}));
  server=createServer(createApp({ORIGEN_BACKGROUND_RESEARCH:'true',ALLOWED_ORIGINS:'http://127.0.0.1:5173'},async token=>{if(!['reader','other','ineligible'].includes(token))throw Error();return {sub:token};},f.db,()=>{}));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
  const call=(method,path,subject='reader',body)=>fetch(base+path,{method,headers:{...(subject?{Authorization:`Bearer ${subject}`}:{ }),Origin:'http://127.0.0.1:5173','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const path='/api/voice-research-jobs';
  const created=await call('POST',path,'reader',{sessionId:randomUUID(),requestKey:'gateway',studentId:'alex',question:'What does Berkeley cost?',institution:'UC Berkeley',mode:'finance',language:'en'});
  assert.equal(created.status,200,await created.clone().text());const {id}=await created.json(),job=path+'?id='+id;
  assert.equal((await call('GET',job,'')).status,401);
  assert.equal((await call('GET',job,'invalid')).status,401);
  assert.equal((await call('GET',job,'ineligible')).status,403);
  assert.equal((await call('GET',job,'other')).status,404);
  assert.equal((await call('DELETE',job,'other')).status,404);
  assert.equal((await call('GET',job)).status,200);
  // More than the application budget of polls must not prevent a normal request.
  for(let i=0;i<125;i++)assert.equal((await call('GET',job)).status,200);
  assert.equal((await call('POST','/api/eligibility','reader',{action:'status'})).status,200);
  assert.match((await call('OPTIONS',path)).headers.get('Access-Control-Allow-Methods'),/DELETE/);
  assert.equal((await call('GET','/api/family')).status,405);
  assert.equal((await call('DELETE','/api/family')).status,405);
  const deleted=await call('DELETE',job);assert.equal(deleted.status,200);assert.equal((await deleted.json()).status,'cancelled');
  assert.equal((await (await call('GET',job)).json()).result,null);
 }finally{server?.closeAllConnections();if(server)await new Promise(r=>server.close(r));await f.close();}
});
test('queue ownership, idempotency, cancellation and restricted worker RLS', {skip:!process.env.DATABASE_TEST_URL},async()=>{
 // Explicit disposable URL only; no production credentials are read by this test.
 const target=new URL(process.env.DATABASE_TEST_URL);assert.ok(['localhost','127.0.0.1'].includes(target.hostname));
 const f=await retrievalFixture();let worker,created=false;
 const handler=createVoiceResearchJobsHandler(f.db,{ORIGEN_BACKGROUND_RESEARCH:'true'});
 async function call(subject,method,input){
  let status,body;const path='/api/voice-research-jobs'+(method==='POST'?'':'?id='+input);
  const req=Object.assign(Readable.from(method==='POST'?[JSON.stringify(input)]:[]),{url:path,method,headers:{},origenAuthorized:true,origenIdentity:{sub:subject}});
  await f.as(subject,()=>handler(req,{writeHead:n=>status=n,end:s=>body=JSON.parse(s)},()=>assert.fail()));return {status,body};
 }
 try{
  const voice=createProfileVoiceHandler({OPENAI_API_KEY:'synthetic',ORIGEN_BACKGROUND_RESEARCH:'true'},async()=>new Response(JSON.stringify({session:{id:'fixture'},transport:{sdp:'v=0\r\nanswer'}}),{status:201}),()=>{},f.db);
  for(const language of ['en','es']){
   let status,data;const body={sdp:'v=0\r\noffer',voiceProtocol:'live-v1',language,role:'student',mode:'planning',studentId:'alex'};
   const req=Object.assign(Readable.from([JSON.stringify(body)]),{url:'/api/profile-voice',method:'POST',headers:{'content-type':'application/json'},origenAuthorized:true,origenIdentity:{sub:'other'}});
   await f.as('other',()=>voice(req,{writeHead:n=>status=n,end:s=>data=JSON.parse(s)},()=>assert.fail()));
   assert.equal(status,200,JSON.stringify(data));assert.equal(data.backgroundResearch,true);
   assert.ok(data.voiceSession.tools.some(tool=>tool.name==='cancel_background_research'));
  }
  const input={sessionId:randomUUID(),requestKey:'call-1',studentId:'alex',question:'What is UC Davis cost?',institution:'UC Davis',mode:'finance',language:'en'};
  const first=await call('reader','POST',input);assert.equal(first.status,200,JSON.stringify(first));
  assert.equal((await call('reader','POST',input)).body.id,first.body.id);
  assert.equal((await call('other','GET',first.body.id)).status,404);
  assert.equal((await call('other','DELETE',first.body.id)).status,404);
  assert.equal((await call('reader','POST',{...input,studentId:'not-owned',requestKey:'wrong'})).status,403);
  const exists=(await f.owner.query("SELECT 1 FROM pg_roles WHERE rolname='origen_research_worker'")).rows.length;
  if(!exists){await f.owner.query('CREATE ROLE origen_research_worker NOLOGIN NOSUPERUSER NOBYPASSRLS');created=true;}
  await f.owner.query(`GRANT USAGE ON SCHEMA ${f.schema} TO origen_research_worker`);
  await f.owner.query('GRANT SELECT,UPDATE,DELETE ON origen_voice_research_jobs TO origen_research_worker');
 await f.owner.query('GRANT EXECUTE ON FUNCTION origen_current_account_id() TO origen_research_worker');
  worker=await f.owner.connect();await worker.query('SET ROLE origen_research_worker');
  await assert.rejects(worker.query('SELECT * FROM origen_students'),/permission denied/);
  let calls=0;
  const provider=async()=>{calls++;return new Response(JSON.stringify({output:[{type:'web_search_call',status:'completed'},{type:'message',content:[{type:'output_text',text:'Verified cost.',annotations:[{type:'url_citation',url:'https://financialaid.ucdavis.edu/cost',title:'Cost',start_index:0,end_index:8}]}]}]}));};
  await processResearchJob(worker,{}, {request:provider});assert.equal(calls,1);
  const completed=await call('reader','GET',first.body.id);assert.equal(completed.body.status,'completed');assert.equal(completed.body.result.sources.length,1);
  await call('reader','DELETE',first.body.id);assert.equal((await call('reader','GET',first.body.id)).body.result,null);
  const next=await call('reader','POST',{...input,requestKey:'call-2',language:'es'});await call('reader','DELETE',next.body.id);
  assert.equal(await processResearchJob(worker,{}, {request:provider}),false);assert.equal(calls,1);
  for(let i=3;i<=6;i++)assert.equal((await call('reader','POST',{...input,requestKey:'call-'+i})).status,200);
  assert.equal((await call('reader','POST',{...input,requestKey:'call-7'})).status,429);
 }finally{
  if(worker){await worker.query('RESET ROLE');worker.release();}
  if(created){await f.owner.query('DROP OWNED BY origen_research_worker');await f.owner.query('DROP ROLE origen_research_worker');}
  await f.close();
 }
});

test('authorized voice negotiation selects a server owner and stages server-only guide updates',{skip:!process.env.DATABASE_TEST_URL},async()=>{
 const target=new URL(process.env.DATABASE_TEST_URL);assert.ok(['localhost','127.0.0.1'].includes(target.hostname));
 const f=await retrievalFixture();const provider=[],registered=[],staged=[];const sessionId=randomUUID();
 const control={available:true,register:value=>{registered.push(value);return {protocol:'server-v1',id:'opaque-handle'};},stage:(...args)=>{staged.push(args);return 'one-use-update';}};
 const voice=createProfileVoiceHandler({OPENAI_API_KEY:'synthetic',ORIGEN_BACKGROUND_RESEARCH:'true',ORIGEN_LIVE_SERVER_CONTROL:'true'},async(url,options)=>{provider.push(JSON.parse(options.body));return new Response(JSON.stringify({session:{id:'live_session_fixture'},transport:{sdp:'v=0\r\nanswer'}}),{status:201});},()=>{},f.db,control);
 async function call(extra={}){
  let status,data;const body={sdp:'v=0\r\noffer',voiceProtocol:'live-v1',voiceControlProtocol:'server-v1',language:'en',role:'student',mode:'planning',studentId:'alex',...extra};
  const req=Object.assign(Readable.from([JSON.stringify(body)]),{url:'/api/profile-voice',method:'POST',headers:{'content-type':'application/json','x-origen-session':sessionId},origenAuthorized:true,origenPermissionRevision:7,origenIdentity:{sub:'other'}});
  await f.as('other',()=>voice(req,{writeHead:n=>status=n,end:s=>data=JSON.parse(s)},()=>assert.fail()));return {status,data};
 }
 try{
  const start=await call();assert.equal(start.status,200,JSON.stringify(start.data));assert.equal(start.data.voiceControl.id,'opaque-handle');assert.equal(start.data.providerId,undefined);
  assert.ok(start.data.voiceSession.tools.some(tool=>tool.name==='read_research_details'));
  assert.deepEqual(provider[0].session.client.data_channel.allowed_client_events,['session.close']);assert.equal(registered[0].subject,'other');assert.equal(registered[0].permissionRevision,7);assert.equal(registered[0].scope.studentId,'alex');
  const update=await call({action:'update-guide',voiceControlId:'opaque-handle',language:'es'});assert.equal(update.status,200,JSON.stringify(update.data));assert.equal(update.data.session.controlUpdateId,'one-use-update');assert.equal(staged[0][0],'opaque-handle');assert.equal(staged[0][1],'other');assert.equal(staged[0][3].sessionId,sessionId);
  const fallback=await call({voiceControlProtocol:undefined});assert.equal(fallback.status,200);assert.equal(fallback.data.voiceControl,undefined);assert.equal(provider.at(-1).session.client,undefined);
  assert.ok(!fallback.data.voiceSession.tools.some(tool=>tool.name==='read_research_details'));
 }finally{await f.close();}
});
