import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {fixture} from './family-fixture.mjs';
import {createLinksRepository,validateLinkRequest,createLinksHandler} from './account-links.mjs';
import {createHistoryRepository} from './history.mjs';
const profile={id:'same-id',name:'Sofia',stage:'10th grade',interest:'Art',gpa:'3.5',color:'peach',notes:'PRIVATE OWNER NOTES',needs:'PRIVATE FINANCIAL NEEDS'};
test('invitation links share only selected academic fields and private histories remain isolated',async()=>{
 const {pool,run}=await fixture();const link=createLinksRepository(pool);
 try{
  await run('parent',{action:'save-student',student:profile});
  await run('parent',{action:'save-student',student:{...profile,id:'sibling',name:'Sibling'}});
  await run('student',{action:'save-student',student:{...profile,name:'Unrelated profile'}});
  const created=await link('parent',{action:'create',studentId:profile.id,role:'student'});
  assert.match(created.token,/^[A-Za-z0-9_-]{43}$/);
  const stored=(await pool.query('SELECT token_hash FROM origen_family_invites')).rows[0].token_hash;
  assert.equal(stored.length,64);assert.notEqual(stored,created.token);
  assert.equal((await link('student',{action:'inspect',token:created.token})).invitation.studentName,'Sofia');
  await assert.rejects(link('parent',{action:'accept',token:created.token}),{status:409});
  const accepted=await link('student',{action:'accept',token:created.token});
  await assert.rejects(link('stranger',{action:'accept',token:created.token}),{status:410});
  let family=await run('student',{action:'load'});const shared=family.students.find(s=>s.id===accepted.studentId);
  assert.equal(family.students.length,2);assert.equal(shared.name,'Sofia');assert.equal(shared.notes,'');assert.equal(shared.needs,'');
  await run('student',{action:'save-student',student:{...shared,goals:'Architecture',notes:'PRIVATE STUDENT NOTES'}});
  const owner=(await run('parent',{action:'load'})).students.find(s=>s.id===profile.id);
  assert.equal(owner.goals,'Architecture');assert.equal(owner.notes,'PRIVATE OWNER NOTES');assert.equal(owner.needs,'PRIVATE FINANCIAL NEEDS');
  await run('parent',{action:'save-student',student:{...owner,interest:'Design'}});
  assert.equal((await run('student',{action:'load'})).students.find(s=>s.id===accepted.studentId).interest,'Design');
  const history=createHistoryRepository(pool);
  await history('student',{action:'save',item:{id:'private',studentId:accepted.studentId,mode:'admissions',date:new Date().toISOString(),summary:'PRIVATE CONVERSATION',sources:[]}});
  assert.equal((await history('parent',{action:'load'})).items.length,0);
  await assert.rejects(link('stranger',{action:'unlink',id:accepted.links[0].id}),{status:404});
  await assert.rejects(link('student',{action:'create',studentId:accepted.studentId,role:'parent'}),{status:409});
  await assert.rejects(run('parent',{action:'delete-student',id:profile.id}),{status:409});
  await link('student',{action:'unlink',id:accepted.links[0].id});
  await run('parent',{action:'save-student',student:{...owner,interest:'New private plan'}});
  family=await run('student',{action:'load'});
  assert.equal(family.students.find(s=>s.id===accepted.studentId).interest,'Design');
  assert.equal((await history('student',{action:'load'})).items.length,1);
 }finally{await pool.end();}
});
test('expired, cancelled and replaced invites cannot be accepted or disclose profiles',async()=>{
 const {pool,run}=await fixture();const link=createLinksRepository(pool);
 try{
  await run('owner',{action:'save-student',student:profile});
  const old=await link('owner',{action:'create',studentId:profile.id,role:'parent'});
  const latest=await link('owner',{action:'create',studentId:profile.id,role:'parent'});
  await assert.rejects(link('other',{action:'inspect',token:old.token}),{status:410});
  await assert.rejects(link('other',{action:'revoke',id:latest.inviteId}),{status:404});
  await link('owner',{action:'revoke',id:latest.inviteId});
  await assert.rejects(link('other',{action:'accept',token:latest.token}),{status:410});
  const expired=await link('owner',{action:'create',studentId:profile.id,role:'parent'});
  await pool.query("UPDATE origen_family_invites SET expires_at='2000-01-01' WHERE id=$1",[expired.inviteId]);
  await assert.rejects(link('other',{action:'accept',token:expired.token}),{status:410});
  await assert.rejects(link('other',{action:'create',studentId:profile.id,role:'parent'}),{status:404});
  const fresh=await link('owner',{action:'create',studentId:profile.id,role:'parent'});
  const accepted=await link('other',{action:'accept',token:fresh.token});
  await link('owner',{action:'unlink',id:accepted.links[0].id});
  assert.equal((await link('owner',{action:'load'})).links.length,0);
  assert.equal((await run('other',{action:'load'})).students[0].name,'Sofia');
 }finally{await pool.end();}
});
test('link endpoint requires authentication, validates input and hides database errors',async()=>{
 const call=async(handler,input,authorized=true)=>{
  const req=Object.assign(Readable.from([JSON.stringify(input)]),{url:'/api/account-links',method:'POST',headers:{'content-type':'application/json'},origenAuthorized:authorized,origenIdentity:{sub:'actual-user'}});
  let status,body;await handler(req,{writeHead:s=>status=s,end:value=>body=JSON.parse(value)},()=>assert.fail());return {status,body};
 };
 assert.equal((await call(createLinksHandler(null),{action:'load'},false)).status,401);
 const observed=[];const handler=createLinksHandler(null,async(subject,input)=>{observed.push({subject,input});return {links:[],invites:[]};});
 await call(handler,{action:'load',subject:'victim'});assert.equal(observed[0].subject,'actual-user');
 assert.equal((await call(handler,{action:'accept',token:'guess'})).status,400);
 assert.equal((await call(createLinksHandler(null,()=>{throw new Error('secret');}),{action:'load'})).body.error,'links_unavailable');
 for(const input of [{action:'create',studentId:'x',role:'admin'},{action:'unlink',id:'guess'}])assert.throws(()=>validateLinkRequest(input),{status:400});
});
