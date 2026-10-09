import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {fixture} from './family-fixture.mjs';
import {onboardingBatch,storeOnboardingBatch,createOnboardingHandler,recordOnboardingSave,purgeOnboardingEvents} from './onboarding-events.mjs';
import {onboardingEvents,onboardingFieldPresence} from '../src/onboardingEvents.mjs';
const input=(name='onboarding_opened')=>({attemptId:crypto.randomUUID(),events:[{sequence:1,name,occurredAt:new Date().toISOString(),metadata:{language:'en'}}]});

test('onboarding payloads strip profile answers and reject forged server events, dates and unbounded batches',()=>{
 const raw=input('fields_updated');raw.accountId='forged';raw.events[0].metadata={language:'es',transcript:'secret',name:'secret',code:'private-error',fields:{student_name:true,school:'private-school',notes:false,other:true},reason:'private'};
 const clean=onboardingBatch(raw);assert.deepEqual(clean.events[0].metadata,{language:'es',code:'other',fields:{student_name:true,notes:false}});
 assert.doesNotMatch(JSON.stringify(clean),/secret|forged|private/);
 for(const event of [{name:'profile_saved'},{sequence:0},{sequence:2001},{occurredAt:'bad'},{occurredAt:'1999-01-01'},{occurredAt:new Date(Date.now()+600000).toISOString()}])assert.throws(()=>onboardingBatch({...input(),events:[{...input().events[0],...event}]}),{status:400});
 assert.throws(()=>onboardingBatch({...input(),events:Array(26).fill(input().events[0])}),{status:400});
 assert.throws(()=>onboardingBatch({...input(),events:[input().events[0],input().events[0]]}),{status:400});
});

test('database binds events to the authenticated account, handles late delivery, resumes and deduplicates retries',async()=>{
 const {pool,run}=await fixture();
 try{
  await run('auth0|one',{action:'load'});await run('auth0|two',{action:'load'});
  const first=onboardingBatch(input());await storeOnboardingBatch(pool,'auth0|one',first);await storeOnboardingBatch(pool,'auth0|one',first);
  // The same attempt UUID from a different identity can only write its own rows.
  await storeOnboardingBatch(pool,'auth0|two',first);
  const next=onboardingBatch(input('voice_connected'));await storeOnboardingBatch(pool,'auth0|one',next);
  const rows=(await pool.query('SELECT * FROM origen_onboarding_attempts ORDER BY started_at')).rows;
  assert.equal(rows.length,3);assert.equal(rows.filter(row=>row.resumed).length,1);
  assert.equal((await pool.query('SELECT * FROM origen_onboarding_events')).rows.length,3);
  await assert.rejects(storeOnboardingBatch(pool,'auth0|unknown',first),{status:404});
 }finally{await pool.end();}
});

test('saving a profile records one authoritative success even before the open event arrives',async()=>{
 const {pool,run}=await fixture();
 try{
  const attemptId=crypto.randomUUID();const operation={action:'complete-onboarding',onboardingAttemptId:attemptId,account:{firstName:'Ana',email:'',role:'student'}};
  await run('auth0|one',operation);await run('auth0|one',operation);
  await storeOnboardingBatch(pool,'auth0|one',onboardingBatch({...input(),attemptId}));
  const rows=(await pool.query('SELECT * FROM origen_onboarding_events')).rows;
  assert.equal(rows.filter(row=>row.producer==='server'&&row.name==='profile_saved').length,1);
  assert.equal(rows.filter(row=>row.producer==='client').length,1);
  assert.ok((await pool.query('SELECT saved_at FROM origen_onboarding_attempts')).rows[0].saved_at);
 }finally{await pool.end();}
});

