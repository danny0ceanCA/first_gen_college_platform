import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {adminUsers,adminUserDetail,userFilters} from './admin-users.mjs';
import {createAdminHandler} from './admin.mjs';
import {fixture} from './family-fixture.mjs';
test('directory validates sort, role, pagination and period before querying',()=>{
 assert.equal(userFilters({}).page,1);
 for(const input of [{sort:'created_at; DROP TABLE users'},{role:'admin'},{status:'lost'},{page:0},{page:1.5},{days:365},{direction:'sideways'},{search:'a'.repeat(101)}])assert.throws(()=>userFilters(input),{status:400});
});
test('search is literal and bound; pagination and reporting windows are stable',async()=>{
 const queries=[],now=new Date('2026-10-07T19:00:00Z');
 const db={query:async(sql,params)=>{queries.push({sql,params});return {rows:sql.includes('AS total')?[{total:'51'}]:sql.includes('WITH tracking')?[{registered:'0'}]:[]};}};
 const result=await adminUsers(db,{search:'50%_\\',page:3,sort:'voice_minutes',direction:'asc',role:'student',status:'complete',days:7},now);
 assert.equal(result.total,51);assert.equal(result.pageSize,25);
 assert.equal(queries[0].params[0],'%50\\%\\_\\\\%');assert.equal(queries[1].params.at(-1),50);
 assert.match(queries[1].sql,/ORDER BY voice_minutes ASC NULLS LAST,a.id ASC LIMIT 25/);
 assert.equal(queries[1].params[3],'2026-09-30T19:00:00.000Z');
 assert.match(queries[2].sql,/v.seconds>0/);assert.match(queries[2].sql,/v.started_at>=cohort.onboarding_completed_at/);
 assert.match(queries[2].sql,/018_onboarding_milestones/);
 for(const q of queries)assert.doesNotMatch(q.sql,/auth0_subject|email|transcript|summary/i);
});
test('detail rejects forged IDs and reports deleted accounts without reading content',async()=>{
 const db={query:async()=>({rows:[]})};
 await assert.rejects(adminUserDetail(db,{id:'invalid'}),{status:400});
 await assert.rejects(adminUserDetail(db,{id:crypto.randomUUID()}),{status:404});
});
test('admin directory and details are inaccessible without server-granted permissions',async()=>{
 for(const action of ['users','user-detail','voice-quality','institution-report']){
  let queried=false,status;
  const handler=createAdminHandler({query:async()=>{queried=true;}},{});
  const req=Readable.from([JSON.stringify({action,id:crypto.randomUUID()})]);req.url='/api/admin';req.origenAuthorized=true;req.origenIdentity={sub:'auth0|ordinary'};
  await handler(req,{writeHead:s=>{status=s;},end:()=>{}},()=>{});
  assert.equal(status,403);assert.equal(queried,false);
 }
});
test('onboarding milestones are server-owned, idempotent, and scoped to the account',async()=>{
 const {pool,run}=await fixture();
 try{
  await run('auth0|one',{action:'onboarding-start',onboarding_started_at:'1999-01-01'});
  const before=(await pool.query("SELECT onboarding_started_at FROM origen_accounts WHERE auth0_subject='auth0|one'")).rows[0].onboarding_started_at;
  assert.notEqual(new Date(before).getFullYear(),1999);
  await run('auth0|one',{action:'onboarding-start'});
  await run('auth0|one',{action:'complete-onboarding',account:{firstName:'Ana',email:'',role:'student'}});
  const saved=(await pool.query("SELECT onboarding_started_at,onboarding_completed_at FROM origen_accounts WHERE auth0_subject='auth0|one'")).rows[0];
  assert.equal(+new Date(saved.onboarding_started_at),+new Date(before));assert.ok(saved.onboarding_completed_at);
  await run('auth0|two',{action:'load'});
  const other=(await pool.query("SELECT onboarding_started_at,onboarding_completed_at FROM origen_accounts WHERE auth0_subject='auth0|two'")).rows[0];
  assert.equal(other.onboarding_started_at,null);assert.equal(other.onboarding_completed_at,null);
 }finally{await pool.end();}
});
