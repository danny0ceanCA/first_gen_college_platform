import test from 'node:test';
import assert from 'node:assert/strict';
import {signupOrganization,signupMatchesApplication,registerSignupOrganization,savedOrganizationSignup,resumeOrganizationSignup} from '../src/coordinatorOrganizationSignup.mjs';
import {validateInstitution,createInstitutionRepository,validateInstitutionPage} from './institutions.mjs';
import {retrievalFixture} from './history-retrieval-fixture.mjs';
import {runApplicationCommand} from './coordinator-applications.mjs';
const application={displayName:'Synthetic Coordinator',email:'synthetic@example.org',jobRole:'Advisor',organizationName:'Community Futures',organizationWebsite:'https://example.org/'};
const registration=signupOrganization(application,' College and transfer support. ','00000000-0000-4000-8000-000000000001',true);

test('website-free organization signup can enter review while public publication still validates its website',()=>{
 const without=signupOrganization({...application,organizationWebsite:''},'College support.','00000000-0000-4000-8000-000000000001',true);
 assert.equal(validateInstitution(without).page.website,'');
 assert.equal(validateInstitutionPage(without.page,true,{requireWebsite:false}).website,'');
 assert.throws(()=>validateInstitutionPage(without.page,true));
 assert.throws(()=>validateInstitutionPage({...without.page,website:'javascript:alert(1)'},true,{requireWebsite:false}));
});

test('PostgreSQL persists a website-free application and registers its organization for review',{skip:!process.env.DATABASE_TEST_URL},async t=>{
 const f=await retrievalFixture();t.after(()=>f.close());
 const repository=createInstitutionRepository(f.db);
 const app=(await f.as('website-free',()=>runApplicationCommand(f.db,{action:'submit-application',...application,organizationWebsite:'',verifiedEmail:application.email}))).application;
 assert.equal(app.organizationWebsite,'');
 const signup=signupOrganization(app,'College support.',app.id,true);
 const run=input=>f.as('website-free',()=>repository('website-free',validateInstitution(input)));
 await registerSignupOrganization(run,signup);
 const saved=(await run({action:'signup-status',applicationId:app.id})).organization;
 assert.equal(saved.page.website,'');assert.equal(saved.status,'submitted');
});
test('signup uses the existing organization contract without public contact details or approval powers',()=>{
 assert.deepEqual(validateInstitution(registration),{...registration,parentId:null});
 assert.equal(registration.page.description,'College and transfer support.');
 assert.equal(registration.page.publicEmail,'');
 assert.throws(()=>signupOrganization(application,'Description','key',false));
 assert.throws(()=>signupOrganization(application,' ','key',true));
});

test('an organization draft belongs to one application, including after withdrawal',()=>{
 const a={...application,id:crypto.randomUUID()},b={...a,id:crypto.randomUUID(),organizationName:'Another organization'};
 const saved={registration:signupOrganization(a,'Description',a.id,true)};
 assert.equal(signupMatchesApplication(saved,a),true);
 assert.equal(signupMatchesApplication(saved,b),false);
 assert.equal(signupMatchesApplication({registration},a),false,'Legacy browser drafts cannot be attached to a new application');
 assert.equal(validateInstitution(saved.registration).applicationId,a.id);
});

