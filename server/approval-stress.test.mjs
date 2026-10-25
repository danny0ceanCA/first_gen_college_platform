import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import {coordinatorRegistrationFixture} from './fixtures/coordinator-registration.mjs';
const api='/api/coordinator-access',inst='/api/institutions';
const options={skip:!process.env.DATABASE_TEST_URL,timeout:45000};

test('delayed approval bursts cannot reverse a newer organization suspension',options,async t=>{
 const f=await coordinatorRegistrationFixture();t.after(()=>f.close());
 const id=randomUUID();
 await f.owner.query("INSERT INTO origen_institutions(id,slug,draft,verification_status) VALUES($1::uuid,$1::uuid::text,$2,'verified')",[id,{name:'Synthetic Organization'}]);
 const old={action:'approve-organization',id,revision:0};
 await f.call('reviewer',api,old);
 await f.call('reviewer',api,{action:'suspend-organization',id});
 const delayed=await Promise.all(Array.from({length:12},()=>f.request('reviewer',api,old)));
 assert.ok(delayed.every(r=>r.status===409||r.status===429),'Stale enables must conflict or wait instead of undoing suspension');
 for(const result of delayed.filter(r=>r.status===429))assert.equal((await f.request('reviewer',api,old)).status,409);
 const org=(await f.call('reviewer',api,{action:'organization-queue'})).organizations[0];
 assert.equal(org.pilotStatus,'suspended');
 const fresh={...old,revision:org.pilotRevision};
 const race=await Promise.all(Array.from({length:12},()=>f.request('reviewer',api,fresh)));
 assert.equal(race.filter(r=>r.status===200).length,2);
 assert.equal(race.filter(r=>r.body.replayed===true).length,1);
 assert.equal(race.filter(r=>r.status===429).length,10);
 for(const result of race.filter(r=>r.status===429))assert.equal((await f.call('reviewer',api,fresh)).replayed,true);
 assert.equal((await f.call('reviewer',api,{action:'organization-queue'})).organizations[0].pilotRevision,org.pilotRevision+1,'Retries must acknowledge one activation without incrementing the revision');
});

test('24 blocked organization review reads leave capacity for unrelated account work',options,async()=>{
 const f=await coordinatorRegistrationFixture({runtimePoolSize:3});let gate,burst=[],status;
 try{
  gate=await f.owner.connect();await gate.query('BEGIN');await gate.query('LOCK TABLE origen_institutions IN ACCESS EXCLUSIVE MODE');
  burst=Array.from({length:24},()=>f.request('reviewer',inst,{action:'queue'}));
  const deadline=Date.now()+5000;
  while(Date.now()<deadline){const row=(await f.owner.query("SELECT 1 FROM pg_stat_activity WHERE usename=$1 AND wait_event_type='Lock' LIMIT 1",[f.role])).rows[0];if(row)break;await pause(20);}
  status=f.as('reader',()=>f.db.query('SELECT id FROM origen_accounts WHERE auth0_subject=$1',['reader']));
  const responsive=await Promise.race([status.then(r=>r.rows.length===1),pause(1500).then(()=>false)]);
  await gate.query('ROLLBACK');gate.release();gate=null;
  const results=await Promise.all(burst);await status;
  assert.equal(responsive,true,'Review reads exhausted all runtime connections');
  assert.equal(results.filter(r=>r.status===429).length,22);
  assert.equal(results.filter(r=>r.status===200).length,2);
  assert.equal((await f.request('reviewer',inst,{action:'queue'})).status,200,'Admission slots must recover');
 }finally{if(gate){await gate.query('ROLLBACK');gate.release();}await Promise.allSettled([...burst,...(status?[status]:[])]);await f.close();}
});

test('pending registration search and pagination reach all 205 submissions',options,async t=>{
 const f=await coordinatorRegistrationFixture();t.after(()=>f.close());
 await f.owner.query("INSERT INTO origen_institutions(slug,draft,status,updated_at) SELECT 'pending-'||n,jsonb_build_object('name','Pending Organization '||n),'submitted',now()+n*interval '1 second' FROM generate_series(1,205) n");
 const searched=await f.call('reviewer',inst,{action:'queue',search:'Pending Organization 205'});
 assert.equal(searched.submissions.length,1,'Search must reach submissions outside the first page');
 assert.equal(searched.submissions[0].page.name,'Pending Organization 205');
 let after='',ids=[];
 do{const page=await f.call('reviewer',inst,{action:'queue',after});assert.ok(page.submissions.length<=50);ids.push(...page.submissions.map(i=>i.id));after=page.next||'';}while(after);
 assert.equal(ids.length,205);assert.equal(new Set(ids).size,205);
 assert.equal((await f.request('applicant',inst,{action:'queue'})).status,403);
 for(const input of [{after:'bad'},{search:'x'.repeat(201)},{filter:'bad'}])assert.equal((await f.request('reviewer',inst,{action:'queue',...input})).status,400);
});
