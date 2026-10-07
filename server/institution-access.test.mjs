import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './family-fixture.mjs';
import {createInstitutionRepository,validateInstitution} from './institutions.mjs';
import {hashToken,invitationIdentity} from './institution-access.mjs';
import {createMetricsRepository} from './institution-metrics.mjs';
const representative={firstName:'Alex',workEmail:'alex@college.edu',jobRole:'Staff'};
const page={name:'Woodland Example College',website:'https://college.example/',description:'College services',programs:'',admissions:'',financialAid:'',events:'',publicEmail:'',links:[]};
const registration=(extra={})=>({action:'register',registrationKey:crypto.randomUUID(),representative,page,...extra});
async function setup(){const {pool}=await fixture();const run=createInstitutionRepository(pool,['reviewer','parent-owner']);return {pool,run,call:(sub,input,identity)=>run(sub,validateInstitution(input),identity)};}
async function publish(call,owner,id,revision=1){await call(owner,{action:'submit',id,revision});await call('reviewer',{action:'verify',id,revision,note:'Independently verified'});await call('reviewer',{action:'publish',id,revision,note:'Reviewed'});}
async function invite(call,owner,id,sub,role='editor',email=`${sub}@college.edu`){const result=await call(owner,{action:'invite',id,email,role});await call(sub,{action:'accept-invite',token:result.token},{sub,email,email_verified:true,given_name:sub});return result;}

