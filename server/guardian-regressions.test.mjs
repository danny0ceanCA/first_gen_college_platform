import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {fixture} from './family-fixture.mjs';
import {createPermissionRepository} from './guardian-permission.mjs';
import {GUARDIAN_NOTICE_VERSION} from './guardian-email.mjs';
import {createLinksRepository} from './account-links.mjs';
import {createHistoryRepository} from './history.mjs';
import {createApp} from './index.mjs';
import {AUTH_TIME_CLAIM} from './recent-auth.mjs';
import {createGuardianRateLimit} from './guardian-rate-limit.mjs';
import {createPermissionHandler} from './guardian-permission.mjs';
import {Readable} from 'node:stream';

async function setup(){
 const f=await fixture(),mails=[];
 const repo=createPermissionRepository(f.pool,{mailer:{async send(mail){mails.push(mail);return 'mock';}}});
 const teen=async sub=>{await repo.account(sub,{action:'screen',ageBand:'13to17',audience:'grade9plus'});await repo.account(sub,{action:'request',guardianEmail:'parent@example.invalid'});return mails.at(-1);};
 return {...f,repo,teen};
}
const decision=(token,action='approve',noticeVersion=GUARDIAN_NOTICE_VERSION)=>({token,action,noticeVersion,confirmed:true});
async function http(f){
 const server=createServer(createApp({},async sub=>({sub,[AUTH_TIME_CLAIM]:Math.floor(Date.now()/1000)}),f.pool,()=>{}));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {close:()=>new Promise(resolve=>server.close(resolve)),post:async(path,body,sub)=>{
  const response=await fetch(`http://127.0.0.1:${server.address().port}${path}`,{method:'POST',headers:{'Content-Type':'application/json',...(sub?{Authorization:`Bearer ${sub}`}:{})},body:JSON.stringify(body)});
  return {status:response.status,body:await response.json()};
 }};
}

test('previous-notice withdrawal works without weakening approval, confirmation, kind or replay checks',async()=>{
 const f=await setup();try{
  const mail=await f.teen('teen');await f.repo.guardian(decision(mail.approvalToken));
  await f.pool.query("UPDATE origen_eligibility SET notice_version='previous-notice'");
  const view=await f.repo.guardian({action:'view',token:mail.withdrawalToken});assert.equal(view.noticeVersion,'previous-notice');
  await assert.rejects(f.repo.guardian({...decision(mail.withdrawalToken,'withdraw',view.noticeVersion),confirmed:false}),{status:400});
  await assert.rejects(f.repo.guardian(decision(mail.withdrawalToken,'approve',view.noticeVersion)),{status:403});
  await f.repo.guardian(decision(mail.withdrawalToken,'withdraw',view.noticeVersion));
  assert.equal((await f.repo.account('teen',{action:'status'})).allowed,false);
  await assert.rejects(f.repo.guardian(decision(mail.withdrawalToken,'withdraw',view.noticeVersion)),{status:410});
  const pending=await f.teen('pending');await f.pool.query("UPDATE origen_eligibility SET notice_version='previous-notice' WHERE status='pending'");
  await assert.rejects(f.repo.guardian(decision(pending.approvalToken)),{status:400});
  await assert.rejects(f.repo.guardian(decision(pending.approvalToken,'withdraw')),{status:400});
 }finally{await f.pool.end();}
});

