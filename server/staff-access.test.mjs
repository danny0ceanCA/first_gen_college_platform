import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createRequire} from 'node:module';
import {ADMIN_ACTIONS,MFA_TIME_CLAIM,adminCapabilities,adminInstitutionAccess,staffPermissions,staffAuthenticationError,requireStaffAccess} from './staff-access.mjs';
import {AUTH_TIME_CLAIM} from './recent-auth.mjs';
import {createAdminHandler} from './admin.mjs';
import {createInstitutionHandler} from './institutions.mjs';
import {createInquiryHandler} from './institution-inquiries.mjs';
import {createCampaignHandler} from './institution-campaigns.mjs';
import {createMetricsHandler} from './institution-metrics.mjs';
const now=Date.now(),seconds=Math.floor(now/1000);
const identity={sub:'auth0|staff',iat:seconds,[MFA_TIME_CLAIM]:seconds,[AUTH_TIME_CLAIM]:seconds};
function database(control){const audit=[];return {audit,query:async(sql,values)=>{if(sql.startsWith('SELECT blocked'))return {rows:control?[control]:[]};if(sql.startsWith('INSERT INTO origen_privileged_access_audit')){audit.push(values);return {rows:[]};}throw new Error('unexpected private-data query');}};}
async function request(handler,url,body,who){const req=Readable.from([JSON.stringify(body)]);Object.assign(req,{url,method:'POST',headers:{'content-type':'application/json'},origenAuthorized:true,origenIdentity:who});const out={};await handler(req,{writeHead(status){out.status=status;},end(value){out.body=JSON.parse(value);}},()=>{throw new Error('unexpected next');});return out;}
test('complete staff action matrix defaults to denial and accepts only its explicit permission',async()=>{
 for(const [action,permission] of Object.entries(ADMIN_ACTIONS)){
  const db=database();await assert.rejects(requireStaffAccess(db,identity,{scope:'admin',action,permission}),{status:403,message:'staff_permission_required'});
  await requireStaffAccess(db,{...identity,permissions:[permission]},{scope:'admin',action,permission,fresh:permission.startsWith('write:')});
  assert.deepEqual(db.audit.map(a=>a[5]),['denied','authorized']);
 }
 assert.deepEqual(staffPermissions({sub:'auth0|x',roles:['admin'],scope:'write:reviews',user_metadata:{permissions:['write:reviews']}}),[]);
 assert.deepEqual(staffPermissions({sub:'owner'},{ADMIN_SUBJECTS:'owner'}),['read:activity']);
 const caps=adminCapabilities({sub:'reader',permissions:['read:activity']},{});
 for(const action of ['users','review-decision','institution-snapshot-save','conversation-review'])assert.equal(caps.actions.includes(action),false);
});
test('MFA and authentication use twelve hours for reads and writes and fail closed',()=>{
 assert.equal(staffAuthenticationError(identity,{now}),null);
 for(const v of [undefined,null,'123',seconds+1,0,seconds-43201])assert.equal(staffAuthenticationError({...identity,[MFA_TIME_CLAIM]:v},{now}),'staff_mfa_required');
 for(const fresh of [false,true]){
  for(const age of [301,43199,43200])assert.equal(staffAuthenticationError({...identity,[MFA_TIME_CLAIM]:seconds-age,[AUTH_TIME_CLAIM]:seconds-age},{now,fresh}),null);
  assert.equal(staffAuthenticationError({...identity,[MFA_TIME_CLAIM]:seconds-43201},{now,fresh}),'staff_mfa_required');
  assert.equal(staffAuthenticationError({...identity,[AUTH_TIME_CLAIM]:seconds-43201},{now,fresh}),'reauthentication_required');
 }
 assert.equal(staffAuthenticationError({...identity,[AUTH_TIME_CLAIM]:seconds-301},{now}),null);
 assert.equal(staffAuthenticationError({sub:'x',amr:['mfa'],auth_time:seconds,user_metadata:{[MFA_TIME_CLAIM]:seconds}},{now}),'staff_mfa_required');
});
test('blocked and pre-revocation tokens are denied without reading user content',async()=>{
 for(const control of [{blocked:true,token_valid_after:new Date(now-5000)},{blocked:false,token_valid_after:new Date(now+1000)}]){
  const db=database(control);await assert.rejects(requireStaffAccess(db,identity,{scope:'admin',action:'overview'}),{message:'staff_access_revoked'});assert.equal(db.audit[0][5],'denied');
 }
 await requireStaffAccess(database({blocked:false,token_valid_after:new Date(now-5000)}),identity,{scope:'admin',action:'overview'});
 await assert.rejects(requireStaffAccess({query:async()=>{throw new Error('offline');}},identity,{scope:'admin',action:'overview',permission:'read:activity'}),{status:503,message:'staff_audit_unavailable'});
});
test('audit is an allowlisted receipt and never copies sensitive request fields',async()=>{
 const db=database();await requireStaffAccess(db,identity,{scope:'admin',action:'overview',target:'PRIVATE email and name',summary:'PRIVATE conversation',token:'PRIVATE bearer'});
 assert.equal(db.audit[0].length,6);assert.match(db.audit[0][1],/^[a-f0-9]{64}$/);assert.match(db.audit[0][4],/^[a-f0-9]{64}$/);assert.doesNotMatch(JSON.stringify(db.audit),/PRIVATE|auth0/);
});
test('admin reads use normal sign-in while write freshness and institution MFA remain enforced',async()=>{
 const db=database(),admin=createAdminHandler(db,{}),reader={sub:'auth0|reader',permissions:['read:activity']};
 assert.equal((await request(admin,'/api/admin',{action:'access'},reader)).body.admin,true);
 assert.equal((await request(admin,'/api/admin',{action:'access'},reader)).body.authenticationRequired,null);
 await requireStaffAccess(db,reader,{scope:'admin',action:'overview',permission:'read:activity'});
 assert.equal(db.audit.at(-1)[5],'authorized');
 assert.equal((await request(admin,'/api/admin',{action:'review-decision',mfa:true},{...reader,permissions:['write:reviews']})).body.error,'reauthentication_required');
 for(const action of ['user-detail','conversation-review','review-decision','institution-snapshot-save'])assert.equal((await request(admin,'/api/admin',{action},{...identity,permissions:['read:activity']})).body.error,'staff_permission_required');
 assert.equal((await request(admin,'/api/admin',{action:'__proto__'},reader)).status,400);
 assert.equal((await request(admin,'/api/admin',null,reader)).status,400);
 const id='00000000-0000-4000-8000-000000000001';
 for(const [handler,url,body] of [
  [createInstitutionHandler(db),'/api/institutions',{action:'load'}],
  [createInquiryHandler(db),'/api/institution-inquiries/staff',{action:'inbox',institutionId:id}],
  [createCampaignHandler(db),'/api/institution-campaigns',{action:'list',institutionId:id}],
  [createMetricsHandler(db),'/api/institution-metrics/report',{id}],
 ]){const r=await request(handler,url,body,{sub:'auth0|staff'});assert.equal(r.body.error,'staff_mfa_required',JSON.stringify(r));}
});
test('regular admin access does not require MFA claims, but fresh mutations need actual login proof',async()=>{
 const normal={sub:'auth0|admin',iat:seconds,permissions:['read:activity','write:reviews']};
 assert.equal(adminCapabilities(normal,{}).authenticationRequired,null);
 assert.equal(staffAuthenticationError(normal,{now,requireMfa:false}),null);
 for(const value of [undefined,null,'123',0,seconds+1,seconds-43201])assert.equal(staffAuthenticationError({...normal,[AUTH_TIME_CLAIM]:value},{now,fresh:true,requireMfa:false}),'reauthentication_required');
 assert.equal(staffAuthenticationError({...normal,[AUTH_TIME_CLAIM]:seconds-43200},{now,fresh:true,requireMfa:false}),null);
 assert.equal(staffAuthenticationError({...normal,[AUTH_TIME_CLAIM]:seconds},{now,fresh:true,requireMfa:false}),null);
 await requireStaffAccess(database(),{...normal,[AUTH_TIME_CLAIM]:seconds},{scope:'admin',action:'review-decision',permission:'write:reviews',fresh:true});
 await assert.rejects(requireStaffAccess(database(),normal,{scope:'admin',action:'review-decision',permission:'write:reviews',fresh:true}),{message:'reauthentication_required'});
 await assert.rejects(requireStaffAccess(database(),normal,{scope:'admin',action:'users',permission:'read:users'}),{message:'staff_permission_required'});
});

