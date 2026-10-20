import test from 'node:test';
import assert from 'node:assert/strict';
import {signupOrganization,registerSignupOrganization} from '../src/coordinatorOrganizationSignup.mjs';
import {validateInstitution} from './institutions.mjs';
const application={displayName:'Synthetic Coordinator',email:'synthetic@example.org',jobRole:'Advisor',organizationName:'Community Futures',organizationWebsite:'https://example.org/'};
const registration=signupOrganization(application,' College and transfer support. ','00000000-0000-4000-8000-000000000001',true);
test('signup uses the existing organization contract without public contact details or approval powers',()=>{
 assert.deepEqual(validateInstitution(registration),{...registration,parentId:null});
 assert.equal(registration.page.description,'College and transfer support.');
 assert.equal(registration.page.publicEmail,'');
 assert.throws(()=>signupOrganization(application,'Description','key',false));
 assert.throws(()=>signupOrganization(application,' ','key',true));
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
