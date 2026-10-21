import test from 'node:test';
import assert from 'node:assert/strict';
import {signupOrganization,signupMatchesApplication,registerSignupOrganization} from '../src/coordinatorOrganizationSignup.mjs';
import {validateInstitution,createInstitutionRepository} from './institutions.mjs';
import {retrievalFixture} from './history-retrieval-fixture.mjs';
import {runApplicationCommand} from './coordinator-applications.mjs';
const application={displayName:'Synthetic Coordinator',email:'synthetic@example.org',jobRole:'Advisor',organizationName:'Community Futures',organizationWebsite:'https://example.org/'};
const registration=signupOrganization(application,' College and transfer support. ','00000000-0000-4000-8000-000000000001',true);
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
 const updated=await run({action:'save',id:org.id,revision:org.revision,page:{...org.page,description:'Updated services.'}});
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
