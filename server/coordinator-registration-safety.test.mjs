import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {coordinatorRegistrationFixture} from './fixtures/coordinator-registration.mjs';
import {signupOrganization} from '../src/coordinatorOrganizationSignup.mjs';
import {validateCoordinatorInput,assertCoordinatorProvisioningReady} from './coordinator-access.mjs';
import {mkdtemp,readdir,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {migrateDatabase} from './database.mjs';
import {grantRuntimeAccess} from './runtime-grants.mjs';
const api='/api/coordinator-access',institutions='/api/institutions';
const submission={action:'submit-application',displayName:'Synthetic Advisor',organizationName:'Community Futures',organizationWebsite:'https://example.org/',jobRole:'Advisor'};

test('withdrawal and reviewer lookup require identifiers and bound search input',()=>{
 for(const input of [{action:'withdraw-application'},{action:'application-organizations'},{action:'application-organizations',id:randomUUID(),search:'x'.repeat(201)}])assert.throws(()=>validateCoordinatorInput(input));
 assert.deepEqual(validateCoordinatorInput({action:'application-organizations',id:'00000000-0000-4000-8000-000000000001',search:' Futures ',subject:'forged'}),{action:'application-organizations',id:'00000000-0000-4000-8000-000000000001',search:'Futures'});
});

test('registration HTTP lifecycle preserves independent approval across retries, withdrawal and invitations',{skip:!process.env.DATABASE_TEST_URL},async t=>{
 const f=await coordinatorRegistrationFixture();t.after(()=>f.close());
 const cmd=(sub,input)=>f.call(sub,api,input),inst=(sub,input)=>f.call(sub,institutions,input);
 await assertCoordinatorProvisioningReady(f.db,f.env);
 f.actor('applicant',{mfa:false});
 const application=(await cmd('applicant',submission)).application;
 assert.equal(application.status,'pending');
 const registration=signupOrganization(application,'College guidance.',application.id,true);
 assert.equal((await f.request('applicant',institutions,registration)).status,403);
 f.actor('applicant');
 const registered=await inst('applicant',registration),id=registered.registeredInstitutionId;
 await inst('applicant',{action:'submit',id,revision:1});
 await inst('reviewer',{action:'verify',id,revision:1,note:'Affiliation verified independently.'});
 await cmd('reviewer',{action:'approve-organization',id});
 const enable=()=>f.request('applicant',api,{action:'enable-member',id,subject:'applicant'});
 assert.deepEqual(await enable(),{status:403,body:{error:'application_review_required'}});
 await cmd('reviewer',{action:'decline-application',id:application.id,reviewNote:'Need additional affiliation evidence.'});
 assert.equal((await enable()).status,403);
 await cmd('applicant',{action:'withdraw-application',id:application.id});
 assert.equal((await enable()).status,403,'Withdrawal must not reset review requirements');
 await assert.rejects(f.as('applicant',()=>f.db.query('DELETE FROM origen_coordinator_application_controls')),{code:'42501'});
 const replacement=(await cmd('applicant',submission)).application;
 assert.notEqual(replacement.id,application.id);
 assert.equal((await f.request('applicant',api,{action:'withdraw-application',id:application.id})).status,409);
 assert.equal((await f.request('applicant',api,{action:'withdraw-application'})).status,400);
 assert.equal((await cmd('applicant',{action:'application-status'})).application.id,replacement.id);
 assert.equal((await f.request('applicant',api,{action:'application-organizations',id:replacement.id})).status,403);
 assert.equal((await cmd('reviewer',{action:'application-organizations',id:replacement.id})).organizations[0].id,id);
 await cmd('reviewer',{action:'approve-application',id:replacement.id,institutionId:id,reviewNote:'Affiliation confirmed.'});
 assert.equal((await cmd('applicant',{action:'profile',id})).profile.status,'active');
 const code=(await cmd('applicant',{action:'rotate-code',id})).code;assert.match(code,/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
 await cmd('applicant',submission);
 assert.equal((await cmd('applicant',{action:'profile',id})).profile.status,'active','Approved retry must preserve access');
 await cmd('applicant',{action:'disable-member',id,subject:'applicant'});
 assert.equal((await enable()).status,200,'Approved coordinator may be re-enabled');
 assert.equal((await cmd('applicant',{action:'profile',id})).profile.code,null,'Old code must remain revoked');

 // Existing-organization path: membership invitation does not replace review.
 const invited=(await cmd('invited',submission)).application;
 const invitation=await inst('applicant',{action:'invite',id,email:'invited@example.test',role:'outreach'});
 await inst('invited',{action:'accept-invite',token:invitation.token});
 assert.equal((await f.request('applicant',api,{action:'enable-member',id,subject:'invited'})).status,403);
 await cmd('reviewer',{action:'approve-application',id:invited.id,institutionId:id,reviewNote:'Invitation and affiliation checked.'});
 assert.equal((await cmd('invited',{action:'profile',id})).profile.status,'active');

 // Legacy provisioning remains supported. Applying later removes old access.
 const legacyInvite=await inst('applicant',{action:'invite',id,email:'legacy@example.test',role:'outreach'});
 await inst('legacy',{action:'accept-invite',token:legacyInvite.token});
 await cmd('applicant',{action:'enable-member',id,subject:'legacy'});
 await cmd('legacy',{action:'rotate-code',id});
 const legacyApp=(await cmd('legacy',submission)).application;
 assert.equal((await f.request('legacy',api,{action:'profile',id})).status,403);
 assert.equal((await f.owner.query("SELECT count(*)::int n FROM origen_coordinator_codes c JOIN origen_coordinator_profiles p ON p.id=c.coordinator_id WHERE p.auth0_subject='legacy' AND c.revoked_at IS NULL")).rows[0].n,0);
 await cmd('legacy',{action:'withdraw-application',id:legacyApp.id});
 await cmd('legacy',{action:'withdraw-application',id:legacyApp.id}); // safe idempotent retry
 assert.equal((await f.request('applicant',api,{action:'enable-member',id,subject:'legacy'})).status,403);

 await t.test('concurrent submit and owner enable cannot leave an unreviewed active profile',async()=>{
  for(let i=0;i<6;i++){
   const subject=`racer-${i}`;f.actor(subject);
   await f.owner.query('INSERT INTO origen_institution_representatives(auth0_subject,first_name,work_email,job_role) VALUES($1,$1,$2,$3)',[subject,`${subject}@example.test`,'Advisor']);
   await f.owner.query("INSERT INTO origen_institution_members VALUES($1,$2,'outreach')",[id,subject]);
   const results=await Promise.all([f.request(subject,api,submission),f.request('applicant',api,{action:'enable-member',id,subject})]);
   assert.equal(results[0].status,200);assert.ok([200,403].includes(results[1].status));
   assert.equal((await f.owner.query("SELECT count(*)::int n FROM origen_coordinator_profiles WHERE auth0_subject=$1 AND status='active'",[subject])).rows[0].n,0);
  }
 });
 await t.test('concurrent withdrawal and approval resolve to a valid state',async()=>{
  const subject='withdraw-racer';f.actor(subject);const a=(await cmd(subject,submission)).application;
  await f.owner.query("INSERT INTO origen_institution_members VALUES($1,$2,'outreach')",[id,subject]);
  const result=await Promise.all([f.request(subject,api,{action:'withdraw-application',id:a.id}),f.request('reviewer',api,{action:'approve-application',id:a.id,institutionId:id,reviewNote:'Checked'})]);
  assert.equal(result[0].status,200);assert.ok([200,409].includes(result[1].status));
  const state=(await cmd(subject,{action:'application-status'})).application;
  assert.equal((await f.owner.query("SELECT count(*)::int n FROM origen_coordinator_profiles WHERE auth0_subject=$1 AND status='active'",[subject])).rows[0].n,state?.status==='approved'?1:0);
 });
});

test('reviewer can find eligible organizations beyond overview limits, with bounded pagination and authorization',{skip:!process.env.DATABASE_TEST_URL},async t=>{
 const f=await coordinatorRegistrationFixture();t.after(()=>f.close());
 const cmd=(sub,input)=>f.call(sub,api,input),a=(await cmd('applicant',submission)).application;
 await f.owner.query("INSERT INTO origen_institutions(id,slug,draft,verification_status,created_at) SELECT gen_random_uuid(),'org-'||n,jsonb_build_object('name',CASE WHEN n=1 THEN 'Old Community Center' ELSE 'Center '||n END),'verified',now()+n*interval '1 second' FROM generate_series(1,105) n");
 await f.owner.query("INSERT INTO origen_coordinator_organizations(institution_id,status,approved_by) SELECT id,'active','reviewer' FROM origen_institutions");
 await f.owner.query("INSERT INTO origen_institution_members SELECT id,'applicant','outreach' FROM origen_institutions");
 const old=(await f.owner.query("SELECT id FROM origen_institutions WHERE draft->>'name'='Old Community Center'")).rows[0].id;
 assert.ok(!(await cmd('reviewer',{action:'overview'})).organizations.some(o=>o.id===old));
 const first=(await cmd('reviewer',{action:'application-organizations',id:a.id})).organizations;
 assert.equal(first.length,51);
 const second=(await cmd('reviewer',{action:'application-organizations',id:a.id,after:first[49].id})).organizations;
 assert.ok(second.every(o=>!first.slice(0,50).some(p=>p.id===o.id)));
 const found=(await cmd('reviewer',{action:'application-organizations',id:a.id,search:'old community'})).organizations;
 assert.deepEqual(found,[{id:old,name:'Old Community Center'}]);
 f.actor('reviewer',{mfa:false});assert.equal((await f.request('reviewer',api,{action:'application-organizations',id:a.id})).status,403);f.actor('reviewer');
 await f.owner.query("INSERT INTO origen_institution_representatives(auth0_subject,first_name,work_email,job_role) VALUES('reviewer','Reviewer','reviewer@example.test','Reviewer')");
 await f.owner.query("INSERT INTO origen_institution_members VALUES($1,'reviewer','owner')",[old]);
 assert.equal((await cmd('reviewer',{action:'application-organizations',id:a.id,search:'old community'})).organizations.length,0);
});

test('migration repairs already enabled unapproved applicants and preserves legacy and approved staff',{skip:!process.env.DATABASE_TEST_URL},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'origen-registration-migrations-'));
 t.after(()=>rm(directory,{recursive:true,force:true}));
 const source=new URL('./migrations/',import.meta.url);
 for(const name of await readdir(source))if(/^\d{3}_.*\.sql$/.test(name)&&Number(name.slice(0,3))<59)await copyFile(new URL(name,source),join(directory,name));
 const f=await coordinatorRegistrationFixture({migrationDirectory:pathToFileURL(directory+'/')});t.after(()=>f.close());
 const cmd=(sub,input)=>f.call(sub,api,input),org=randomUUID();
 const pending=(await cmd('applicant',submission)).application;
 const approved=(await cmd('invited',submission)).application;
 await f.owner.query("INSERT INTO origen_institutions(id,slug,draft,verification_status) VALUES($1,$2,$3,'verified')",[org,org,{name:'Upgrade fixture'}]);
 await f.owner.query("INSERT INTO origen_institution_representatives(auth0_subject,first_name,work_email,job_role) VALUES('legacy','Legacy','legacy@example.test','Advisor')");
 for(const sub of ['applicant','invited','legacy']){
  await f.owner.query("INSERT INTO origen_institution_members VALUES($1,$2,'owner')",[org,sub]);
 }
 await cmd('reviewer',{action:'approve-organization',id:org});
 await cmd('reviewer',{action:'approve-application',id:approved.id,institutionId:org,reviewNote:'Approved before upgrade'});
 await cmd('legacy',{action:'enable-member',id:org,subject:'legacy'});
 await cmd('legacy',{action:'enable-member',id:org,subject:'applicant'}); // reproduce pre-fix bypass
 await cmd('applicant',{action:'rotate-code',id:org});
 await assert.rejects(assertCoordinatorProvisioningReady(f.db,f.env),/coordinator_migration_required/);
 await migrateDatabase(f.owner);
 await grantRuntimeAccess(f.owner,f.role,{schema:f.schema});
 await assertCoordinatorProvisioningReady(f.db,f.env);
 assert.equal((await f.request('applicant',api,{action:'profile',id:org})).status,403);
 assert.equal((await cmd('invited',{action:'profile',id:org})).profile.status,'active');
 assert.equal((await cmd('legacy',{action:'profile',id:org})).profile.status,'active');
 await cmd('applicant',{action:'withdraw-application',id:pending.id});
 assert.equal((await f.request('legacy',api,{action:'enable-member',id:org,subject:'applicant'})).status,403);
 assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_coordinator_codes WHERE revoked_at IS NULL')).rows[0].n,0);
});
