import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {fixture} from './family-fixture.mjs';
import {onboardingBatch,storeOnboardingBatch} from './onboarding-events.mjs';
import {adminOnboardingTimeline,adminOnboardingAttempt} from './admin-onboarding.mjs';
import {createAdminHandler} from './admin.mjs';

test('history validates account, attempt, period and pagination before reads',async()=>{
 const db={query:()=>assert.fail('invalid input queried database')},id=crypto.randomUUID();
 for(const input of [{id:'bad'},{id,days:365},{id,page:0},{id,page:1.5},{id,page:10001}])await assert.rejects(adminOnboardingTimeline(db,input),{status:400});
 await assert.rejects(adminOnboardingAttempt(db,{id,attemptId:'bad'}),{status:400});
 await assert.rejects(adminOnboardingTimeline({query:async()=>({rows:[]})},{id}),{status:404});
});

test('missing capture coverage is explicit and does not masquerade as zero attempts',async()=>{
 const queries=[],id=crypto.randomUUID(),now=new Date('2026-10-09T20:00:00Z');
 const result=await adminOnboardingTimeline({query:async sql=>{queries.push(sql);return {rows:sql.includes('origen_accounts')?[{id,created_at:'2026-10-01'}]:[]};}},{id},now);
 assert.equal(result.coverage.available,false);assert.equal(result.coverage.measuredSince,null);
 assert.equal(queries.length,2);assert.ok(!queries.some(sql=>sql.includes('FROM origen_onboarding')));
 const broken={query:async sql=>{if(sql.includes('origen_accounts'))return {rows:[{id}]};throw new Error('network unavailable');}};
 await assert.rejects(adminOnboardingTimeline(broken,{id}),/network unavailable/);
});

test('admin-only history reads deny regular users before queries and safely report a failed read',async()=>{
 for(const action of ['onboarding-timeline','onboarding-attempt']){
  for(const authorized of [false,true]){
   let queried=false,status;
   const handler=createAdminHandler({query:async()=>{queried=true;}},{});
   const req=Object.assign(Readable.from([JSON.stringify({action,id:crypto.randomUUID(),attemptId:crypto.randomUUID()})]),{url:'/api/admin',origenAuthorized:authorized,origenIdentity:{sub:'auth0|regular'}});
   await handler(req,{writeHead:value=>status=value,end:()=>{}},()=>{});
   assert.equal(status,authorized?403:401);assert.equal(queried,false);
  }
 }
 let status,payload;
 const handler=createAdminHandler({query:async()=>{throw new Error('private database detail');}},{});
 const req=Object.assign(Readable.from([JSON.stringify({action:'onboarding-timeline',id:crypto.randomUUID()})]),{url:'/api/admin',origenAuthorized:true,origenIdentity:{sub:'auth0|admin',permissions:['read:activity']}});
 await handler(req,{writeHead:value=>status=value,end:value=>payload=JSON.parse(value)},()=>{});
 assert.equal(status,503);assert.deepEqual(payload,{error:'onboarding_history_unavailable'});
});