for(const closing of ['owner','member'])for(const state of ['revoked','expired'])test(`${state} linked ${closing} can close through HTTP while the survivor keeps private records`,async()=>{
 const f=await setup();let api;try{
  for(const sub of ['owner','member']){const mail=await f.teen(sub);await f.repo.guardian(decision(mail.approvalToken));}
  const links=createLinksRepository(f.pool),history=createHistoryRepository(f.pool);
  await f.run('owner',{action:'save-student',student:{id:'s',name:'Student',stage:'10th grade',notes:'OWNER PRIVATE'}});
  const invite=await links('owner',{action:'create',studentId:'s',role:'student'});
  const joined=await links('member',{action:'accept',token:invite.token});
  const member=(await f.run('member',{action:'load'})).students[0];
  await f.run('member',{action:'save-student',student:{...member,notes:'MEMBER PRIVATE'}});
  await f.run('owner',{action:'save-student',student:{id:'s',name:'Latest name',stage:'11th grade',notes:'OWNER PRIVATE'}});
  for(const sub of ['owner','member'])await history(sub,{action:'save',item:{id:'h',studentId:sub==='owner'?'s':joined.studentId,mode:'planning',summary:`${sub} private history`,sources:[],date:new Date().toISOString()}});
  if(state==='revoked')for(const sub of ['owner','member'])await f.repo.account(sub,{action:'withdraw'});
  else await f.pool.query("UPDATE origen_eligibility SET permission_expires_at='2000-01-01'");
  api=await http(f);
  assert.equal((await api.post('/api/account-links',{action:'unlink',id:joined.links[0].id},closing)).status,403);
  assert.equal((await api.post('/api/account-data',{action:'delete',confirmation:'DELETE'},closing)).status,200);
  const survivor=closing==='owner'?'member':'owner';
  const exported=await api.post('/api/account-data',{action:'export'},survivor);
  assert.equal(exported.status,200);assert.equal(exported.body.students[0].name,'Latest name');
  assert.equal(exported.body.students[0].notes,`${survivor.toUpperCase()} PRIVATE`);
  assert.equal(exported.body.summaries[0].summary,`${survivor} private history`);
  assert.equal((await f.pool.query('SELECT * FROM origen_student_links')).rows.length,0);
  assert.equal((await api.post('/api/family',{action:'load'},closing)).status,403);
  assert.equal((await api.post('/api/family',{action:'load'},survivor)).status,403);
 }finally{await api?.close();await f.pool.end();}
});

test('invalid and exhausted capabilities cannot consume another guardian link budget on the same peer',async()=>{
 const f=await setup();let api;try{
  const a=await f.teen('a'),b=await f.teen('b');api=await http(f);
  for(let i=0;i<32;i++)await api.post('/api/guardian-permission',{action:'view',token:i%2?'malformed':randomBytes(32).toString('base64url')});
  assert.equal((await api.post('/api/guardian-permission',{action:'view',token:'malformed'})).status,429);
  for(let i=0;i<30;i++)assert.equal((await api.post('/api/guardian-permission',{action:'view',token:a.approvalToken})).status,200);
  assert.equal((await api.post('/api/guardian-permission',{action:'view',token:a.approvalToken})).status,429);
  assert.equal((await api.post('/api/guardian-permission',decision(b.approvalToken))).status,200);
  assert.equal((await api.post('/api/guardian-permission',decision(b.withdrawalToken,'withdraw'))).status,200);
  assert.equal((await f.repo.account('b',{action:'status'})).allowed,false);
 }finally{await api?.close();await f.pool.end();}
});

test('guardian budgets expire and bounded invalid-peer churn cannot evict capability budgets',()=>{
 let now=0;const limiter=createGuardianRateLimit({clock:()=>now,maxEntries:2});
 for(let i=0;i<30;i++)limiter.capability('known-hash');
 for(let i=0;i<100;i++)limiter.invalid(`peer-${i}`);
 assert.throws(()=>limiter.capability('known-hash'),{status:429});
 now=60000;assert.doesNotThrow(()=>limiter.capability('known-hash'));
});

test('random unknown guardian tokens cannot queue or occupy more than two database connections',async()=>{
 let connects=0,release;
 const blocked=new Promise(resolve=>{release=resolve;});
 const database={async connect(){connects++;await blocked;return {async query(){return {rows:[]};},release(){}};}};
 const handler=createPermissionHandler(database,{});
 const request=async()=>{
  const req=Object.assign(Readable.from([JSON.stringify({action:'view',token:randomBytes(32).toString('base64url')})]),{headers:{'content-type':'application/json'},socket:{remoteAddress:'shared-proxy'}});
  let status;await handler.handle(req,{writeHead:value=>{status=value;},end(){}},true);return status;
 };
 const first=request(),second=request();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(connects,2);
 const rejected=await Promise.all(Array.from({length:100},()=>request()));
 assert.ok(rejected.every(status=>status===503||status===429));assert.equal(connects,2);
 release();await Promise.all([first,second]);
 // Capacity is returned even when a lookup fails. A fresh request can proceed.
 assert.equal(await request(),429);assert.equal(connects,3);
});
