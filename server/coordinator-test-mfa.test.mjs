import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {coordinatorTestMfaExempt,COORDINATOR_TEST_SUBJECT as sub,COORDINATOR_TEST_MFA_CLAIM as claim} from '../src/coordinatorTestAccess.mjs';
import {staffAuthenticationError,requireStaffAccess,MFA_TIME_CLAIM} from './staff-access.mjs';
import {AUTH_TIME_CLAIM} from './recent-auth.mjs';
const action=createRequire(import.meta.url)('../auth0/staff-mfa-action.cjs');
const user={user_id:sub,email:'coordinator-test@example.test',email_verified:true,app_metadata:{synthetic_test_account:true,purpose:'coordinator_signup_testing'},enrolledFactors:[{type:'otp'}]};
const transaction={acr_values:['http://schemas.openid.net/pape/policies/2007/06/multi-factor']};
async function execute(overrides={}){
 const access={},id={},challenges=[];
 await action.onExecutePostLogin({user,transaction,...overrides},{accessToken:{setCustomClaim:(k,v)=>access[k]=v},idToken:{setCustomClaim:(k,v)=>id[k]=v},authentication:{challengeWith:v=>challenges.push(v),enrollWith:v=>challenges.push(v)}});
 return {access,id,challenges};
}
test('only the exact managed synthetic account skips the Auth0 challenge',async()=>{
 for(const tx of [transaction,{}]){
  const r=await execute({transaction:tx});assert.equal(r.challenges.length,0);assert.equal(r.access[claim],sub);assert.equal(r.id[claim],sub);assert.equal(r.access[MFA_TIME_CLAIM],undefined);
 }
 for(const patch of [{user_id:'auth0|someone-else'},{email:'real@example.org'},{email_verified:false},{app_metadata:{}},{app_metadata:{synthetic_test_account:'true',purpose:'coordinator_signup_testing'}},{app_metadata:undefined,user_metadata:user.app_metadata}]){
  const r=await execute({user:{...user,...patch}});assert.equal(r.challenges.length,1);assert.equal(r.access[claim],undefined);assert.equal(r.id[claim],undefined);
 }
});
test('signed exception retains twelve-hour sign-in freshness and never grants permissions',async()=>{
 const now=Date.now(),seconds=Math.floor(now/1000),identity={sub,iat:seconds,[claim]:sub,[AUTH_TIME_CLAIM]:seconds};
 assert.equal(coordinatorTestMfaExempt(identity),true);
 for(const fresh of [false,true]){
  assert.equal(staffAuthenticationError(identity,{now,fresh}),null);
  assert.equal(staffAuthenticationError({...identity,[AUTH_TIME_CLAIM]:seconds-43200},{now,fresh}),null);
  for(const value of [undefined,seconds-43201,seconds+1])assert.equal(staffAuthenticationError({...identity,[AUTH_TIME_CLAIM]:value},{now,fresh}),'reauthentication_required');
 }
 for(const who of [{sub,email:user.email},{...identity,sub:'auth0|someone-else'},{...identity,[claim]:true},{sub,user_metadata:{[claim]:sub}}]){
  assert.equal(coordinatorTestMfaExempt(who),false);assert.equal(staffAuthenticationError(who,{now}),'staff_mfa_required');
 }
 const audit=[];
 const database=control=>({query:async(sql,args)=>{
  if(sql.startsWith('SELECT blocked'))return {rows:control?[control]:[]};
  if(sql.startsWith('INSERT INTO origen_privileged_access_audit')){audit.push(args);return {rows:[]};}throw Error('unexpected query');
 }});
 await requireStaffAccess(database(),identity,{scope:'institution',action:'overview'});
 await assert.rejects(requireStaffAccess(database(),identity,{scope:'institution',action:'approve-application',permission:'manage:institutions'}),{message:'staff_permission_required'});
 await assert.rejects(requireStaffAccess(database({blocked:true}),identity,{scope:'institution',action:'overview'}),{message:'staff_access_revoked'});
 await assert.rejects(requireStaffAccess(database({blocked:false,token_valid_after:new Date(now+1000)}),identity,{scope:'institution',action:'overview'}),{message:'staff_access_revoked'});
 assert.deepEqual(audit.map(row=>row[5]),['authorized','denied','denied','denied']);
});
