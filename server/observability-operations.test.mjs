import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createServer} from 'node:http';
import {createDiagnosticOperations,assertDiagnosticOperationsReady,purgeDiagnosticOperations} from './observability/operations.mjs';
import {migrateDatabase} from './database.mjs';
import {isolateDatabase,runAsAccount,runAsAnalytics,runRetentionJob,assertRuntimeIsolation} from './account-isolation.mjs';
import {grantRuntimeAccess} from './runtime-grants.mjs';
import {createFamilyRepository,validateFamily} from './family.mjs';
import {createPermissionRepository} from './guardian-permission.mjs';
import {createApp} from './index.mjs';

test('mapping failures are bounded and do not expose exceptions or raw hints',async()=>{
 const repo=createDiagnosticOperations({connect:async()=>{throw new Error('private SQL credential');}});
 assert.deepEqual(await repo('private-subject',{studentId:null,kind:'voice',hint:randomUUID()}),{reason:'mapping_unavailable'});
 assert.deepEqual(await repo('private-subject',{studentId:undefined,kind:'voice',hint:randomUUID()}),{reason:'mapping_scope_unavailable'});
 let release,lateReleased=false;const blocked=createDiagnosticOperations({connect:()=>new Promise(r=>{release=r;})});
 const start=Date.now();assert.equal((await blocked('a',{studentId:null,kind:'voice',hint:randomUUID()})).reason,'mapping_unavailable');assert.ok(Date.now()-start<1500);
 release({release(){lateReleased=true;}});await Promise.resolve();assert.equal(lateReleased,true);
 const waiting=[];const capped=createDiagnosticOperations({connect:()=>new Promise(resolve=>waiting.push(resolve))});
 await Promise.all([1,2].map(()=>capped('a',{studentId:null,kind:'voice',hint:randomUUID()})));
 assert.equal((await capped('a',{studentId:null,kind:'voice',hint:randomUUID()})).reason,'mapping_capacity');assert.equal(waiting.length,2);
 for(const resolve of waiting)resolve({release(){}});await Promise.resolve();
});