test('timeline follows return visits, separates browser/server saves and never borrows another account history',async()=>{
 const {pool,run}=await fixture();
 try{
  await pool.query('CREATE TABLE origen_schema_migrations(name text PRIMARY KEY,applied_at timestamptz)');
  await pool.query("INSERT INTO origen_schema_migrations VALUES('027_onboarding_events.sql','2026-10-01T00:00:00Z')");
  await run('auth0|one',{action:'load'});await run('auth0|two',{action:'load'});
  const accounts=(await pool.query('SELECT id,auth0_subject FROM origen_accounts')).rows,id=accounts.find(a=>a.auth0_subject==='auth0|one').id,other=accounts.find(a=>a.auth0_subject==='auth0|two').id;
  await pool.query('UPDATE origen_accounts SET created_at=$1 WHERE id=$2',['2026-09-20',id]);
  const first=crypto.randomUUID(),second=crypto.randomUUID();
  const batch=(attemptId,names)=>onboardingBatch({attemptId,events:names.map((name,i)=>({sequence:i+1,name,occurredAt:new Date(Date.now()+i).toISOString(),metadata:{language:'es',transcript:'private answer'}}))});
  await storeOnboardingBatch(pool,'auth0|one',batch(first,['onboarding_opened','voice_connection_failed','logout_selected']));
  await storeOnboardingBatch(pool,'auth0|one',batch(second,['onboarding_opened','save_failed','save_succeeded','home_reached']));
  await storeOnboardingBatch(pool,'auth0|two',batch(first,['onboarding_opened','save_succeeded']));
  // Stable timing for predictable ordering, regardless of pg-mem's clock.
  await pool.query('UPDATE origen_onboarding_attempts SET started_at=$1,last_received_at=$2 WHERE account_id=$3 AND id=$4',['2026-10-08','2026-10-09',id,first]);
  await pool.query('UPDATE origen_onboarding_attempts SET started_at=$1,last_received_at=$2 WHERE account_id=$3 AND id=$4',['2026-10-09','2026-10-09',id,second]);
  const now=new Date(Date.now()+60000),timeline=await adminOnboardingTimeline(pool,{id,days:30},now);
  assert.equal(timeline.total,2);assert.equal(timeline.coverage.olderAccount,true);
  const later=timeline.attempts.find(a=>a.id===second),earlier=timeline.attempts.find(a=>a.id===first);
  assert.equal(later.resumed,true);assert.equal(later.saved_at,null);assert.equal(later.clientSaveSucceeded,true);assert.equal(later.homeReached,true);assert.equal(later.saveFailed,true);
  assert.equal(earlier.voiceFailed,true);assert.equal(earlier.logoutSelected,true);assert.equal(earlier.eventCount,3);
  const details=await adminOnboardingAttempt(pool,{id,attemptId:first},now);
  assert.deepEqual(details.events.map(e=>e.name),['onboarding_opened','voice_connection_failed','logout_selected']);
  assert.doesNotMatch(JSON.stringify(details),/private answer/);
  // UUID reuse is account-scoped in phase 1; admins still read the requested owner only.
  assert.equal((await adminOnboardingAttempt(pool,{id:other,attemptId:first},now)).total,2);
  await assert.rejects(adminOnboardingAttempt(pool,{id:other,attemptId:second},now),{status:404});
  await run('auth0|one',{action:'complete-onboarding',onboardingAttemptId:second,account:{firstName:'Ana',email:'',role:'student'}});
  assert.ok((await adminOnboardingTimeline(pool,{id},now)).attempts.find(a=>a.id===second).saved_at);
 }finally{await pool.end();}
});

test('attempt and event paging is bounded; the reporting period keeps a full retained attempt',async()=>{
 const {pool,run}=await fixture();
 try{
  await pool.query('CREATE TABLE origen_schema_migrations(name text PRIMARY KEY,applied_at timestamptz)');
  await pool.query("INSERT INTO origen_schema_migrations VALUES('027_onboarding_events.sql','2026-10-01')");
  await run('auth0|one',{action:'load'});
  const id=(await pool.query('SELECT id FROM origen_accounts')).rows[0].id,ids=Array.from({length:7},()=>crypto.randomUUID());
  for(let i=0;i<ids.length;i++)await pool.query('INSERT INTO origen_onboarding_attempts(account_id,id,started_at,last_received_at) VALUES($1,$2,$3,$4)',[id,ids[i],`2026-09-${20+i}T00:00:00Z`,i===6?'2026-09-26':'2026-10-09']);
  for(let sequence=1;sequence<=53;sequence++)await pool.query("INSERT INTO origen_onboarding_events(account_id,attempt_id,producer,sequence,name,occurred_at,received_at,metadata) VALUES($1,$2,'client',$3,'fields_updated',$4,$5,$6)",[id,ids[0],sequence,new Date(Date.parse('2026-09-20')+sequence*1000).toISOString(),'2026-10-09',{fields:{account_name:true},transcript:'secret',school:'secret'}]);
  const now=new Date('2026-10-09T23:00:00Z');
  const first=await adminOnboardingTimeline(pool,{id,days:7},now),second=await adminOnboardingTimeline(pool,{id,days:7,page:2},now);
  assert.equal(first.total,6);assert.equal(first.attempts.length,5);assert.equal(second.attempts.length,1);assert.equal(second.attempts[0].id,ids[0]);
  assert.equal(new Set([...first.attempts,...second.attempts].map(a=>a.id)).size,6);
  const events=await adminOnboardingAttempt(pool,{id,days:7,attemptId:ids[0]},now),tail=await adminOnboardingAttempt(pool,{id,days:7,attemptId:ids[0],page:2},now);
  assert.equal(events.total,53);assert.equal(events.events.length,50);assert.deepEqual(tail.events.map(e=>e.sequence),[51,52,53]);
  assert.equal(events.events[0].sequence,1);assert.deepEqual(events.events[0].metadata,{fields:{account_name:true}});assert.doesNotMatch(JSON.stringify(events),/secret/);
  await assert.rejects(adminOnboardingAttempt(pool,{id,days:7,attemptId:ids[6]},now),{status:404});
 }finally{await pool.end();}
});
