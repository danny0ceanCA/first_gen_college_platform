import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash,randomUUID} from 'node:crypto';
import {retrievalFixture} from './history-retrieval-fixture.mjs';
import {runAsAccount,runAsCoordinatorActor} from './account-isolation.mjs';
import {createCoordinatorCode,coordinatorCodeAlphabet,validateCoordinatorInput,runCoordinatorCommand,createCoordinatorHandler,assertCoordinatorProvisioningReady} from './coordinator-access.mjs';
import {createApp} from './index.mjs';
import {MFA_TIME_CLAIM,staffHash} from './staff-access.mjs';
import {AUTH_TIME_CLAIM} from './recent-auth.mjs';

test('connection codes have 50 bits of unbiased entropy and canonical hashes',()=>{
 assert.equal(new Set(coordinatorCodeAlphabet).size,32);
 const seen=new Set();for(let i=0;i<1000;i++){
  const {code,hash}=createCoordinatorCode();assert.match(code,/^[23456789A-HJ-NP-Z]{5}-[23456789A-HJ-NP-Z]{5}$/);
  assert.equal(hash,createHash('sha256').update(code.replace('-','')).digest('hex'));assert.ok(!seen.has(code));seen.add(code);
 }
});
test('request validator discards client assertions, code hashes and private binder selectors',()=>{
 const id=randomUUID();assert.deepEqual(validateCoordinatorInput({action:'rotate-code',id,codeHash:'forged',administrator:true,email_verified:true,studentId:'family'}),{action:'rotate-code',id});
 for(const input of [null,{}, {action:'lookup-code'},{action:'rotate-code',id:'bad'},{action:'enable-member',id,subject:''},{action:'save-profile',id,displayName:'\0'}])assert.throws(()=>validateCoordinatorInput(input));
 assert.throws(()=>runAsCoordinatorActor('forged',{},()=>{}),/account_scope_mismatch/);
});