test('PostgreSQL operation mappings enforce ownership, caps, expiry, cascades and correlated failure/retry',{skip:!process.env.DATABASE_TEST_URL},async()=>{
 const suffix=randomUUID().replaceAll('-',''),schema=`diag_${suffix}`,role=`diag_user_${suffix}`;
 const ownerPool=new pg.Pool({connectionString:process.env.DATABASE_TEST_URL,max:1,options:`-c search_path=${schema}`});
 const owner=await ownerPool.connect();let runtimePool,server;
 const nativeFetch=globalThis.fetch;
 try{
  await owner.query(`CREATE SCHEMA ${schema}`);await owner.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT`);
  const migration={connect:async()=>({query:(...args)=>owner.query(...args),release(){}})};
  await migrateDatabase(migration);await grantRuntimeAccess(migration,role,{schema});
  const url=new URL(process.env.DATABASE_TEST_URL);url.username=role;url.password='';
  runtimePool=new pg.Pool({connectionString:url.href,max:5,options:`-c search_path=${schema}`});
  await assertRuntimeIsolation(runtimePool,{schema});await assertDiagnosticOperationsReady(runtimePool);
  const db=isolateDatabase(runtimePool,{schema}),as=(sub,work)=>runAsAccount({sub},work);
  const family=(sub,input)=>createFamilyRepository(db)(sub,validateFamily(input)),permission=createPermissionRepository(db);
  for(const sub of ['private-alice','private-bob']){
   await as(sub,()=>permission.account(sub,{action:'screen',ageBand:'18plus',audience:'grade9plus'}));
   await as(sub,()=>family(sub,{action:'save-account',account:{firstName:'Synthetic',role:'student',email:''}}));
   for(const id of ['private-a','private-b'])await as(sub,()=>family(sub,{action:'save-student',student:{id,name:'Synthetic',stage:'College'}}));
  }
  const repo=createDiagnosticOperations(db),hint=randomUUID(),map=(sub,studentId,kind='voice',h=hint)=>as(sub,()=>repo(sub,{studentId,kind,hint:h}));
  const a=await map('private-alice','private-a');assert.ok(a.operationId);assert.notEqual(a.operationId,hint);
  assert.deepEqual(await map('private-alice','private-a'),a);
  const parallel=await Promise.all([map('private-alice',null),map('private-alice',null)]);assert.deepEqual(parallel[0],parallel[1]);assert.ok(parallel[0].operationId);
  assert.notEqual((await map('private-alice','private-b')).operationId,a.operationId);assert.notEqual((await map('private-bob','private-a')).operationId,a.operationId);
  assert.equal((await map('private-alice','not-owned')).reason,'mapping_scope_unavailable');
  assert.equal((await as('private-bob',()=>db.query('SELECT * FROM origen_diagnostic_operations WHERE operation_id=$1',[a.operationId]))).rows.length,0);
  await as('private-alice',()=>runAsAnalytics(async()=>assert.equal((await db.query('SELECT * FROM origen_diagnostic_operations')).rows.length,3)));
  // An analytics purpose without an owning subject cannot use the ordinary owner policy.
  assert.equal((await runRetentionJob(()=>db.query('SELECT * FROM origen_diagnostic_operations'))).rows.length,0);
  await assert.rejects(as('private-alice',()=>db.query('UPDATE origen_diagnostic_operations SET expires_at=now()')),{code:'42501'});
  const id=(await owner.query('SELECT account_id FROM origen_diagnostic_operations WHERE operation_id=$1',[a.operationId])).rows[0].account_id;
  const old=new Date(Date.now()-86401000);
  await owner.query("UPDATE origen_diagnostic_operations SET created_at=$2,expires_at=$2::timestamptz+interval '336 hours' WHERE operation_id=$1",[a.operationId,old]);
  assert.equal((await map('private-alice','private-a')).reason,'mapping_expired');
  const expired=new Date(Date.now()-15*86400000);await owner.query("UPDATE origen_diagnostic_operations SET created_at=$2,expires_at=$2::timestamptz+interval '336 hours' WHERE operation_id=$1",[a.operationId,expired]);
  await runRetentionJob(()=>purgeDiagnosticOperations(db));assert.equal((await owner.query('SELECT * FROM origen_diagnostic_operations WHERE operation_id=$1',[a.operationId])).rows.length,0);
  // Serializes the rolling budget under the same account lock as inserts.
  await owner.query('DELETE FROM origen_diagnostic_operations WHERE account_id=$1',[id]);
  for(let i=0;i<100;i++)assert.ok((await map('private-alice',null,'notes',randomUUID())).operationId);
  assert.equal((await map('private-alice',null,'notes',randomUUID())).reason,'mapping_capacity');
  await owner.query('DELETE FROM origen_diagnostic_operations WHERE account_id=$1',[id]);
  await owner.query("INSERT INTO origen_diagnostic_operations(operation_id,account_id,kind,client_operation_id,trace_id,created_at,expires_at) SELECT gen_random_uuid(),$1,'notes',gen_random_uuid(),repeat('a',32),now()-interval '2 hours',now()-interval '2 hours'+interval '336 hours' FROM generate_series(1,1000)",[id]);
  assert.equal((await map('private-alice',null,'notes',randomUUID())).reason,'mapping_capacity');
  await owner.query('DELETE FROM origen_diagnostic_operations WHERE account_id=$1',[id]);
  const headers={'Content-Type':'application/json',Authorization:'Bearer private-alice','X-Origen-Operation':randomUUID()};
  let failSave=true,failMapping=false;const logs=[];
  const broken={...db,connect:async()=>{const c=await db.connect(),query=c.query.bind(c);c.query=(sql,args)=>{if(failMapping&&typeof sql==='string'&&sql.startsWith('INSERT INTO origen_diagnostic_operations'))throw new Error('private mapping error');if(failSave&&typeof sql==='string'&&sql.startsWith('INSERT INTO origen_conversation_summaries'))throw Object.assign(new Error('private transcript SELECT password'),{code:'53300'});return query(sql,args);};return c;}};
  globalThis.fetch=(url,options)=>String(url).startsWith('https://api.openai.com/')?Promise.resolve(Response.json({status:'completed',output:[{content:[{type:'output_text',text:'Synthetic saved summary'}]}]})):nativeFetch(url,options);
  const app=createApp({OBSERVABILITY_OPERATION_LINKS:'true',OPENAI_API_KEY:'synthetic'},async sub=>({sub}),broken,r=>logs.push(r));server=createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}`,body=JSON.stringify({id:randomUUID(),studentId:'private-a',mode:'planning',date:new Date().toISOString(),language:'en',turns:[{role:'user',text:'PRIVATE transcript marker'}],sources:[]});
  const first=await nativeFetch(base+'/api/conversation-summary',{method:'POST',headers,body});assert.equal(first.status,502);const operationId=first.headers.get('X-Origen-Operation-ID');assert.ok(operationId);
  failSave=false;const retry=await nativeFetch(base+'/api/conversation-summary',{method:'POST',headers,body});assert.equal(retry.status,200);assert.equal(retry.headers.get('X-Origen-Operation-ID'),operationId);
  await nativeFetch(base+'/api/voice-diagnostics',{method:'POST',headers,body:JSON.stringify({event:'operation_response_received',operationKind:'summary',studentId:'private-a',status:'completed'})});await app.flushLogs();
  const timeline=logs.filter(r=>r.operationId===operationId);assert.ok(timeline.some(r=>r.event==='summary.generate.finished'&&r.outcome==='completed'));assert.ok(timeline.some(r=>r.event==='summary.save.finished'&&r.outcome==='failed'));assert.ok(timeline.some(r=>r.event==='summary.save.finished'&&r.outcome==='completed'));assert.ok(timeline.some(r=>r.event==='operation_response_received'&&r.producer==='browser'));
  assert.equal(new Set(timeline.map(r=>r.traceId)).size,1);assert.doesNotMatch(JSON.stringify(logs),new RegExp(`PRIVATE|private-alice|private-a|${headers['X-Origen-Operation']}|SELECT|password`));
  // A mapping-store failure cannot prevent a genuine note save.
  failMapping=true;
  const note=await nativeFetch(base+'/api/topic-notes',{method:'POST',headers:{...headers,'X-Origen-Operation':randomUUID()},body:JSON.stringify({action:'create',id:randomUUID(),studentId:'private-a',note:{topic:'options',kind:'note',content:'Synthetic note',language:'en'}})});
  assert.equal(note.status,200);assert.equal(note.headers.get('X-Origen-Operation-ID'),null);failMapping=false;
  const oldHeaders={...headers};delete oldHeaders['X-Origen-Operation'];
  const legacy=await nativeFetch(base+'/api/topic-notes',{method:'POST',headers:oldHeaders,body:JSON.stringify({action:'load',studentId:'private-a'})});assert.equal(legacy.status,200);assert.equal(legacy.headers.get('X-Origen-Operation-ID'),null);
  const off=createServer(createApp({OBSERVABILITY_OPERATION_LINKS:'false'},async sub=>({sub}),db,()=>{}));await new Promise(r=>off.listen(0,'127.0.0.1',r));
  try{const response=await nativeFetch(`http://127.0.0.1:${off.address().port}/api/topic-notes`,{method:'POST',headers,body:JSON.stringify({action:'load',studentId:'private-a'})});assert.equal(response.status,200);assert.equal(response.headers.get('X-Origen-Operation-ID'),null);}finally{await new Promise(r=>off.close(r));}
  // Foreign students and revoked permission do not authorize correlation.
  const other=await nativeFetch(base+'/api/topic-notes',{method:'POST',headers,body:JSON.stringify({action:'load',studentId:'foreign'})});assert.equal(other.status,404);assert.equal(other.headers.get('X-Origen-Operation-ID'),null);
  await as('private-alice',()=>permission.account('private-alice',{action:'withdraw'}));const revoked=await nativeFetch(base+'/api/conversation-summary',{method:'POST',headers,body});assert.equal(revoked.status,403);assert.equal(revoked.headers.get('X-Origen-Operation-ID'),null);
  await owner.query('DELETE FROM origen_students WHERE account_id=$1 AND id=$2',[id,'private-a']);assert.equal((await owner.query('SELECT * FROM origen_diagnostic_operations WHERE account_id=$1 AND student_id=$2',[id,'private-a'])).rows.length,0);
  await owner.query('DELETE FROM origen_accounts WHERE id=$1',[id]);assert.equal((await owner.query('SELECT * FROM origen_diagnostic_operations WHERE account_id=$1',[id])).rows.length,0);
 }finally{
  globalThis.fetch=nativeFetch;if(server)await new Promise(r=>server.close(r));await runtimePool?.end();
  try{await owner.query(`DROP SCHEMA IF EXISTS ${schema}_reporting CASCADE`);await owner.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await owner.query(`DROP ROLE IF EXISTS ${role}`);}finally{owner.release();await ownerPool.end();}
 }
});