test('admin institution access omits MFA while retaining permission, sign-in, audit and suspension gates',async()=>{
 const admin={sub:'auth0|admin',iat:seconds,permissions:['read:activity','manage:institutions'],[AUTH_TIME_CLAIM]:seconds};
 assert.equal(adminInstitutionAccess(admin),true);
 for(const who of [{sub:'x',permissions:['manage:institutions']},{sub:'x',permissions:['read:activity']},{sub:'x',email:'daniel@origenedu.ai',roles:['admin'],user_metadata:{permissions:admin.permissions}}]){
  assert.equal(adminInstitutionAccess(who),false);
  await assert.rejects(requireStaffAccess(database(),who,{scope:'institution',action:'load'}),{message:'staff_mfa_required'});
 }
 for(const action of ['load','queue','applications','verify','approve-application','approve-organization'])await requireStaffAccess(database(),admin,{scope:'institution',action,permission:'manage:institutions',fresh:action.startsWith('approve')||action==='verify'});
 await assert.rejects(requireStaffAccess(database(),{...admin,[AUTH_TIME_CLAIM]:seconds-43201},{scope:'institution',action:'verify',permission:'manage:institutions',fresh:true}),{message:'reauthentication_required'});
 await assert.rejects(requireStaffAccess(database({blocked:true}),admin,{scope:'institution',action:'queue',permission:'manage:institutions'}),{message:'staff_access_revoked'});
 await assert.rejects(requireStaffAccess(database(),admin,{scope:'institution',action:'queue',permission:'write:reviews'}),{message:'staff_permission_required'});
 await assert.rejects(requireStaffAccess({query:async sql=>{if(sql.startsWith('SELECT blocked'))return {rows:[]};throw Error('offline');}},admin,{scope:'institution',action:'queue'}),{message:'staff_audit_unavailable'});
});
test('Auth0 challenge and proof Actions distinguish enrollment, completed MFA, and refresh',async()=>{
 const require=createRequire(import.meta.url),challenge=require('../auth0/staff-mfa-action.cjs'),proof=require('../auth0/recent-auth-action.cjs');
 const calls=[],claims={};const api={authentication:{challengeWith:x=>calls.push(['challenge',x]),enrollWith:x=>calls.push(['enroll',x])},accessToken:{setCustomClaim:(key,value)=>claims[key]=value}};
 await challenge.onExecutePostLogin({transaction:{},user:{}},api);assert.equal(calls.length,0);
 const transaction={acr_values:['http://schemas.openid.net/pape/policies/2007/06/multi-factor']};
 await challenge.onExecutePostLogin({transaction,user:{}},api);await challenge.onExecutePostLogin({transaction,user:{enrolledFactors:[{type:'otp'}]}},api);
 assert.deepEqual(calls.map(c=>c[0]),['enroll','challenge']);
 await proof.onExecutePostLogin({session:{authenticated_at:new Date(now-600000).toISOString()},authentication:{methods:[{name:'pwd',timestamp:new Date(now).toISOString()}]}},api);assert.equal(claims[MFA_TIME_CLAIM],undefined);
 await proof.onExecutePostLogin({session:{authenticated_at:new Date(now-600000).toISOString()},authentication:{methods:[{name:'mfa',timestamp:new Date(now-600000).toISOString()}]}},api);
 assert.equal(claims[MFA_TIME_CLAIM],seconds-600);assert.equal(claims[AUTH_TIME_CLAIM],seconds-600);
});