test('coordinator provisioning enforces permissions, code lifecycle and family isolation in PostgreSQL',{skip:!process.env.DATABASE_TEST_URL},async t=>{
 const f=await retrievalFixture();t.after(()=>f.close());
 await assertCoordinatorProvisioningReady(f.runtime,{ORIGEN_COORDINATOR_ACCOUNTS:'true'});
 const org=randomUUID(),outside=randomUUID();
 for(const subject of ['owner','staff','viewer','outsider','reviewer'])await f.owner.query('INSERT INTO origen_institution_representatives(auth0_subject,first_name,work_email,job_role) VALUES($1,$1,$2,$3)',[subject,`${subject}@example.test`,'Synthetic']);
 for(const [id,name] of [[org,'Community Pilot'],[outside,'Other organization']])await f.owner.query("INSERT INTO origen_institutions(id,slug,draft,verification_status) VALUES($1,$2,$3,'verified')",[id,id,{name}]);
 for(const [id,sub,role] of [[org,'owner','owner'],[org,'staff','outreach'],[org,'viewer','analyst'],[outside,'outsider','owner']])await f.owner.query('INSERT INTO origen_institution_members VALUES($1,$2,$3)',[id,sub,role]);
 const run=(sub,input,admin=false)=>runAsAccount({sub},()=>runAsCoordinatorActor(sub,{administrator:admin},()=>runCoordinatorCommand(f.db,validateCoordinatorInput(input))));
 const command=(sub,action,extra={},admin=false)=>run(sub,{action,id:org,...extra},admin);
 await f.save('family-secret','PRIVATE_FAMILY_CONVERSATION_SENTINEL',{studentId:null});

 await t.test('approval is independent of page publication, ownership and client-supplied claims',async()=>{
  await assert.rejects(f.as('owner',()=>runCoordinatorCommand(f.db,{action:'overview'})),{code:'42501'});
  await assert.rejects(command('owner','approve-organization'),{code:'42501'});
  await assert.rejects(command('owner','approve-organization',{},true),/independent_review_required/);
  await assert.rejects(command('owner','enable-member',{subject:'staff'}),{code:'42501'});
  await command('reviewer','approve-organization',{},true);
  assert.equal((await f.owner.query('SELECT published FROM origen_institutions WHERE id=$1',[org])).rows[0].published,null);
  await command('owner','enable-member',{subject:'staff'});
  await assert.rejects(command('owner','profile'),{code:'42501'});
  await assert.rejects(command('viewer','profile'),{code:'42501'});
  await assert.rejects(command('outsider','team'),{code:'42501'});
  await assert.rejects(command('staff','enable-member',{subject:'viewer'}),{code:'42501'});
  const p=await command('staff','profile');assert.equal(p.profile.displayName,'staff');assert.equal(p.profile.organizationName,'Community Pilot');
  const view=await command('staff','overview');assert.equal(view.organizations.length,1);assert.equal(view.sharingEnabled,false);
  assert.ok(!JSON.stringify([p,view]).includes('PRIVATE_FAMILY'));
  assert.deepEqual((await f.as('staff',()=>f.db.query('SELECT * FROM origen_conversation_summaries'))).rows,[]);
 });

 let grant,coordinator;
 await t.test('codes rotate, revoke and expire without changing established grants',async()=>{
  coordinator=(await f.owner.query('SELECT id FROM origen_coordinator_profiles WHERE institution_id=$1',[org])).rows[0].id;
  const account=(await f.owner.query("SELECT id FROM origen_accounts WHERE auth0_subject='other'")).rows[0].id;
  const connection=(await f.owner.query("INSERT INTO origen_binder_connections(account_id,student_id,coordinator_id,request_id,status,accepted_at,expires_at) VALUES($1,'alex',$2,$3,'accepted',now(),now()+interval '60 days') RETURNING id",[account,coordinator,randomUUID()])).rows[0].id;
  grant=(await f.owner.query("INSERT INTO origen_binder_share_grants(account_id,student_id,coordinator_id,connection_id,grantor_subject,topics,permission_revision,coordinator_revision,connection_revision,notice_version,expires_at) VALUES($1,'alex',$2,$3,'other',ARRAY['options'],1,1,1,'synthetic',now()+interval '60 days') RETURNING id",[account,coordinator,connection])).rows[0].id;
  const first=await command('staff','rotate-code');assert.match(first.code,/^.{5}-.{5}$/);
  assert.ok(Math.abs(Date.parse(first.expiresAt)-Date.now()-30*86400000)<5000);
  const saved=(await f.owner.query('SELECT * FROM origen_coordinator_codes WHERE coordinator_id=$1',[coordinator])).rows[0];assert.equal(saved.code_hash,createHash('sha256').update(first.code.replace('-','')).digest('hex'));assert.ok(!JSON.stringify(saved).includes(first.code));
  assert.ok(!JSON.stringify(await command('staff','profile')).includes(saved.code_hash));
  const second=await command('staff','rotate-code');assert.notEqual(second.code,first.code);
  assert.equal((await f.owner.query('SELECT count(*)::int AS n FROM origen_coordinator_codes WHERE coordinator_id=$1 AND revoked_at IS NULL',[coordinator])).rows[0].n,1);
  assert.equal((await f.owner.query('SELECT status FROM origen_binder_share_grants WHERE id=$1',[grant])).rows[0].status,'active');
  await command('staff','revoke-code');assert.equal((await command('staff','profile')).profile.code,null);
  await command('staff','rotate-code');await f.owner.query("UPDATE origen_coordinator_codes SET created_at=now()-interval '31 days',expires_at=now()-interval '1 day' WHERE coordinator_id=$1 AND revoked_at IS NULL",[coordinator]);
  assert.equal((await command('staff','profile')).profile.code,null);
  const concurrent=await Promise.all([command('staff','rotate-code'),command('staff','rotate-code')]);assert.notEqual(concurrent[0].code,concurrent[1].code);
  assert.equal((await f.owner.query('SELECT count(*)::int AS n FROM origen_coordinator_codes WHERE coordinator_id=$1 AND revoked_at IS NULL',[coordinator])).rows[0].n,1);
 });
 await t.test('staff disable and re-enable never revive codes, connections or grants',async()=>{
  await command('owner','disable-member',{subject:'staff'});
  await assert.rejects(command('staff','profile'),{code:'42501'});
  await command('owner','enable-member',{subject:'staff'});
  assert.equal((await command('staff','profile')).profile.code,null);
  assert.equal((await f.owner.query('SELECT status,revoked_at FROM origen_binder_share_grants WHERE id=$1',[grant])).rows[0].status,'revoked');
  assert.equal((await f.owner.query('SELECT status FROM origen_binder_connections WHERE coordinator_id=$1',[coordinator])).rows[0].status,'revoked');
 });
 await t.test('organization suspension, archival and staff security controls invalidate access',async()=>{
  await command('staff','rotate-code');await command('reviewer','suspend-organization',{},true);
  await assert.rejects(command('staff','profile'),{code:'42501'});
  await command('reviewer','approve-organization',{},true);await assert.rejects(command('staff','profile'),{code:'42501'});
  await command('owner','enable-member',{subject:'staff'});assert.equal((await command('staff','profile')).profile.code,null);
  await f.owner.query('INSERT INTO origen_staff_access_controls(subject_hash,blocked,token_valid_after) VALUES($1,true,now())',[staffHash('staff')]);
  await assert.rejects(command('staff','profile'),{code:'42501'});await assert.rejects(command('owner','enable-member',{subject:'staff'}),{code:'42501'});
  await f.owner.query('UPDATE origen_staff_access_controls SET blocked=false WHERE subject_hash=$1',[staffHash('staff')]);
  await assert.rejects(command('staff','profile'),{code:'42501'});await command('owner','enable-member',{subject:'staff'});
  await f.owner.query('DELETE FROM origen_staff_access_controls WHERE subject_hash=$1',[staffHash('staff')]);
  await f.owner.query('UPDATE origen_institutions SET archived_at=now() WHERE id=$1',[org]);await assert.rejects(command('staff','profile'),{code:'42501'});
  await f.owner.query('UPDATE origen_institutions SET archived_at=NULL WHERE id=$1',[org]);await command('reviewer','approve-organization',{},true);
  await command('owner','enable-member',{subject:'staff'});
 });
 await t.test('HTTP requires verified email and fresh server MFA; client flags cannot substitute',async()=>{
  const now=Math.floor(Date.now()/1000);let identity={sub:'staff',iat:now,[MFA_TIME_CLAIM]:now,[AUTH_TIME_CLAIM]:now},emailVerified=true,matched=true;
  const handler=createCoordinatorHandler(f.db,{ORIGEN_COORDINATOR_ACCOUNTS:'true',AUTH0_DOMAIN:'synthetic.auth0.com'},async()=>({ok:true,json:async()=>({sub:matched?identity.sub:'imposter',email:'staff@example.test',email_verified:emailVerified})}));
  const server=createServer((req,res)=>{req.origenIdentity=identity;req.origenAuthorized=true;void runAsAccount(identity,()=>handler(req,res,()=>{res.writeHead(404);res.end();}));});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{
   const send=body=>fetch(`http://127.0.0.1:${server.address().port}/api/coordinator-access`,{method:'POST',headers:{Authorization:'Bearer synthetic','Content-Type':'application/json'},body:JSON.stringify({action:'profile',id:org,email_verified:true,mfa:true,...body})});
   assert.equal((await send()).status,200);
   delete identity[MFA_TIME_CLAIM];assert.equal((await(await send()).json()).error,'staff_mfa_required');identity[MFA_TIME_CLAIM]=now;
   identity[MFA_TIME_CLAIM]=now+100;assert.equal((await send()).status,403);identity[MFA_TIME_CLAIM]=now;
   identity[AUTH_TIME_CLAIM]=now-301;assert.equal((await(await send({action:'rotate-code'})).json()).error,'reauthentication_required');identity[AUTH_TIME_CLAIM]=now;
   emailVerified=false;assert.equal((await(await send()).json()).error,'verified_email_required');emailVerified=true;
   matched=false;assert.equal((await send()).status,403);matched=true;
   identity={...identity,sub:'viewer'};assert.equal((await send()).status,403);
   identity={...identity,sub:'staff'};const res=await send({action:'rotate-code',codeHash:'forged'});assert.equal(res.status,200);assert.equal(res.headers.get('cache-control'),'no-store');
  }finally{await new Promise(r=>server.close(r));}
 });
 await t.test('removal and reinvitation create a new disabled capability boundary',async()=>{
  await f.owner.query('DELETE FROM origen_institution_members WHERE institution_id=$1 AND auth0_subject=$2',[org,'staff']);
  await assert.rejects(command('staff','profile'),{code:'42501'});
  assert.equal((await f.owner.query('SELECT * FROM origen_coordinator_codes WHERE coordinator_id=$1',[coordinator])).rows.length,0);
  assert.equal((await f.owner.query('SELECT * FROM origen_binder_share_grants WHERE id=$1',[grant])).rows.length,0);
  await f.owner.query("INSERT INTO origen_institution_members VALUES($1,'staff','outreach')",[org]);await assert.rejects(command('staff','profile'),{code:'42501'});
  await command('owner','enable-member',{subject:'staff'});assert.notEqual((await command('staff','profile')).profile.id,coordinator);
 });
 await t.test('API dispatcher keeps coordinator content disabled during provisioning',async()=>{
  const logs=[],app=createApp({ORIGEN_COORDINATOR_ACCOUNTS:'true'},async()=>({sub:'staff'}),f.db,line=>logs.push(line));
  const server=createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{
   const request=path=>fetch(`http://127.0.0.1:${server.address().port}/api/${path}`,{method:'POST',headers:{Authorization:'Bearer synthetic','Content-Type':'application/json'},body:JSON.stringify({action:'overview',code:'SECRET_CODE_SENTINEL'})});
   const r=await request('coordinator-access');assert.equal(r.status,403);assert.equal((await r.json()).error,'staff_mfa_required');
   for(const path of ['coordinator-connections','coordinator-binders','coordinator-feedback','coordinator-notifications'])assert.equal((await request(path)).status,['coordinator-feedback','coordinator-notifications'].includes(path)?400:503);
   await app.flushLogs();assert.ok(!JSON.stringify(logs).includes('SECRET_CODE_SENTINEL'));
  }finally{await new Promise(r=>server.close(r));await app.flushLogs();}
 });
});
