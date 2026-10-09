import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {onboardingDelivery} from '../src/onboardingDelivery.mjs';
import {onboardingEvents} from '../src/onboardingEvents.mjs';
import {onboardingSettings,onboardingConfigIssues} from './onboarding-settings.mjs';
import {onboardingAlertReport,adminOnboardingAlerts} from './onboarding-alerts.mjs';
import {onboardingBatch,storeOnboardingBatch,purgeOnboardingEvents} from './onboarding-events.mjs';
import {adminOnboardingMetrics} from './admin-onboarding-metrics.mjs';
import {adminOnboardingTimeline} from './admin-onboarding.mjs';
import {createAdminHandler} from './admin.mjs';
import {fixture} from './family-fixture.mjs';
const storage=()=>{const map=new Map();return {get length(){return map.size;},key:i=>[...map.keys()][i]??null,getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value),removeItem:key=>map.delete(key),map};};
function clock(){let at=Date.now(),next=0;const tasks=new Map();return {now:()=>at,advance:ms=>at+=ms,schedule:(cb,ms)=>{const id=++next;tasks.set(id,{cb,ms});return id;},cancel:id=>tasks.delete(id),tasks};}
const event=(c,sequence=1,name='onboarding_opened',metadata={})=>({sequence,name,occurredAt:new Date(c.now()).toISOString(),metadata});
test('failed delivery survives refresh, strips content and replays only the signed-in scope',async()=>{
 const c=clock(),s=storage(),id=crypto.randomUUID(),other=crypto.randomUUID(),sent=[];
 const first=onboardingDelivery(async()=>{throw new Error('offline');},{...c,storage:s,scope:'one',random:()=>.5});
 first.enqueue(id,event(c,1,'onboarding_opened',{language:'es',token:'secret',transcript:'private words',fields:{school:true,name:'Private'}}));await first.flush();first.pause();
 assert.equal(first.pending,1);assert.doesNotMatch([...s.map.values()].join(''),/secret|private words|Private/);
 s.setItem(`origen.user.two.onboarding-events.${other}`,JSON.stringify({version:1,events:[event(c)]}));
 const replay=onboardingDelivery(async body=>sent.push(body),{...c,storage:s,scope:'one'});replay.resume();await replay.flush();
 assert.equal(sent.length,1);assert.equal(sent[0].attemptId,id);assert.equal(sent[0].events[0].sequence,1);assert.deepEqual(sent[0].events[0].metadata,{language:'es',fields:{school:true}});
 assert.ok(s.getItem(`origen.user.two.onboarding-events.${other}`));assert.equal(replay.pending,0);replay.pause();
});
test('backoff is bounded, respects Retry-After and waits for recovery after retry exhaustion or authentication failure',async()=>{
 const c=clock(),id=crypto.randomUUID();let calls=0;
 const queue=onboardingDelivery(async()=>{calls++;throw Object.assign(new Error('busy'),{status:429,retryAfterMs:60000});},{...c,random:()=>.5});queue.enqueue(id,event(c));await queue.flush();
 assert.equal(calls,1);assert.equal([...c.tasks.values()].at(-1).ms,60000);await queue.flush();assert.equal(calls,1);
 for(let i=0;i<5;i++){c.advance(60000);await queue.flush();}assert.equal(calls,6);assert.equal(c.tasks.size,0);queue.enqueue(id,event(c,2));assert.equal(c.tasks.size,0);
 c.advance(60000);await queue.flush();assert.equal(calls,6);assert.equal(c.tasks.size,0);
 queue.resume();c.advance(60000);await queue.flush();assert.equal(calls,7);queue.pause();
 const authClock=clock(),auth=onboardingDelivery(async()=>{throw {status:401};},authClock);auth.enqueue(id,event(authClock));await auth.flush();assert.equal(authClock.tasks.size,0);assert.equal(auth.pending,1);auth.pause();
});
test('queue TTL, capacity, corruption and unavailable storage cannot interrupt onboarding',async()=>{
 const c=clock(),s=storage(),id=crypto.randomUUID(),notices=[];
 s.setItem(`origen.user.one.onboarding-events.${id}`,'malformed secret');
 const old=crypto.randomUUID();s.setItem(`origen.user.one.onboarding-events.${old}`,JSON.stringify({version:1,events:[{...event(c),occurredAt:new Date(c.now()-24*3600000).toISOString()}]}));
 const sent=[],queue=onboardingDelivery(async body=>sent.push(body),{...c,storage:s,scope:'one',onDelivered:notice=>notices.push(notice)});queue.resume();await queue.flush();
 for(let i=1;i<=260;i++)queue.enqueue(id,event(c,i,i===1?'onboarding_opened':'user_speech_started'));
 assert.equal(queue.pending,250);await queue.flush();assert.ok(sent[0].events.some(e=>e.name==='onboarding_opened'));assert.ok(notices.some(n=>n.gaps.capacity>=10));assert.ok(notices.some(n=>n.gaps.invalid>0));assert.ok(notices.some(n=>n.gaps.expired>0));queue.pause();
 const unavailableNotices=[],broken=onboardingDelivery(async body=>sent.push(body),{...c,scope:'one',onDelivered:n=>unavailableNotices.push(n),storage:{getItem:()=>{throw Error();},setItem:()=>{throw Error();},removeItem:()=>{throw Error();}}});assert.doesNotThrow(()=>broken.enqueue(id,event(c)));await broken.flush();assert.equal(broken.pending,0);assert.deepEqual(unavailableNotices[0].gaps,{});broken.pause();
});
test('clear or ownership rejection prevents stale completion and cleanup callbacks from resurrecting local events',async()=>{
 const c=clock(),s=storage(),id=crypto.randomUUID();let resolve;
 const queue=onboardingDelivery(()=>new Promise(r=>resolve=r),{...c,storage:s,scope:'one'});queue.enqueue(id,event(c));const job=queue.flush();await Promise.resolve();queue.clear();resolve();await job;queue.enqueue(id,event(c,2));queue.resume();assert.equal(queue.pending,0);assert.equal(s.length,0);
 for(const failure of [{status:403},{status:404},{code:'tracking_account_changed'}]){const rejected=onboardingDelivery(async()=>{throw failure;},{...c,storage:s,scope:'one'});rejected.enqueue(id,event(c));await rejected.flush();assert.equal(rejected.pending,0);assert.equal(s.length,0);}
});
test('permanent batch rejection releases the rest of the queue and reports a bounded gap',async()=>{
 const c=clock(),id=crypto.randomUUID(),notices=[],sent=[];
 const queue=onboardingDelivery(async body=>{sent.push(body);if(sent.length===1)throw {status:400};},{...c,onDelivered:notice=>notices.push(notice)});
 for(let i=1;i<=26;i++)queue.enqueue(id,event(c,i));await queue.flush();assert.equal(queue.pending,1);
 await queue.flush();assert.equal(sent[1].events[0].sequence,26);assert.equal(queue.pending,0);assert.deepEqual(notices[0].gaps,{request_rejected:25});queue.pause();
});
test('scope capacity includes visits persisted by another tab',()=>{
 const c=clock(),s=storage(),id=crypto.randomUUID();
 for(let i=0;i<10;i++)s.setItem(`origen.user.one.onboarding-events.${crypto.randomUUID()}`,JSON.stringify({version:1,events:[event(c)]}));
 const queue=onboardingDelivery(async()=>{},{...c,storage:s,scope:'one'});queue.enqueue(id,event(c));assert.equal(s.length,10);assert.equal(queue.pending,10);queue.pause();
});
test('acknowledgement keeps concurrently appended events and per-visit storage avoids clobbering other tabs',async()=>{
 const c=clock(),s=storage(),id=crypto.randomUUID(),second=crypto.randomUUID();let release;const sent=[];
 const one=onboardingDelivery(body=>{sent.push(body);return sent.length===1?new Promise(r=>release=r):Promise.resolve();},{...c,storage:s,scope:'one'});
 one.enqueue(id,event(c));const flight=one.flush();await Promise.resolve();one.enqueue(id,event(c,2,'voice_connected'));
 const two=onboardingDelivery(async()=>{},{...c,storage:s,scope:'one'});two.enqueue(second,event(c));release();await flight;
 assert.equal(one.pending,1);assert.ok(s.getItem(`origen.user.one.onboarding-events.${second}`));await one.flush();assert.equal(sent[1].events[0].sequence,2);one.pause();two.pause();
});
test('tracker emits content-free retry recovery evidence and a lost acknowledgement is idempotent on the backend',async()=>{
 const {pool,run}=await fixture();const c=clock(),s=storage();let calls=0;
 try{await run('auth0|one',{action:'load'});const tracker=onboardingEvents(async body=>{await storeOnboardingBatch(pool,'auth0|one',onboardingBatch(body));if(++calls===1)throw Error('ack lost');},{storage:s,scope:'one',schedule:c.schedule,cancel:c.cancel,now:()=>new Date(c.now()).toISOString(),random:()=>.5});
  tracker.open({language:'en'});await tracker.flush();const before=(await pool.query('SELECT last_received_at FROM origen_onboarding_attempts')).rows[0].last_received_at;
  c.advance(2000);await tracker.flush();assert.equal((await pool.query('SELECT * FROM origen_onboarding_events')).rows.length,1);
  assert.equal(+new Date((await pool.query('SELECT last_received_at FROM origen_onboarding_attempts')).rows[0].last_received_at),+new Date(before));
  await tracker.flush();assert.equal((await pool.query("SELECT * FROM origen_onboarding_events WHERE name='tracking_delivery_recovered'")).rows.length,1);tracker.pause();
 }finally{await pool.end();}
});
test('retention settings are bounded, shared by readers and remove only inactive diagnostics',async()=>{
 assert.deepEqual(onboardingSettings({}),{retentionDays:90,alertMinVisits:10,alertRatePercent:25});
 for(const patch of [{ONBOARDING_RETENTION_DAYS:'0'},{ONBOARDING_RETENTION_DAYS:'365'},{ONBOARDING_RETENTION_DAYS:'secret'},{ONBOARDING_ALERT_MIN_VISITS:'2'},{ONBOARDING_ALERT_RATE_PERCENT:'101'}]){assert.throws(()=>onboardingSettings(patch));assert.doesNotMatch(onboardingConfigIssues(patch).join(''),/secret/);}
 const env={ONBOARDING_RETENTION_DAYS:'7'},queries=[];await purgeOnboardingEvents({query:async(...args)=>queries.push(args)},new Date('2026-10-09T20:00:00Z'),env);assert.equal(queries[0][1][0],'2026-10-02T20:00:00.000Z');
 const db={query:async sql=>({rows:sql.includes('schema_migrations')?[]:sql.includes('SELECT id,created_at')?[{id:crypto.randomUUID()}]:[]})};assert.equal((await adminOnboardingMetrics(db,{},new Date(),env)).coverage.retentionDays,7);assert.equal((await adminOnboardingTimeline(db,{id:crypto.randomUUID()},new Date(),env)).coverage.retentionDays,7);
});
test('review flags require observed denominators, sample size, affected floor and configured rates',()=>{
 const settings=onboardingSettings({}),row={voice_starts:1,connection_failed:1,save_requests:1,save_failed:1,phase3:true,playback_blocked:1,handoff_requests:1,transition_failed:1,delivery:true,delivery_gap:1};
 assert.equal(onboardingAlertReport(Array(9).fill(row),settings).reviewCount,0);
 const rows=[...Array(3).fill(row),...Array(7).fill({...row,connection_failed:0,save_failed:0,playback_blocked:0,transition_failed:0,delivery_gap:0,delivery_recovered:1})];
 const result=onboardingAlertReport(rows,settings);assert.equal(result.reviewCount,5);assert.equal(result.recoveredDeliveryVisits,7);assert.equal(result.checks[0].ratePercent,30);
 assert.equal(onboardingAlertReport(rows,onboardingSettings({ONBOARDING_ALERT_RATE_PERCENT:'40'})).reviewCount,0);
 const missing=onboardingAlertReport(Array(100).fill({connection_failed:1,save_failed:1,playback_blocked:1,transition_failed:1,delivery_gap:1}),settings);assert.equal(missing.reviewCount,0);assert.ok(missing.checks.every(c=>c.ratePercent===null&&c.insufficient));
 const two=onboardingAlertReport([...Array(2).fill(row),...Array(8).fill({voice_starts:1})],onboardingSettings({ONBOARDING_ALERT_RATE_PERCENT:'5'}));assert.equal(two.reviewCount,0);
});
test('configured retention cascades only inactive visits and alert SQL counts observed visits once',async()=>{
 const {pool,run}=await fixture();try{
  await pool.query('CREATE TABLE origen_schema_migrations(name text,applied_at timestamptz)');await pool.query('INSERT INTO origen_schema_migrations VALUES($1,now())',['027_onboarding_events.sql']);
  await run('auth0|one',{action:'load'});const c=clock();
  const old=crypto.randomUUID(),active=crypto.randomUUID();
  for(const id of [old,active])await storeOnboardingBatch(pool,'auth0|one',onboardingBatch({attemptId:id,events:[event(c,1,'onboarding_opened',{captureVersion:3,deliveryVersion:1}),event(c,2,'voice_start_requested'),event(c,3,'voice_connection_failed'),event(c,4,'voice_connection_failed'),event(c,5,'tracking_delivery_recovered',{retryCount:1}),event(c,6,'tracking_delivery_gap',{gapReason:'capacity',droppedCount:1})]}));
  await pool.query('UPDATE origen_onboarding_attempts SET last_received_at=$1 WHERE id=$2',[new Date(c.now()-8*86400000).toISOString(),old]);
  await purgeOnboardingEvents(pool,new Date(c.now()),{ONBOARDING_RETENTION_DAYS:'7'});
  assert.equal((await pool.query('SELECT * FROM origen_onboarding_attempts')).rows.length,1);assert.equal((await pool.query('SELECT * FROM origen_onboarding_events')).rows.length,6);
  const report=await adminOnboardingAlerts(pool,{},new Date(c.now()+1000));assert.equal(report.available,true);assert.equal(report.observedVisits,1);assert.equal(report.checks.find(r=>r.key==='connection').affected,1);assert.equal(report.checks.find(r=>r.key==='delivery').affected,1);assert.equal(report.recoveredDeliveryVisits,1);assert.equal(report.reviewCount,0);assert.doesNotMatch(JSON.stringify(report),/auth0|account_id|attempt_id/);
 }finally{await pool.end();}
});
test('alerts are admin-only, unavailable capture is explicit and failures hide private database details',async()=>{
 let queried=false,status,payload;const req=Object.assign(Readable.from([JSON.stringify({action:'onboarding-alerts'})]),{url:'/api/admin',origenAuthorized:true,origenIdentity:{sub:'ordinary'}});await createAdminHandler({query:()=>queried=true},{})(req,{writeHead:s=>status=s,end:p=>payload=JSON.parse(p)},()=>{});assert.equal(status,403);assert.equal(queried,false);
 const absent=await adminOnboardingAlerts({query:async()=>({rows:[]})});assert.equal(absent.available,false);
 const broken=Object.assign(Readable.from([JSON.stringify({action:'onboarding-alerts'})]),{url:'/api/admin',origenAuthorized:true,origenIdentity:{sub:'admin',permissions:['read:activity']}});await createAdminHandler({query:async()=>{throw Error('private SQL');}},{})(broken,{writeHead:s=>status=s,end:p=>payload=JSON.parse(p)},()=>{});assert.equal(status,503);assert.deepEqual(payload,{error:'onboarding_alerts_unavailable'});
});
