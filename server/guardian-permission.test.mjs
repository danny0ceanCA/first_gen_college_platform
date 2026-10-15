import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {fixture} from './family-fixture.mjs';
import {createPermissionRepository,tokenHash} from './guardian-permission.mjs';
import {GUARDIAN_NOTICE,GUARDIAN_NOTICE_VERSION,createGuardianMailer,guardianMailConfig} from './guardian-email.mjs';
import {createApp} from './index.mjs';
import {permissionContext,assertPermission} from './permission-context.mjs';
import {permissionFetch,sweepPermissionCalls} from './permission-execution.mjs';
import {createFamilyRepository} from './family.mjs';
import {createLifecycleRepository} from './account-lifecycle.mjs';
const screen=(ageBand='13to17',audience='grade9plus')=>({action:'screen',ageBand,audience});
async function setup(){const {pool}=await fixture();let now=Date.now();const mails=[];const repo=createPermissionRepository(pool,{clock:()=>now,mailer:{async send(mail){mails.push(mail);return 'mock';}}});return {pool,repo,mails,tick:ms=>{now+=ms;}};}
const approve=(repo,token,action='approve')=>repo.guardian({action,token,confirmed:true,noticeVersion:GUARDIAN_NOTICE_VERSION});

test('neutral screening separates grade from age, blocks under 13 and prevents self-reclassification',async()=>{
 const f=await setup();try{
  assert.equal((await f.repo.account('unknown',{action:'status'})).status,'unknown');
  for(const [subject,age,audience,status] of [['child','under13','grade9plus','blocked'],['adult','18plus','grade9plus','adult'],['parent','18plus','adult_supporter','adult'],['youngparent','13to17','adult_supporter','blocked'],['other','18plus','other','blocked'],['teen','13to17','grade9plus','pending']]){
   assert.equal((await f.repo.account(subject,screen(age,audience))).status,status);
  }
  await assert.rejects(f.repo.account('child',screen('18plus')),{status:409});
  await assert.rejects(f.repo.account('child',{action:'request',guardianEmail:'parent@example.invalid'}),{status:403});
  assert.equal((await f.pool.query('SELECT * FROM origen_accounts')).rows.length,0);
 }finally{await f.pool.end();}
});
test('guardian action is explicit, tokens are hashed, scoped, expiring and single-use; approval grants no family link',async()=>{
 const f=await setup();try{
  await f.repo.account('teen',screen());const result=await f.repo.account('teen',{action:'request',guardianEmail:'parent@example.invalid'});const mail=f.mails[0];
  assert.equal(result.delivery,'mock');assert.ok(!JSON.stringify(result).includes(mail.approvalToken));
  const row=await f.repo.read('teen');assert.equal(row.approval_hash,tokenHash(mail.approvalToken));assert.ok(!JSON.stringify(row).includes(mail.approvalToken));
  const displayedNotice=await f.repo.guardian({action:'view',token:mail.approvalToken});
  assert.equal(displayedNotice.kind,'approval');assert.deepEqual(displayedNotice.notice,GUARDIAN_NOTICE);
  assert.equal((await f.repo.account('teen',{action:'status'})).allowed,false);
  await assert.rejects(f.repo.guardian({action:'approve',token:mail.approvalToken}),{status:400});
  await assert.rejects(approve(f.repo,mail.withdrawalToken),{status:403});
  await approve(f.repo,mail.approvalToken);
  assert.equal((await f.repo.account('teen',{action:'status'})).allowed,true);
  assert.equal((await f.repo.account('other',{action:'status'})).allowed,false);
  await assert.rejects(approve(f.repo,mail.approvalToken),{status:410});
  assert.equal((await f.pool.query('SELECT * FROM origen_student_links')).rows.length,0);
  const events=(await f.pool.query('SELECT * FROM origen_permission_events')).rows;assert.deepEqual(events.map(e=>e.decision),['screened','requested','approved']);assert.equal(events.at(-1).request_id,result.requestId);
  await approve(f.repo,mail.withdrawalToken,'withdraw');assert.equal((await f.repo.account('teen',{action:'status'})).allowed,false);
  await assert.rejects(approve(f.repo,mail.withdrawalToken,'withdraw'),{status:410});
  await assert.rejects(f.repo.account('teen',{action:'request',guardianEmail:'new@example.invalid'}),{status:403});
 }finally{await f.pool.end();}
});
test('resend invalidates prior tokens, cooldown/daily budgets apply, pending and granted permission expire',async()=>{
 const f=await setup();try{
  await f.repo.account('teen',screen());await f.repo.account('teen',{action:'request',guardianEmail:'parent@example.invalid'});
  await assert.rejects(f.repo.account('teen',{action:'request',guardianEmail:'parent@example.invalid'}),{status:429});
  f.tick(61000);await f.repo.account('teen',{action:'request',guardianEmail:'parent@example.invalid'});
  await assert.rejects(approve(f.repo,f.mails[0].approvalToken),{status:410});
  f.tick(61000);await f.repo.account('teen',{action:'request',guardianEmail:'parent@example.invalid'});
  f.tick(61000);await assert.rejects(f.repo.account('teen',{action:'request',guardianEmail:'parent@example.invalid'}),{status:429});
  f.tick(49*3600000);await assert.rejects(approve(f.repo,f.mails.at(-1).approvalToken),{status:410});
  await f.repo.account('teen',{action:'request',guardianEmail:'parent@example.invalid'});await approve(f.repo,f.mails.at(-1).approvalToken);
  f.tick(181*86400000);assert.equal((await f.repo.account('teen',{action:'status'})).status,'expired');
 }finally{await f.pool.end();}
});
test('default transport never calls network; Resend contract uses configured sender and API key without exposing tokens in results',async()=>{
 let calls=0;assert.equal(await createGuardianMailer({},()=>{calls++;throw Error();}).send({}), 'disabled');assert.equal(calls,0);
 assert.equal(guardianMailConfig().from,'daniel@origenedu.ai');
 assert.throws(()=>guardianMailConfig({GUARDIAN_EMAIL_TRANSPORT:'resend'}),/configuration/);
 const env={GUARDIAN_EMAIL_TRANSPORT:'resend',RESEND_API_KEY:'SYNTHETIC',GUARDIAN_PUBLIC_URL:'https://example.invalid/'};
 const mailer=createGuardianMailer(env,async(url,options)=>{assert.equal(url,'https://api.resend.com/emails');const body=JSON.parse(options.body);assert.equal(body.from,'Daniel at Origen Edu <daniel@origenedu.ai>');assert.equal(body.reply_to,'daniel@origenedu.ai');assert.equal(options.headers.Authorization,'Bearer SYNTHETIC');assert.match(body.text,/#guardian\/SYNTHETIC_APPROVAL/);assert.match(body.text,/guardian-2026-10-15-v1/);assert.match(body.html,/cid:origen-mark/);assert.equal(body.attachments[0].content_id,'origen-mark');assert.equal(Buffer.from(body.attachments[0].content,'base64').subarray(1,4).toString(),'PNG');return {ok:true};});
 assert.equal(await mailer.send({to:'parent@example.invalid',requestId:'synthetic',approvalToken:'SYNTHETIC_APPROVAL',withdrawalToken:'SYNTHETIC_WITHDRAWAL'}),'accepted');
});
test('all private HTTP paths reject unknown/pending/blocked accounts before profile or AI input is processed',async()=>{
 const f=await setup(),logs=[];const app=createApp({},async sub=>({sub}),f.pool,row=>logs.push(row));const server=createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const post=async(path,body={},sub='unknown')=>{const response=await fetch(`http://127.0.0.1:${server.address().port}${path}`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${sub}`},body:JSON.stringify(body)});return {status:response.status,data:await response.json()};};
 try{
  for(const path of ['/api/family','/api/profile-voice','/api/conversation-summary','/api/chat','/api/ai','/api/finance-research','/api/admissions-research','/api/topic-notes','/api/guidance-history','/api/plans','/api/workspace-sheets','/api/account-links','/api/conversation-history'])assert.equal((await post(path,{sdp:'PRIVATE SDP',action:'update-guide',turns:[{role:'user',text:'PRIVATE TRANSCRIPT'}]})).status,403,path);
  assert.equal((await post('/api/eligibility',screen())).data.status,'pending');
  assert.equal((await post('/api/family',{action:'load'})).status,403);
  const request=await post('/api/eligibility',{action:'request',guardianEmail:'parent@example.invalid'});assert.equal(request.data.delivery,'disabled');assert.ok(!JSON.stringify(logs).includes('parent@example.invalid'));
  assert.equal((await post('/api/eligibility',screen('18plus'),'adult')).data.allowed,true);
  assert.equal((await post('/api/family',{action:'load'},'adult')).status,200);
  assert.equal((await f.pool.query('SELECT * FROM origen_accounts')).rows.length,1);
  assert.ok(!JSON.stringify(logs).includes('PRIVATE'));
 }finally{await new Promise(r=>server.close(r));await f.pool.end();}
});
test('revocation rejects delayed provider bodies, profile writes and summaries under an earlier revision',async()=>{
 const f=await setup();try{
  await f.repo.account('adult',screen('18plus'));const row=await f.repo.read('adult'),controller=new AbortController();
  await permissionContext.run({subject:'adult',revision:row.revision,signal:controller.signal},async()=>{
   const guarded=permissionFetch(f.pool,{},async()=>new Response(JSON.stringify({text:'late result'}),{status:200}));const response=await guarded('https://api.openai.com/v1/responses');
   await permissionContext.run(undefined,()=>f.repo.account('adult',{action:'withdraw'}));
   await assert.rejects(response.json(),{status:403});await assert.rejects(assertPermission(f.pool),{status:403});
   await assert.rejects(createFamilyRepository(f.pool)('adult',{action:'save-account',account:{firstName:'Late',email:''}}),{status:403});
  });
 }finally{await f.pool.end();}
});
test('Realtime calls are durably tracked and hangup retried on revocation; account deletion erases guardian email',async()=>{
 const f=await setup();try{
  await f.repo.account('teen',screen());await f.repo.account('teen',{action:'request',guardianEmail:'parent@example.invalid'});await approve(f.repo,f.mails[0].approvalToken);const row=await f.repo.read('teen');
  await permissionContext.run({subject:'teen',revision:row.revision,signal:new AbortController().signal},async()=>{const request=permissionFetch(f.pool,{},async()=>new Response('v=0',{headers:{location:'https://api.openai.com/v1/realtime/calls/rtc_synthetic'}}));assert.equal(await (await request('https://api.openai.com/v1/realtime/calls')).text(),'v=0');});
  let calls=0;await sweepPermissionCalls(f.pool,{},async()=>{calls++;return {ok:true};});assert.equal(calls,0);
  await approve(f.repo,f.mails[0].withdrawalToken,'withdraw');await sweepPermissionCalls(f.pool,{},async()=>{calls++;return {ok:false,status:500};});assert.equal((await f.pool.query('SELECT * FROM origen_permission_calls')).rows.length,1);
  await sweepPermissionCalls(f.pool,{},async(url)=>{assert.match(url,/rtc_synthetic\/hangup$/);calls++;return {ok:true};});assert.equal(calls,2);assert.equal((await f.pool.query('SELECT * FROM origen_permission_calls')).rows.length,0);
  await createLifecycleRepository(f.pool)('teen',{action:'delete',confirmation:'DELETE'});assert.equal(await f.repo.read('teen'),undefined);assert.equal((await f.pool.query('SELECT * FROM origen_permission_events')).rows.length,0);
 }finally{await f.pool.end();}
});