test('tracker opens once, records booleans and stops onboarding events after home while voice can continue',async()=>{
 const sent=[];const tracker=onboardingEvents(async body=>sent.push(body));
 tracker.open({language:'en'});tracker.open({language:'en'});
 const fields=onboardingFieldPresence('Ana','student',{name:'Ana',school:'private-school',notes:''});
 tracker.fields(fields);tracker.fields(fields);tracker.homeReached();tracker.event('voice_ended',{reason:'unknown'});tracker.homeReached();await tracker.flush();
 const events=sent.flatMap(body=>body.events);assert.deepEqual(events.map(event=>event.name),['onboarding_opened','fields_updated','home_reached']);
 assert.equal(fields.student_name,true);assert.equal(fields.school,true);assert.equal(fields.notes,false);
 assert.doesNotMatch(JSON.stringify(sent),/Ana|private-school/);
 assert.deepEqual(events.map(event=>event.sequence),[1,2,3]);
});

test('failed diagnostic SQL restores the profile transaction to its savepoint',async()=>{
 const calls=[];
 const client={query:async(sql)=>{calls.push(sql);if(sql.startsWith('INSERT INTO origen_onboarding_attempts'))throw new Error('diagnostic unavailable');return {rows:sql.includes('count(*)')?[{count:0}]:[]};}};
 await assert.doesNotReject(recordOnboardingSave(client,crypto.randomUUID(),crypto.randomUUID()));
 assert.equal(calls[0],'SAVEPOINT origen_onboarding_tracking');
 assert.deepEqual(calls.slice(-2),['ROLLBACK TO SAVEPOINT origen_onboarding_tracking','RELEASE SAVEPOINT origen_onboarding_tracking']);
 assert.ok(!calls.some(sql=>sql==='ROLLBACK'));
});

test('tracker isolates transport failures, skips previews and records explicit logout as the end reason',async()=>{
 const tracker=onboardingEvents(async()=>{throw new Error('offline');});tracker.open({});tracker.event('save_failed');await assert.doesNotReject(tracker.flush());
 const sent=[];const next=onboardingEvents(async body=>sent.push(body));next.open({});await next.logout();next.event('voice_ended',{reason:'unknown'});await next.flush();
 assert.equal(sent.flatMap(body=>body.events).at(-1).metadata.reason,'logout');
 const preview=onboardingEvents(async()=>assert.fail('preview must not send'),{enabled:false});preview.open({});preview.event('voice_connected');await preview.flush();
});

test('endpoint requires authentication and JSON and safely reports unavailable tracking',async()=>{
 async function request(authorized,body=input(),type='application/json',database=null){
  const req=Object.assign(Readable.from([JSON.stringify(body)]),{url:'/api/onboarding-events',method:'POST',headers:{'content-type':type},origenAuthorized:authorized,origenIdentity:{sub:'auth0|one'}});
  let status;const res={writeHead:value=>status=value,end:()=>{}};await createOnboardingHandler(database)(req,res,()=>assert.fail('wrong route'));return status;
 }
 assert.equal(await request(false),401);assert.equal(await request(true),503);
 const {pool,run}=await fixture();try{await run('auth0|one',{action:'load'});assert.equal(await request(true,input(),'text/plain',pool),415);assert.equal(await request(true,input(),'application/json',pool),200);assert.equal(await request(true,{attemptId:'bad'},'application/json',pool),400);}finally{await pool.end();}
});

test('retention deletes old attempts and cascades only their events',async()=>{
 const {pool,run}=await fixture();try{
  await run('auth0|one',{action:'load'});const old=onboardingBatch(input()),current=onboardingBatch(input());
  await storeOnboardingBatch(pool,'auth0|one',old);await storeOnboardingBatch(pool,'auth0|one',current);
  await pool.query('UPDATE origen_onboarding_attempts SET last_received_at=$1 WHERE id=$2',['2025-01-01T00:00:00Z',old.attemptId]);
  await purgeOnboardingEvents(pool);
  assert.equal((await pool.query('SELECT * FROM origen_onboarding_attempts')).rows.length,1);
  assert.equal((await pool.query('SELECT * FROM origen_onboarding_events')).rows.length,1);
 }finally{await pool.end();}
});