test('server recovers signup across sessions, rejects stale applications, and returns review changes',{skip:!process.env.DATABASE_TEST_URL},async t=>{
 const f=await retrievalFixture();t.after(()=>f.close());
 const repository=createInstitutionRepository(f.db,['reviewer']);
 const call=(subject,input)=>f.as(subject,()=>repository(subject,validateInstitution(input)));
 const app=(subject,input)=>f.as(subject,()=>runApplicationCommand(f.db,input));
 const submit={action:'submit-application',...application,verifiedEmail:application.email};
 const a=(await app('signup-owner',submit)).application;
 const registration=signupOrganization(a,'Guidance.',a.id,true);
 const run=input=>call('signup-owner',input);
 await registerSignupOrganization(run,registration);
 const status={action:'signup-status',applicationId:a.id};
 const org=(await run(status)).organization;
 assert.equal(org.status,'submitted');
 // No browser storage needed; even a retry with a different random key uses the application ID.
 await run({...registration,registrationKey:crypto.randomUUID()});
 await Promise.all([run({...registration,registrationKey:crypto.randomUUID()}),run({...registration,registrationKey:crypto.randomUUID()})]);
 assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_institutions')).rows[0].n,1);
 await assert.rejects(call('another-owner',status),/application_changed/);
 await call('reviewer',{action:'request-changes',id:org.id,revision:org.revision,note:'Please clarify your services.'});
 const changes=(await run(status)).organization;
 assert.equal(changes.status,'changes-requested');
 assert.equal(changes.reviews[0].note,'Please clarify your services.');
 // Registration retry must not erase the correction request by resubmitting unchanged content.
 await registerSignupOrganization(run,registration);
 assert.equal((await run(status)).organization.status,'changes-requested');
 await assert.rejects(run({action:'save',id:org.id,revision:org.revision,page:{...org.page,description:'Stale edit.'}}),/institution_changed/);
 const updated=await run({action:'save',id:org.id,revision:changes.revision,page:{...changes.page,description:'Updated services.'}});
 const revision=updated.institutions.find(i=>i.id===org.id).revision;
 await run({action:'submit',id:org.id,revision});
 assert.equal((await run(status)).organization.status,'submitted');
 await app('signup-owner',{action:'withdraw-application',id:a.id});
 const b=(await app('signup-owner',{...submit,organizationName:'Organization B'})).application;
 await assert.rejects(run(registration),/application_changed/);
 assert.equal((await run({action:'signup-status',applicationId:b.id})).organization,null);
 await registerSignupOrganization(run,signupOrganization(b,'New organization.',b.id,true));
 assert.equal((await run({action:'signup-status',applicationId:b.id})).organization.page.name,'Organization B');
 await assert.rejects(run({...signupOrganization(b,'New organization.',b.id,true),page:{...registration.page,name:'Forged organization'}}),/application_changed/);
 // Legacy registrations are adopted durably, so later name edits do not lose the link.
 const legacy=(await app('legacy-owner',submit)).application;
 const legacyRegistration=signupOrganization(application,'Legacy organization.',crypto.randomUUID(),true);
 const created=await call('legacy-owner',legacyRegistration);
 const recovered=(await call('legacy-owner',{action:'signup-status',applicationId:legacy.id})).organization;
 assert.equal(recovered.id,created.registeredInstitutionId);
 await call('legacy-owner',{action:'save',id:recovered.id,revision:recovered.revision,page:{...recovered.page,name:'Corrected name'}});
 assert.equal((await call('legacy-owner',{action:'signup-status',applicationId:legacy.id})).organization.id,recovered.id);
 await f.owner.query("DELETE FROM origen_institution_members WHERE institution_id=$1 AND auth0_subject='legacy-owner'",[recovered.id]);
 await assert.rejects(call('legacy-owner',{action:'signup-status',applicationId:legacy.id}),/organization_ownership_changed/);
 // Ambiguous legacy records require an explicit choice rather than guessing or creating another.
 const ambiguous=(await app('ambiguous-owner',submit)).application;
 await call('ambiguous-owner',legacyRegistration);
 await call('ambiguous-owner',{...legacyRegistration,registrationKey:crypto.randomUUID()});
 await assert.rejects(call('ambiguous-owner',{action:'signup-status',applicationId:ambiguous.id}),/organization_recovery_ambiguous/);
});
test('signup retries an uncertain registration with the same key and finishes its review submission',async()=>{
 let created=false,submitted=false;const calls=[];
 const request=async input=>{
  calls.push(input);
  if(input.action==='register'){
   if(!created){created=true;throw new Error('response_lost');}
   return {registeredInstitutionId:'organization',institutions:[{id:'organization',revision:1,status:submitted?'submitted':'draft',membershipRole:'owner'}]};
  }
  assert.deepEqual(input,{action:'submit',id:'organization',revision:1});submitted=true;
  return {institutions:[{id:'organization',status:'submitted'}]};
 };
 await assert.rejects(registerSignupOrganization(request,registration),/response_lost/);
 assert.deepEqual(await registerSignupOrganization(request,registration),{id:'organization'});
 await registerSignupOrganization(request,registration);
 assert.equal(calls.filter(c=>c.action==='submit').length,1);
 assert.equal(new Set(calls.filter(c=>c.action==='register').map(c=>c.registrationKey)).size,1);
});
test('MFA denial stops signup registration without sending a review request',async()=>{
 let count=0;
 await assert.rejects(registerSignupOrganization(async()=>{count++;throw new Error('staff_mfa_required');},registration),/staff_mfa_required/);
 assert.equal(count,1);
});
test('missing ownership, archived organizations and unfinished submission cannot report success',async()=>{
 for(const organization of [null,{id:'organization',membershipRole:'viewer'},{id:'organization',membershipRole:'owner',archivedAt:'2026-10-20'}]){
  await assert.rejects(registerSignupOrganization(async()=>({registeredInstitutionId:'organization',institutions:organization?[organization]:[]}),registration),/organization_registration_incomplete/);
 }
 await assert.rejects(registerSignupOrganization(async input=>input.action==='register'?{registeredInstitutionId:'organization',institutions:[{id:'organization',revision:1,status:'draft',membershipRole:'owner'}]}:{institutions:[]},registration),/organization_registration_incomplete/);
});