test('non-Enterprise Auth0 login proof recognizes completed first factors without renewing them',async()=>{
 const proof=createRequire(import.meta.url)('../auth0/recent-auth-action.cjs');
 const old=new Date(now-600000).toISOString(),recent=new Date(now).toISOString();
 async function issue(event){const claims={};await proof.onExecutePostLogin(event,{accessToken:{setCustomClaim:(key,value)=>claims[key]=value}});return claims;}
 for(const name of ['pwd','federated','passkey']){
  const claims=await issue({authentication:{methods:[{name,timestamp:recent},{name:'mfa',timestamp:recent}]}});
  assert.equal(staffAuthenticationError(claims,{now,fresh:true}),null);
 }
 const refreshed=await issue({transaction:{protocol:'oauth2-refresh-token'},authentication:{methods:[{name:'pwd',timestamp:old},{name:'mfa',timestamp:old}]}});
 assert.equal(refreshed[AUTH_TIME_CLAIM],seconds-600);
 assert.equal(refreshed[MFA_TIME_CLAIM],seconds-600);
 assert.equal(staffAuthenticationError(refreshed,{now,fresh:true}),null);
 const expired=new Date(now-43201000).toISOString();
 const expiredRefresh=await issue({transaction:{protocol:'oauth2-refresh-token'},authentication:{methods:[{name:'pwd',timestamp:expired},{name:'mfa',timestamp:expired}]}});
 assert.equal(staffAuthenticationError(expiredRefresh,{now,fresh:true}),'staff_mfa_required');
 assert.equal((await issue({authentication:{methods:[{name:'pwd',timestamp:old},{name:'mfa',timestamp:recent}]}}))[AUTH_TIME_CLAIM],seconds-600);
 for(const methods of [undefined,{},[],[{name:'mfa',timestamp:recent}],[{name:'https://untrusted.example/method',timestamp:recent}],[{name:'pwd',timestamp:'invalid'}]]){
  assert.equal((await issue({authentication:{methods}}))[AUTH_TIME_CLAIM],undefined);
 }
 assert.equal((await issue({authentication:{methods:[{name:'pwd',timestamp:recent}]}}))[MFA_TIME_CLAIM],undefined);
});