test('registration retries return one workspace and changed retry payload is rejected',async()=>{
 const {pool,call}=await setup();try{
  const input=registration();const a=await call('owner',input),b=await call('owner',input);
  assert.equal(a.institutions[0].id,b.institutions[0].id);assert.equal(b.institutions.length,1);
  assert.equal((await pool.query('SELECT * FROM origen_institutions')).rows.length,1);
  await assert.rejects(call('owner',{...input,page:{...page,name:'Changed'}}),{status:409,message:'registration_changed'});
  assert.throws(()=>validateInstitution({...input,registrationKey:'bad'}),{status:400});
 }finally{await pool.end();}
});
test('workspace resolution distinguishes personal access and does not create family onboarding records',async()=>{
 const {pool,call}=await setup();try{
  assert.deepEqual(await call('new',{action:'access'}),{memberships:[],hasPersonalAccount:false});
  await call('owner',registration());const access=await call('owner',{action:'access'});
  assert.equal(access.memberships.length,1);assert.equal(access.hasPersonalAccount,false);
  assert.equal((await pool.query('SELECT * FROM origen_accounts')).rows.length,0);
  await pool.query('INSERT INTO origen_accounts(auth0_subject) VALUES($1)',['owner']);
  assert.equal((await call('owner',{action:'access'})).hasPersonalAccount,true);
 }finally{await pool.end();}
});
test('invitations require intended verified identity, expire, revoke and can be used once',async()=>{
 const {pool,call}=await setup();try{
  const institution=(await call('owner',registration())).institutions[0],id=institution.id;
  const inv=await call('owner',{action:'invite',id,email:'Editor@college.edu',role:'editor'});
  assert.equal(inv.token.length,43);const stored=(await pool.query('SELECT * FROM origen_institution_invites')).rows[0];assert.equal(stored.token_hash,hashToken(inv.token));assert.notEqual(stored.token_hash,inv.token);
  for(const identity of [{sub:'editor',email:'other@college.edu',email_verified:true},{sub:'editor',email:'editor@college.edu',email_verified:false},{sub:'other',email:'editor@college.edu',email_verified:true}])await assert.rejects(call('editor',{action:'accept-invite',token:inv.token},identity),{status:403});
  await call('editor',{action:'accept-invite',token:inv.token},{sub:'editor',email:'editor@college.edu',email_verified:true});
  await assert.rejects(call('editor',{action:'accept-invite',token:inv.token},{sub:'editor',email:'editor@college.edu',email_verified:true}),{status:410});
  const revoked=await call('owner',{action:'invite',id,email:'other@college.edu',role:'analyst'});await call('owner',{action:'revoke-invite',id,inviteId:revoked.inviteId});await assert.rejects(call('other',{action:'accept-invite',token:revoked.token},{sub:'other',email:'other@college.edu',email_verified:true}),{status:410});
  const expired=await call('owner',{action:'invite',id,email:'other@college.edu',role:'analyst'});await pool.query('UPDATE origen_institution_invites SET expires_at=$2 WHERE id=$1',[expired.inviteId,new Date('2020-01-01')]);await assert.rejects(call('other',{action:'accept-invite',token:expired.token},{sub:'other',email:'other@college.edu',email_verified:true}),{status:410});
  assert.doesNotMatch(JSON.stringify(await call('owner',{action:'team',id})),new RegExp(inv.token));
 }finally{await pool.end();}
});
test('owner, editor, outreach and analyst access is enforced with revocation and ownership transfer',async()=>{
 const {pool,call}=await setup();try{
  const id=(await call('owner',registration())).institutions[0].id;
  for(const role of ['editor','outreach','analyst'])await invite(call,'owner',id,role,role);
  await call('editor',{action:'save',id,revision:1,page:{...page,description:'Updated'}});
  for(const sub of ['analyst','outreach']){await assert.rejects(call(sub,{action:'save',id,revision:2,page}),{status:403});await assert.rejects(call(sub,{action:'submit',id,revision:2}),{status:403});}
  await assert.rejects(call('editor',{action:'invite',id,email:'new@college.edu',role:'editor'}),{status:403});
  await assert.rejects(call('outsider',{action:'team',id}),{status:404});
  await assert.rejects(call('owner',{action:'remove-member',id,subject:'owner'}),{status:409});
  await assert.rejects(call('owner',{action:'set-role',id,subject:'owner',role:'analyst'}),{status:409});
  await call('owner',{action:'remove-member',id,subject:'analyst'});assert.equal((await call('analyst',{action:'access'})).memberships.length,0);
  await assert.rejects(createMetricsRepository(pool)('analyst',{action:'report',id}),{status:404});
  await assert.rejects(call('analyst',{action:'save',id,revision:2,page}),{status:404});
  const oldInvite=await call('owner',{action:'invite',id,email:'pending@college.edu',role:'editor'});
  await call('owner',{action:'transfer-owner',id,subject:'editor'});
  await assert.rejects(call('owner',{action:'team',id}),{status:403});
  assert.equal((await call('editor',{action:'team',id})).members.find(m=>m.auth0_subject==='editor').role,'owner');
  await assert.rejects(call('pending',{action:'accept-invite',token:oldInvite.token},{sub:'pending',email:'pending@college.edu',email_verified:true}),{status:410});
  const history=(await pool.query('SELECT * FROM origen_institution_access_events WHERE institution_id=$1',[id])).rows;assert.ok(history.some(e=>e.action==='transfer-owner'));
 }finally{await pool.end();}
});
test('department requests require parent approval and independent publication; sibling access remains isolated',async()=>{
 const {pool,call,run}=await setup();try{
  const parent=(await call('parent-owner',registration())).institutions[0];await publish(call,'parent-owner',parent.id);
  const input=registration({parentId:parent.id,unitType:'department',page:{...page,name:'Admissions'}});
  const child=(await call('department-owner',input)).institutions[0];assert.equal(child.parentApproval,'pending');
  await assert.rejects(call('department-owner',{action:'submit',id:child.id,revision:1}),{status:409,message:'parent_approval_required'});
  await assert.rejects(call('outsider',{action:'approve-unit',id:parent.id,unitId:child.id}),{status:404});
  assert.equal((await call('parent-owner',{action:'load'})).unitRequests[0].id,child.id);
  await call('parent-owner',{action:'approve-unit',id:parent.id,unitId:child.id});
  await assert.rejects(call('parent-owner',{action:'approve-unit',id:parent.id,unitId:child.id}),{status:409});
  await call('department-owner',{action:'submit',id:child.id,revision:2});
  await assert.rejects(call('parent-owner',{action:'verify',id:child.id,revision:2,note:'Approve own unit'}),{status:403,message:'independent_review_required'});
  await call('reviewer',{action:'verify',id:child.id,revision:2,note:'Parent and unit authority independently checked'});await call('reviewer',{action:'publish',id:child.id,revision:2,note:'Reviewed'});
  const publicChild=await run(null,{action:'public',slug:child.slug});assert.equal(publicChild.parent.name,page.name);
  const publicParent=await run(null,{action:'public',slug:parent.slug});assert.equal(publicParent.units[0].name,'Admissions');
  assert.doesNotMatch(JSON.stringify(publicParent),/work_email|auth0_subject|review_note/);
  const sibling=(await call('parent-owner',registration({parentId:parent.id,unitType:'program',page:{...page,name:'Transfer support'}}))).institutions.find(i=>i.page.name==='Transfer support');
  await assert.rejects(call('department-owner',{action:'save',id:sibling.id,revision:1,page}),{status:404});
  await assert.rejects(call('outsider',registration({parentId:child.id,unitType:'department'})),{status:404});
  await call('department-owner',{action:'save',id:child.id,revision:2,page:{...page,name:'Changed',parentId:sibling.id}});
  const stored=(await pool.query('SELECT parent_institution_id FROM origen_institutions WHERE id=$1',[child.id])).rows[0];assert.equal(stored.parent_institution_id,parent.id);
 }finally{await pool.end();}
});
test('unpublished parent blocks child publication and rejected relationships cannot submit',async()=>{
 const {pool,call}=await setup();try{
  const parent=(await call('owner',registration())).institutions[0];
  const child=(await call('owner',registration({parentId:parent.id,unitType:'department',page:{...page,name:'Aid'}}))).institutions.find(i=>i.parentInstitutionId);
  await call('owner',{action:'submit',id:child.id,revision:1});await call('reviewer',{action:'verify',id:child.id,revision:1,note:'Confirmed independently'});
  await assert.rejects(call('reviewer',{action:'publish',id:child.id,revision:1,note:'Approve'}),{status:409,message:'parent_publication_required'});
  await publish(call,'owner',parent.id);
  const pending=(await call('staff',registration({parentId:parent.id,unitType:'program'}))).institutions[0];await call('owner',{action:'reject-unit',id:parent.id,unitId:pending.id});
  await assert.rejects(call('staff',{action:'submit',id:pending.id,revision:2}),{status:409});
 }finally{await pool.end();}
});
test('affiliation requests stay private, support unregistered parents and never grant membership through review',async()=>{
 const {pool,call}=await setup();try{
  const req={action:'request-affiliation',requestId:crypto.randomUUID(),parentName:'Unregistered college',parentWebsite:'https://college.example/',unitName:'Outreach',unitType:'program',...representative};
  await call('requester',req);await call('requester',req);const requests=(await call('requester',{action:'load'})).affiliationRequests;assert.equal(requests.length,1);
  assert.equal((await call('foreign',{action:'load'})).affiliationRequests.length,0);
  const id=requests[0].id;await assert.rejects(call('requester',{action:'review-affiliation',id,status:'verified',note:'Self'}),{status:403});
  await call('reviewer',{action:'review-affiliation',id,status:'verified',note:'Contacted institution'});assert.equal((await call('requester',{action:'access'})).memberships.length,0);
  await assert.rejects(call('reviewer',{action:'review-affiliation',id,status:'resolved',note:'Resolved'}),{status:409});
  const parent=(await call('owner',registration())).institutions[0];await publish(call,'owner',parent.id);
  await invite(call,'owner',parent.id,'requester');
  await call('reviewer',{action:'review-affiliation',id,parentId:parent.id,status:'resolved',note:'Verified and owner invitation accepted'});
  const resolved=(await call('requester',{action:'load'})).affiliationRequests[0];assert.equal(resolved.status,'resolved');assert.equal(resolved.parent_institution_id,parent.id);
 }finally{await pool.end();}
});
test('invitation email verification uses the configured issuer and rejects another identity',async()=>{
 const req={headers:{authorization:'Bearer test'},origenIdentity:{sub:'actual'}};let requested;
 const result=await invitationIdentity(req,{AUTH0_DOMAIN:'origen.example'},async(url,options)=>{requested={url,options};return {ok:true,json:async()=>({sub:'actual',email:'a@college.edu',email_verified:true})};});
 assert.equal(result.sub,'actual');assert.equal(requested.url,'https://origen.example/userinfo');assert.equal(requested.options.headers.Authorization,'Bearer test');
 await assert.rejects(invitationIdentity(req,{AUTH0_DOMAIN:'origen.example'},async()=>({ok:true,json:async()=>({sub:'other'})})),{status:403});
 await assert.rejects(invitationIdentity(req,{},async()=>assert.fail()),{status:503});
});
