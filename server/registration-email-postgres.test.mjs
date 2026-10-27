import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {coordinatorRegistrationFixture} from './fixtures/coordinator-registration.mjs';
import {grantMaintenanceAccess,assertMaintenanceAccess} from './maintenance-database.mjs';
import {createTestLogin,useTestLogin} from './fixtures/postgres-test-login.mjs';
import {createRegistrationMailer,startRegistrationEmailWorker,assertRegistrationEmailReady} from './registration-email.mjs';
import pg from 'pg';
const api='/api/coordinator-access',institutions='/api/institutions';
const submission={action:'submit-application',displayName:'Synthetic Advisor',organizationName:'Synthetic Organization',organizationWebsite:'https://example.org/',jobRole:'Advisor'};

test('real registration and approval transactions queue verified-only deduplicated emails',{skip:!process.env.DATABASE_TEST_URL},async t=>{
 const f=await coordinatorRegistrationFixture();t.after(()=>f.close());
 const deliver=async input=>(await f.owner.query('SELECT origen_registration_email_delivery($1::jsonb) result',[input])).rows[0].result;
 const claim=()=>deliver({action:'claim'}),accept=item=>deliver({action:'finish',id:item.id,leaseToken:item.leaseToken,accepted:true});
 f.actor('unverified',{verified:false});assert.equal((await f.request('unverified',api,{...submission,verifiedEmail:'forged@example.test'})).status,403);
 const app=(await f.call('applicant',api,{...submission,verifiedEmail:'FORGED@example.test'})).application;
 await f.call('applicant',api,submission);
 assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_registration_emails')).rows[0].n,1);
 await assert.rejects(f.as('applicant',()=>f.db.query('SELECT * FROM origen_registration_emails')),{code:'42501'});
 await assert.rejects(f.as('applicant',()=>f.db.query("SELECT origen_registration_email_delivery('{\"action\":\"claim\"}')")),{code:'42501'});
 let item=await claim();assert.equal(item.kind,'coordinator-received');assert.equal(item.recipient,'applicant@example.test');
 assert.equal((await deliver({action:'finish',id:item.id,leaseToken:randomUUID(),accepted:true})).updated,false);
 await deliver({action:'finish',id:item.id,leaseToken:item.leaseToken,accepted:false});
 await f.owner.query("UPDATE origen_registration_emails SET available_at=now() WHERE id=$1",[item.id]);
 const retry=await claim();assert.equal(retry.id,item.id);assert.notEqual(retry.leaseToken,item.leaseToken);await accept(retry);
 assert.equal((await f.owner.query('SELECT recipient FROM origen_registration_emails WHERE id=$1',[item.id])).rows[0].recipient,'');
 const registration={action:'register',registrationKey:randomUUID(),representative:{firstName:'Owner',workEmail:'editable-contact@example.test',jobRole:'Director'},page:{name:submission.organizationName,website:submission.organizationWebsite,description:'College guidance.',programs:'',admissions:'',financialAid:'',events:'',publicEmail:'public-contact@example.test',links:[]}};
 assert.equal((await f.request('unverified',institutions,{...registration,email_verified:true,verifiedEmail:'forged@example.test'})).status,403);
 const organization=(await f.call('owner',institutions,registration)).institutions[0];
 await f.call('owner',institutions,registration);
 item=await claim();assert.equal(item.kind,'organization-received');assert.equal(item.recipient,'owner@example.test');await accept(item);
 assert.equal((await f.owner.query("SELECT count(*)::int n FROM origen_registration_emails WHERE kind='organization-received'")).rows[0].n,1);
 await f.call('owner',institutions,{action:'submit',id:organization.id,revision:organization.revision});
 await f.call('reviewer',institutions,{action:'verify',id:organization.id,revision:organization.revision,note:'Affiliation checked.'});
 await f.call('reviewer',api,{action:'approve-organization',id:organization.id});
 item=await claim();assert.equal(item.kind,'organization-approved');assert.equal(item.recipient,'owner@example.test');await accept(item);
 await f.call('reviewer',api,{action:'approve-organization',id:organization.id});assert.deepEqual(await claim(),{});
 await f.owner.query("INSERT INTO origen_institution_members(institution_id,auth0_subject,role) VALUES($1,'applicant','outreach')",[organization.id]);
 await f.call('reviewer',api,{action:'approve-application',id:app.id,institutionId:organization.id,reviewNote:'Welcome.'});
 item=await claim();assert.equal(item.kind,'coordinator-approved');assert.equal(item.recipient,'applicant@example.test');await accept(item);
 assert.deepEqual(await claim(),{});
 const four=(await f.owner.query("SELECT kind FROM origen_registration_emails WHERE status='accepted' ORDER BY kind")).rows.map(x=>x.kind);
 assert.deepEqual(four,['coordinator-approved','coordinator-received','organization-approved','organization-received']);

 await t.test('rollback cannot queue mail and withdrawn applications cancel pending mail',async()=>{
  const c=await f.owner.connect();try{await c.query('BEGIN');await c.query("INSERT INTO origen_institution_representatives(auth0_subject,first_name,work_email,job_role) VALUES('rollback','Test','test@example.test','Advisor')");await c.query("INSERT INTO origen_coordinator_applications(auth0_subject,display_name,verified_email,organization_name,organization_website,job_role) VALUES('rollback','Test','test@example.test','Test','','Advisor')");await c.query('ROLLBACK');}finally{c.release();}
  assert.deepEqual(await claim(),{});
  f.actor('withdrawn');const a=(await f.call('withdrawn',api,submission)).application;await f.call('withdrawn',api,{action:'withdraw-application',id:a.id});assert.deepEqual(await claim(),{});
 });
 await t.test('stale leases, removed owners, and retries older than the idempotency window cannot send',async()=>{
  f.actor('stale');await f.call('stale',api,submission);const first=await claim();assert.deepEqual(await claim(),{});
  await f.owner.query("UPDATE origen_registration_emails SET lease_until=now()-interval '1 second' WHERE id=$1",[first.id]);const second=await claim();
  assert.equal(second.id,first.id);assert.equal((await accept(first)).updated,false);await accept(second);
  f.actor('expired');await f.call('expired',api,submission);await f.owner.query("UPDATE origen_registration_emails SET created_at=now()-interval '24 hours' WHERE recipient_subject='expired'");assert.deepEqual(await claim(),{});
  f.actor('removed');await f.call('removed',institutions,{...registration,registrationKey:randomUUID()});
  await f.owner.query("DELETE FROM origen_institution_members WHERE auth0_subject='removed'");assert.deepEqual(await claim(),{});
 });
 await t.test('approval notices are suppressed if coordinator access is removed before delivery',async()=>{
  f.actor('revoked');const a=(await f.call('revoked',api,submission)).application;
  await f.owner.query("INSERT INTO origen_institution_members VALUES($1,'revoked','outreach')",[organization.id]);
  await f.call('reviewer',api,{action:'approve-application',id:a.id,institutionId:organization.id,reviewNote:'Checked.'});
  await f.owner.query("UPDATE origen_coordinator_profiles SET status='disabled' WHERE auth0_subject='revoked'");
  assert.deepEqual(await claim(),{});
  assert.equal((await f.owner.query("SELECT status FROM origen_registration_emails WHERE recipient_subject='revoked' AND kind='coordinator-approved'")).rows[0].status,'cancelled');
 });
 await t.test('restricted maintenance worker delivers a captured email without HTTP queue access',async()=>{
  const role=`mail_${randomUUID().replaceAll('-','')}`;await createTestLogin(f.owner,role);await grantMaintenanceAccess(f.owner,role,{schema:f.schema});
  const url=new URL(process.env.DATABASE_TEST_URL);useTestLogin(url,role);
  const maintenance=new pg.Pool({connectionString:url.href,max:1,options:`-c search_path=${f.schema}`});
  let stop=async()=>{};
  try{
   await assertMaintenanceAccess(maintenance,{schema:f.schema});
   const env={GUARDIAN_EMAIL_TRANSPORT:'resend',GUARDIAN_PUBLIC_URL:'https://origen.example/',RESEND_API_KEY:'synthetic-not-a-key'};
   await assertRegistrationEmailReady(maintenance,env);
   await assert.rejects(maintenance.query('SELECT * FROM origen_registration_emails'),{code:'42501'});
   f.actor('worker');await f.call('worker',api,submission);let captured,ready;
   const sent=new Promise(resolve=>{ready=resolve;});
   const mailer=createRegistrationMailer(env,async(_url,options)=>{captured=JSON.parse(options.body);ready();return {ok:true};});
   stop=startRegistrationEmailWorker({database:maintenance,mailer,intervalMs:100000});
   await sent;await stop();assert.deepEqual(captured.to,['worker@example.test']);assert.match(captured.html,/lang="es"/);
   assert.equal((await f.owner.query("SELECT status FROM origen_registration_emails WHERE recipient_subject='worker'")).rows[0].status,'accepted');
  }finally{await stop();await maintenance.end();await f.owner.query(`DROP OWNED BY ${role}`);await f.owner.query(`DROP ROLE ${role}`);}
 });
});
