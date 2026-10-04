import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {fixture} from './family-fixture.mjs';
import {createLifecycleRepository,accountClosed,purgeExpiredInvites} from './account-lifecycle.mjs';
import {createLinksRepository} from './account-links.mjs';
import {createHistoryRepository} from './history.mjs';
import {createApp} from './index.mjs';
const student={id:'s',name:'Student',stage:'10th grade',notes:'MY PRIVATE NOTES'};
test('export is account-scoped and confirmed closure cascades private records without deleting another account',async()=>{
 const {pool,run}=await fixture();const lifecycle=createLifecycleRepository(pool);
 try{
  await run('owner',{action:'save-student',student});await run('other',{action:'save-student',student:{...student,notes:'OTHER PRIVATE'}});
  await createHistoryRepository(pool)('owner',{action:'save',item:{id:'h',studentId:null,mode:'planning',summary:'MY HISTORY',sources:[],date:new Date().toISOString()}});
  const data=await lifecycle('owner',{action:'export'});assert.equal(data.students[0].notes,'MY PRIVATE NOTES');assert.equal(data.summaries[0].summary,'MY HISTORY');assert.doesNotMatch(JSON.stringify(data),/OTHER PRIVATE|token_hash/);
  await assert.rejects(lifecycle('owner',{action:'delete',confirmation:'no'}),{status:400});assert.equal(await accountClosed(pool,'owner'),false);
  await lifecycle('owner',{action:'delete',confirmation:'DELETE'});assert.equal(await accountClosed(pool,'owner'),true);
  assert.equal((await pool.query('SELECT * FROM origen_conversation_summaries')).rows.length,0);
  assert.equal((await pool.query('SELECT * FROM origen_students')).rows.length,1);assert.equal((await run('other',{action:'load'})).students[0].notes,'OTHER PRIVATE');
  const receipt=(await pool.query('SELECT * FROM origen_closed_accounts')).rows[0];assert.equal(receipt.subject_hash.length,64);assert.doesNotMatch(JSON.stringify(receipt),/owner/);
 }finally{await pool.end();}
});
test('linked accounts must unlink explicitly and expired invitations are removed',async()=>{
 const {pool,run}=await fixture();const links=createLinksRepository(pool),life=createLifecycleRepository(pool);
 try{
  await run('owner',{action:'save-student',student});const invite=await links('owner',{action:'create',studentId:'s',role:'student'});const joined=await links('member',{action:'accept',token:invite.token});
  await assert.rejects(life('owner',{action:'delete',confirmation:'DELETE'}),{status:409,message:'unlink_family_first'});
  await assert.rejects(life('member',{action:'delete',confirmation:'DELETE'}),{status:409});
  await links('owner',{action:'unlink',id:joined.links[0].id});await life('owner',{action:'delete',confirmation:'DELETE'});assert.equal((await run('member',{action:'load'})).students[0].name,'Student');
  await pool.query("INSERT INTO origen_family_invites(owner_account_id,student_id,target_role,token_hash,expires_at) SELECT account_id,id,'parent',$1,$2::timestamptz FROM origen_students",['a'.repeat(64),new Date('2020-01-01')]);
  await purgeExpiredInvites(pool);assert.equal((await pool.query('SELECT * FROM origen_family_invites')).rows.length,0);
 }finally{await pool.end();}
});
test('closed sign-ins cannot recreate records through gateway and forged export ownership is rejected',async()=>{
 const {pool,run}=await fixture();await run('owner',{action:'save-student',student});const server=createServer(createApp({ALLOWED_ORIGINS:'https://origen.example'},async token=>({sub:token,"https://origenedu.ai/auth_time":Math.floor(Date.now()/1000)}),pool,()=>{}));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 const post=(path,data,token='owner')=>fetch(base+path,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',Origin:'https://origen.example'},body:JSON.stringify(data)});
 try{
  assert.equal((await post('/api/account-data',{action:'export',accountId:'forged'})).status,400);
  assert.equal((await post('/api/account-data',{action:'delete',confirmation:'DELETE'})).status,200);
  assert.equal((await post('/api/family',{action:'load'})).status,403);
  assert.equal((await pool.query('SELECT * FROM origen_accounts')).rows.length,0);
  assert.equal((await post('/api/account-data',{action:'export'},'other')).status,200);
 }finally{await new Promise(r=>server.close(r));await pool.end();}
});
