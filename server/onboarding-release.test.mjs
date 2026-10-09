import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {fixture} from './family-fixture.mjs';
import {createApp} from './index.mjs';

test('onboarding release journey preserves authoritative saves, replay, return visits, admin isolation and closure through HTTP',async()=>{
 const {pool}=await fixture(),logs=[];
 await pool.query('CREATE TABLE origen_schema_migrations(name text,applied_at timestamptz)');
 await pool.query('INSERT INTO origen_schema_migrations VALUES($1,now())',['027_onboarding_events.sql']);
 const identities={one:{sub:'auth0|release-one'},two:{sub:'auth0|release-two'},admin:{sub:'auth0|release-admin',permissions:['read:activity']}};
 const server=createServer(createApp({ALLOWED_ORIGINS:'https://synthetic.example',ONBOARDING_RETENTION_DAYS:'7'},async token=>{
  if(!identities[token])throw Error('invalid synthetic token');
  return {...identities[token],'https://origenedu.ai/auth_time':Math.floor(Date.now()/1000)};
 },pool,record=>logs.push(record)));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`,attemptId=crypto.randomUUID();
 const post=async(path,body,token='one')=>{const response=await fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://synthetic.example',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});return {status:response.status,data:await response.json(),requestId:response.headers.get('X-Request-ID')};};
 const events=(id,names)=>({attemptId:id,events:names.map((name,i)=>({sequence:i+1,name,occurredAt:new Date().toISOString(),metadata:name==='onboarding_opened'?{language:'es',method:'voice',captureVersion:3,deliveryVersion:1,transcript:'PRIVATE SPOKEN CONTENT',email:'private@synthetic.example'}:{}}))});
 try{
  assert.equal((await post('/api/onboarding-events',events(attemptId,['onboarding_opened']),null)).status,401);
  assert.equal((await post('/api/family',{action:'load'})).status,200);
  const opening=events(attemptId,['onboarding_opened','voice_start_requested','voice_connected','save_requested']);
  const receipt=await post('/api/onboarding-events',opening);assert.equal(receipt.status,200);assert.ok(receipt.requestId);
  const invalid=await post('/api/family',{action:'complete-onboarding',onboardingAttemptId:attemptId,account:{firstName:' ',role:'student',email:''}});assert.equal(invalid.status,400);
  const saved=await post('/api/family',{action:'complete-onboarding',onboardingAttemptId:attemptId,account:{firstName:'PRIVATE ACCOUNT NAME',role:'student',email:''},student:{id:'synthetic-student',name:'PRIVATE STUDENT NAME',stage:'Community college',school:'PRIVATE SCHOOL',color:'lilac'}});assert.equal(saved.status,200);
  assert.equal((await post('/api/onboarding-events',opening)).status,200);
  assert.equal((await post('/api/onboarding-events',{attemptId,events:[{sequence:5,name:'home_reached',occurredAt:new Date().toISOString(),metadata:{}}]})).status,200);
  const returned=await post('/api/family',{action:'load'});assert.equal(returned.data.account.role,'student');assert.equal(returned.data.account.firstName,'PRIVATE ACCOUNT NAME');assert.equal(returned.data.students.length,1);
  const rows=(await pool.query('SELECT id FROM origen_accounts WHERE auth0_subject=$1',['auth0|release-one'])).rows,accountId=rows[0].id;
  const timeline=await post('/api/admin',{action:'onboarding-timeline',id:accountId},'admin');assert.equal(timeline.status,200);assert.equal(timeline.data.coverage.retentionDays,7);assert.equal(timeline.data.total,1);assert.ok(timeline.data.attempts[0].saved_at);assert.equal(timeline.data.attempts[0].homeReached,true);assert.equal(timeline.data.attempts[0].eventCount,6);
  const history=await post('/api/admin',{action:'onboarding-attempt',id:accountId,attemptId},'admin');assert.equal(history.status,200);assert.equal(history.data.events.filter(e=>e.name==='profile_saved'&&e.producer==='server').length,1);assert.doesNotMatch(JSON.stringify(history.data),/PRIVATE|private@/);
  assert.equal((await post('/api/admin',{action:'onboarding-attempt',id:accountId,attemptId},'two')).status,403);
  const other=await post('/api/family',{action:'load'},'two');assert.equal(other.data.students.length,0);
  assert.equal((await post('/api/onboarding-events',events(attemptId,['onboarding_opened']),'two')).status,200);
  const secondId=(await pool.query('SELECT id FROM origen_accounts WHERE auth0_subject=$1',['auth0|release-two'])).rows[0].id;
  const secondHistory=await post('/api/admin',{action:'onboarding-attempt',id:secondId,attemptId},'admin');assert.equal(secondHistory.data.events.length,1);assert.equal(secondHistory.data.events[0].name,'onboarding_opened');
  const metrics=await post('/api/admin',{action:'onboarding-metrics'},'admin');assert.equal(metrics.status,200);assert.equal(metrics.data.totals.users,2);assert.equal(metrics.data.totals.savedUsers,1);
  const alerts=await post('/api/admin',{action:'onboarding-alerts'},'admin');assert.equal(alerts.status,200);assert.equal(alerts.data.reviewCount,0);assert.equal(alerts.data.observedVisits,2);
  const exported=await post('/api/account-data',{action:'export'});assert.equal(exported.status,200);assert.equal(exported.data.onboarding.attempts.length,1);
  assert.equal((await post('/api/account-data',{action:'delete',confirmation:'DELETE'})).status,200);
  assert.equal((await post('/api/onboarding-events',opening)).data.error,'account_closed');assert.equal((await post('/api/family',{action:'load'})).status,403);
  assert.equal((await post('/api/admin',{action:'onboarding-timeline',id:accountId},'admin')).status,404);
  assert.equal((await pool.query('SELECT * FROM origen_onboarding_events')).rows.length,1);assert.equal((await post('/api/family',{action:'load'},'two')).status,200);
  assert.doesNotMatch(JSON.stringify(logs),/PRIVATE|private@|Bearer|auth0\|release/);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await pool.end();}
});