test('account draft survives MFA interruption, empty new-tab storage and concurrent resumes',{skip:!process.env.DATABASE_TEST_URL},async t=>{
 const {coordinatorRegistrationFixture}=await import('./fixtures/coordinator-registration.mjs');
 const f=await coordinatorRegistrationFixture();t.after(()=>f.close());
 const api='/api/coordinator-access',institutions='/api/institutions';
 const description='College guidance.\nStudent support.';
 f.actor('durable',{mfa:false});f.actor('unrelated',{mfa:false});
 const submitted=await f.call('durable',api,{action:'submit-application',...application,organizationRegistration:{description,authorized:true,administrator:true}});
 const id=submitted.application.id;
 assert.deepEqual(submitted.application.organizationRegistration,{description,authorized:true});
 // An independent read models a new tab: the only input is the signed-in account.
 const recovered=(await f.call('durable',api,{action:'application-status'})).application;
 assert.deepEqual(savedOrganizationSignup(recovered).registration.page.description,description);
 assert.equal((await f.call('unrelated',api,{action:'application-status'})).application,null);
 assert.equal((await f.request('unrelated',api,{action:'save-organization-registration',id,organizationRegistration:{description,authorized:true}})).status,409);
 await assert.rejects(resumeOrganizationSignup(input=>f.call('durable',institutions,input),recovered),/staff_mfa_required/);
 assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_institutions')).rows[0].n,0);
 // Retrying the application cannot replace an already-saved signup intent.
 await f.call('durable',api,{action:'submit-application',...application,organizationRegistration:{description:'Changed retry',authorized:true}});
 assert.equal((await f.call('durable',api,{action:'application-status'})).application.organizationRegistration.description,description);
 f.actor('durable');
 const resumed=await Promise.all(Array.from({length:4},()=>resumeOrganizationSignup(input=>f.call('durable',institutions,input),recovered)));
 assert.equal(new Set(resumed.map(org=>org.id)).size,1);assert.equal(resumed[0].status,'submitted');
 assert.equal(resumed[0].page.description,description);
 assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_institutions')).rows[0].n,1);
 for(const table of ['origen_coordinator_profiles','origen_coordinator_codes','origen_binder_share_grants'])assert.equal((await f.owner.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n,0);
 const run=input=>f.call('durable',institutions,input);
 const org=resumed[0];
 await f.call('reviewer',institutions,{action:'request-changes',id:org.id,revision:org.revision,note:'Clarify services.'});
 assert.equal((await resumeOrganizationSignup(run,recovered)).status,'changes-requested');
 await f.call('durable',api,{action:'withdraw-application',id});
 assert.equal((await f.call('durable',api,{action:'application-status'})).application,null);
 const replacement=(await f.call('durable',api,{action:'submit-application',...application})).application;
 assert.equal(replacement.organizationRegistration,null);
 await assert.rejects(resumeOrganizationSignup(run,recovered),/application_changed/);
 // Existing incomplete applicants can save their details once before another redirect.
 const intent={description:'Legacy interrupted registration.',authorized:true};
 const saved=await f.call('durable',api,{action:'save-organization-registration',id:replacement.id,organizationRegistration:intent});
 assert.deepEqual(saved.application.organizationRegistration,intent);
 await f.call('durable',api,{action:'save-organization-registration',id:replacement.id,organizationRegistration:intent});
 assert.equal((await f.request('durable',api,{action:'save-organization-registration',id:replacement.id,organizationRegistration:{...intent,description:'Conflicting tab'}})).status,409);
 await assert.rejects(f.as('durable',()=>f.db.query('SELECT organization_registration FROM origen_coordinator_applications')),{code:'42501'});
});


test('full admin can review organizations and approve coordinator applications without MFA',{skip:!process.env.DATABASE_TEST_URL},async t=>{
 const {coordinatorRegistrationFixture}=await import('./fixtures/coordinator-registration.mjs');
 const {AUTH_TIME_CLAIM}=await import('./recent-auth.mjs');
 const f=await coordinatorRegistrationFixture();t.after(()=>f.close());
 const api='/api/coordinator-access',institutions='/api/institutions';
 f.actor('no-mfa-admin',{mfa:false,reviewer:true,claims:n=>({permissions:['read:activity','manage:institutions'],[AUTH_TIME_CLAIM]:n})});
 f.actor('ordinary-reviewer',{mfa:false,reviewer:true});
 const a=(await f.call('applicant',api,{action:'submit-application',...application})).application;
 await registerSignupOrganization(input=>f.call('applicant',institutions,input),signupOrganization(a,'Student college guidance.',a.id,true));
 const owner=(await f.call('applicant',institutions,{action:'signup-status',applicationId:a.id})).organization;
 const loaded=await f.call('no-mfa-admin',institutions,{action:'load'});
 assert.equal(loaded.adminReview,true);assert.equal(loaded.canReview,true);
 const queue=await f.call('no-mfa-admin',institutions,{action:'queue'});assert.equal(queue.submissions[0].id,owner.id);
 assert.equal((await f.request('ordinary-reviewer',institutions,{action:'queue'})).body.error,'staff_mfa_required');
 assert.equal((await f.request('ordinary-reviewer',api,{action:'applications'})).body.error,'staff_mfa_required');
 await f.call('no-mfa-admin',institutions,{action:'verify',id:owner.id,revision:owner.revision,note:'Affiliation independently checked.'});
 await f.call('no-mfa-admin',api,{action:'approve-organization',id:owner.id});
 assert.equal((await f.call('no-mfa-admin',api,{action:'applications'})).applications[0].id,a.id);
 await f.call('no-mfa-admin',api,{action:'approve-application',id:a.id,institutionId:owner.id,reviewNote:'Affiliation checked.'});
 assert.equal((await f.call('applicant',api,{action:'application-status'})).application.status,'approved');
 assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_binder_share_grants')).rows[0].n,0);
});
