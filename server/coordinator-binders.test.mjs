import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {retrievalFixture} from './history-retrieval-fixture.mjs';
import {runAsAccount,runAsCoordinatorActor} from './account-isolation.mjs';
import {runCoordinatorCommand} from './coordinator-access.mjs';
import {runSharingCommand,validateSharingInput} from './binder-sharing.mjs';
import {runCoordinatorBinderCommand,validateCoordinatorBinderInput,coordinatorViewingEnabled,createCoordinatorBindersHandler,assertCoordinatorViewingReady} from './coordinator-binders.mjs';
import {coordinatorConfigurationIssues} from './binder-sharing-policy.mjs';
import {MFA_TIME_CLAIM} from './staff-access.mjs';
import {AUTH_TIME_CLAIM} from './recent-auth.mjs';
const hash=v=>createHash('sha256').update(v).digest('hex');
const env={ORIGEN_COORDINATOR_ACCOUNTS:'true',ORIGEN_COORDINATOR_LINKING:'true',ORIGEN_BINDER_SHARING:'true',ORIGEN_COORDINATOR_BINDER_VIEWING:'true'};
test('coordinator publication inputs are bounded and viewing has a separate kill switch',()=>{
 const org=randomUUID();assert.deepEqual(validateCoordinatorBinderInput({action:'list',organizationId:org,search:' Alex ',studentId:'secret',coordinatorId:'forged',administrator:true,limit:999}),{action:'list',organizationId:org,search:'Alex',view:'all'});
 for(const extra of [{action:'export'},{search:'a'.repeat(81)},{view:'family'},{cursor:'invalid'},{action:'review',grantId:randomUUID(),publicationId:3}])assert.throws(()=>validateCoordinatorBinderInput({action:'list',organizationId:org,...extra}),{status:400});
 assert.throws(()=>validateSharingInput({action:'help',studentId:'alex',grantId:randomUUID(),requested:'true'}),{status:400});
 assert.equal(coordinatorViewingEnabled(env),true);assert.equal(coordinatorViewingEnabled({...env,ORIGEN_COORDINATOR_BINDER_VIEWING:'false'}),false);
 assert.equal(coordinatorViewingEnabled({...env,ORIGEN_BINDER_SHARING:'false'}),false);assert.deepEqual(coordinatorConfigurationIssues(env),[]);
});
test('coordinator workspace reads only current explicit publications',{skip:!process.env.DATABASE_TEST_URL},async t=>{
 const f=await retrievalFixture();t.after(()=>f.close());await assertCoordinatorViewingReady(f.runtime,env);
 const account=(await f.owner.query("SELECT id FROM origen_accounts WHERE auth0_subject='other'")).rows[0].id,org=randomUUID();
 for(const sub of ['owner','staff','colleague','reviewer'])await f.owner.query('INSERT INTO origen_institution_representatives(auth0_subject,first_name,work_email,job_role) VALUES($1,$1,$2,$3)',[sub,`${sub}@example.test`,'Synthetic']);
 await f.owner.query("INSERT INTO origen_institutions(id,slug,draft,verification_status) VALUES($1,$2,$3,'verified')",[org,org,{name:'Synthetic Community'}]);
 for(const [sub,role] of [['owner','owner'],['staff','outreach'],['colleague','outreach']])await f.owner.query('INSERT INTO origen_institution_members VALUES($1,$2,$3)',[org,sub,role]);
 const provision=(sub,action,extra={},administrator=false)=>f.as(sub,()=>runAsCoordinatorActor(sub,{administrator},()=>runCoordinatorCommand(f.db,{action,id:org,...extra})));
 await provision('reviewer','approve-organization',{},true);for(const subject of ['staff','colleague'])await provision('owner','enable-member',{subject});
 await f.owner.query("INSERT INTO origen_eligibility(subject_hash,age_band,audience,status,notice_version) VALUES($1,'18plus','grade9plus','adult','synthetic')",[hash('other')]);
 const share=(student,action,extra={})=>f.as('other',()=>runSharingCommand(f.db,{...validateSharingInput({action,studentId:student,...extra}),enabled:true}));
 const staff=(action,extra={},sub='staff')=>f.as(sub,()=>runAsCoordinatorActor(sub,{issuedAt:Math.floor(Date.now()/1000),administrator:sub==='reviewer'},()=>runCoordinatorBinderCommand(f.db,{...validateCoordinatorBinderInput({action,organizationId:org,...extra})})));
 async function seed(student,recipient='staff'){
  if(!['alex','sam'].includes(student))await f.family('other',{action:'save-student',student:{id:student,name:student,stage:'Community college',interest:'',gpa:'',color:'peach',goals:'',needs:''}});
  await f.owner.query("INSERT INTO origen_coordinator_student_pilots(account_id,student_id,permission_revision,approved_by) VALUES($1,$2,1,'synthetic') ON CONFLICT DO NOTHING",[account,student]);
  const connection=randomUUID();await f.owner.query("INSERT INTO origen_binder_connections(id,account_id,student_id,coordinator_id,status,request_id,expires_at,accepted_at,display_name) SELECT $1,$2,$3,id,'accepted',$4,now()+interval '7 days',now(),$3 FROM origen_coordinator_profiles WHERE auth0_subject=$5 AND institution_id=$6",[connection,account,student,randomUUID(),recipient,org]);
  const note=randomUUID();await f.note({action:'create',studentId:student,id:note,note:{topic:'options',kind:'note',content:`Shared note for ${student}.`,language:'en'}},'other');
  const publish=async()=>{const card=await share(student,'preview',{connectionId:connection,topics:['options'],entryIds:[note]});return share(student,'publish',{previewId:card.previewId,confirmed:true});};
  const publication=await publish();const grant=(await share(student,'status')).grants.find(g=>g.connectionId===connection).id;
  return {student,note,grant,publish,publication:publication.publicationId};
 }
 const a=await seed('alex'),b=await seed('sam','colleague');
 await f.save('secret-family','PRIVATE_FAMILY_SENTINEL',{studentId:null,sub:'other'});
 await f.note({action:'create',studentId:null,id:randomUUID(),note:{topic:'options',kind:'note',content:'PRIVATE_NOTE_SENTINEL',language:'en'}},'other');
 await t.test('review receipts work with a non-superuser migration owner while runtime table access stays denied',async()=>{
  const ownerRole=`binder_owner_${randomUUID().replaceAll('-','')}`;
  const original=(await f.owner.query('SELECT current_user AS name')).rows[0].name.replaceAll('"','""');
  await f.owner.query(`CREATE ROLE ${ownerRole} NOLOGIN NOSUPERUSER NOBYPASSRLS`);
  const client=await f.owner.connect();
  try{
   await client.query(`GRANT USAGE ON SCHEMA ${f.schema} TO ${ownerRole}`);
   await client.query(`ALTER TABLE origen_binder_reviews OWNER TO ${ownerRole}`);
   await assert.rejects(f.as('staff',()=>f.db.query('SELECT * FROM origen_binder_reviews')),{code:'42501'});
   await client.query('BEGIN');await client.query(`SET LOCAL ROLE ${ownerRole}`);
   await client.query('INSERT INTO origen_binder_reviews(grant_id,publication_id) VALUES($1,$2)',[a.grant,a.publication]);
   await client.query('ROLLBACK');
  }finally{await client.query('ROLLBACK');await client.query(`ALTER TABLE origen_binder_reviews OWNER TO "${original}"`);await client.query(`REVOKE ALL ON SCHEMA ${f.schema} FROM ${ownerRole}`);await client.query(`DROP ROLE ${ownerRole}`);client.release();}
 });
 await t.test('same-organization colleagues and administrators cannot cross the recipient boundary',async()=>{
  const list=await staff('list');assert.equal(list.counts.all,1);assert.deepEqual(list.binders.map(x=>x.studentName),['alex']);assert.equal(list.binders[0].entries,undefined);
  const detail=await staff('read',{grantId:a.grant});assert.equal(detail.entries.length,1);assert.equal(detail.entries[0].content,'Shared note for alex.');assert.deepEqual(Object.keys(detail.entries[0]).sort(),['content','id','kind','language','topic']);
  for(const grantId of [b.grant,randomUUID()]){await assert.rejects(staff('read',{grantId}),{status:404,message:'binder_unavailable'});await assert.rejects(staff('list',{cursor:grantId}),{status:404,message:'binder_unavailable'});await assert.rejects(staff('review',{grantId,publicationId:a.publication}),{status:404});}
  for(const sub of ['colleague','owner','reviewer'])await assert.rejects(staff('read',{grantId:a.grant},sub),{status:sub==='colleague'?404:403});
  await assert.rejects(staff('list',{organizationId:randomUUID()}),{status:403});
  await assert.rejects(f.as('staff',()=>runCoordinatorBinderCommand(f.db,{action:'list',organizationId:org})),{status:403});
  assert.equal((await staff('list',{search:'sam'})).counts.all,0);assert.equal((await staff('list',{search:'PRIVATE_'})).counts.all,0);
  assert.ok(!JSON.stringify([list,detail]).includes('PRIVATE_'));assert.deepEqual((await f.as('staff',()=>f.db.query('SELECT * FROM origen_topic_notes'))).rows,[]);
  for(const fn of ['origen_coordinator_visible_binders(uuid)','origen_binder_eligible_entries(uuid,text)'])assert.equal((await f.owner.query("SELECT has_function_privilege($1,$2,'EXECUTE') allowed",[f.role,`${f.schema}.${fn}`])).rows[0].allowed,false);
 });
 await t.test('review receipts are explicit and version-bound; help is student-set and resets on publication',async()=>{
  assert.equal((await staff('list')).counts.new,1);await staff('read',{grantId:a.grant});assert.equal((await staff('list')).counts.new,1);
  await assert.rejects(staff('review',{grantId:a.grant,publicationId:randomUUID()}),{status:409});
  await staff('review',{grantId:a.grant,publicationId:a.publication});await staff('review',{grantId:a.grant,publicationId:a.publication});assert.equal((await staff('list',{view:'new'})).binders.length,0);
  assert.equal((await staff('list')).counts.help,0);await share('alex','help',{grantId:a.grant,requested:true});assert.equal((await staff('list',{view:'help'})).binders.length,1);assert.equal((await share('alex','status')).grants[0].helpRequested,true);
  await assert.rejects(f.as('staff',()=>runSharingCommand(f.db,{action:'help',studentId:'alex',grantId:a.grant,requested:true,enabled:true})),{status:403});
  await f.as('other',()=>runSharingCommand(f.db,{action:'help',studentId:'alex',grantId:a.grant,requested:false,enabled:false}));assert.equal((await staff('list')).counts.help,0);
  await share('alex','help',{grantId:a.grant,requested:true});await a.publish();assert.equal((await staff('list')).counts.help,0);assert.equal((await staff('list')).counts.new,1);
  await assert.rejects(staff('review',{grantId:a.grant,publicationId:a.publication}),{status:409});
 });
 await t.test('pagination and search use the same authorized set and reject unavailable cursors',async()=>{
  const others=[];for(let i=0;i<11;i++)others.push(await seed(`pupil-${i}`));
  const first=await staff('list');assert.equal(first.binders.length,10);assert.equal(first.counts.all,12);assert.ok(first.nextCursor);
  const second=await staff('list',{cursor:first.nextCursor});assert.equal(second.binders.length,2);assert.equal(second.nextCursor,null);assert.equal(new Set([...first.binders,...second.binders].map(x=>x.id)).size,12);
  const search=await staff('list',{search:'pupil-1'});assert.equal(search.counts.all,2);assert.equal(search.binders.length,2);
  await assert.rejects(staff('list',{cursor:first.nextCursor,search:'nobody'}),{status:404});
  for(const row of others)await share(row.student,'revoke-all');assert.equal((await staff('list')).counts.all,1);
 });
 await t.test('edited and withdrawn sources disappear; no old snapshot text or private summary survives',async()=>{
  await f.note({action:'update',studentId:'alex',id:a.note,version:1,note:{topic:'options',kind:'note',content:'Revised private until republished.',language:'en'}},'other');
  let detail=await staff('read',{grantId:a.grant});assert.deepEqual(detail.entries,[]);assert.ok(!JSON.stringify(detail).includes('Revised private'));
  await a.publish();detail=await staff('read',{grantId:a.grant});assert.equal(detail.entries[0].content,'Revised private until republished.');
  await share('alex','withdraw',{grantId:a.grant,itemId:detail.entries[0].id});assert.deepEqual((await staff('read',{grantId:a.grant})).entries,[]);await a.publish();
 });
 await t.test('revocation orders with an active read and blocks every subsequent read/search/count',async()=>{
  const client=await f.as('staff',()=>runAsCoordinatorActor('staff',{},()=>f.db.connect()));
  try{await client.query('BEGIN');await runCoordinatorBinderCommand(client,{action:'read',organizationId:org,grantId:a.grant});let done=false;const revoke=share('alex','revoke-all').then(()=>done=true);await new Promise(r=>setTimeout(r,40));assert.equal(done,false);await client.query('COMMIT');await revoke;}finally{await client.query('ROLLBACK').catch(()=>{});client.release();}
  await assert.rejects(staff('read',{grantId:a.grant}),{status:404});assert.equal((await staff('list')).counts.all,0);await assert.rejects(staff('list',{cursor:a.grant}),{status:404});
  await a.publish();const student=await f.as('other',()=>f.db.connect());
  try{await student.query('BEGIN');await runSharingCommand(student,{action:'revoke-all',studentId:'alex',enabled:true});const read=assert.rejects(staff('read',{grantId:a.grant}),{status:404});await student.query('COMMIT');await read;}finally{await student.query('ROLLBACK').catch(()=>{});student.release();}
  await a.publish();
 });
 await t.test('expiry and lost eligibility remove metadata too; reauthorization never revives revoked grants',async()=>{
  await f.owner.query("UPDATE origen_binder_share_grants SET created_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE id=$1",[a.grant]);await assert.rejects(staff('read',{grantId:a.grant}),{status:404});assert.equal((await staff('list')).counts.all,0);await a.publish();
  await f.owner.query("UPDATE origen_eligibility SET revision=revision+1 WHERE subject_hash=$1",[hash('other')]);await assert.rejects(staff('read',{grantId:a.grant}),{status:404});assert.equal((await staff('list')).counts.all,0);
  await provision('reviewer','suspend-organization',{},true);await assert.rejects(staff('list'),{status:403});await provision('reviewer','approve-organization',{},true);await provision('owner','enable-member',{subject:'staff'});assert.equal((await staff('list')).counts.all,0);
 });
 await t.test('HTTP rechecks staff MFA/email, fails closed while paused, and never trusts body identity',async()=>{
  const now=Math.floor(Date.now()/1000);let identity={sub:'staff',iat:now,[MFA_TIME_CLAIM]:now,[AUTH_TIME_CLAIM]:now},verified=true;
  const config={...env,AUTH0_DOMAIN:'synthetic.auth0.com'},handler=createCoordinatorBindersHandler(f.db,config,async()=>({ok:true,json:async()=>({sub:identity.sub,email:'synthetic@example.test',email_verified:verified})}));
  const server=createServer((req,res)=>{req.origenIdentity=identity;req.origenAuthorized=true;void runAsAccount(identity,()=>handler(req,res,()=>{res.writeHead(404);res.end();}));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{const send=body=>fetch(`http://127.0.0.1:${server.address().port}/api/coordinator-binders`,{method:'POST',headers:{Authorization:'Bearer synthetic','Content-Type':'application/json'},body:JSON.stringify({action:'list',organizationId:org,...body})});
   let response=await send({});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
   delete identity[MFA_TIME_CLAIM];assert.equal((await(await send({mfa:true})).json()).error,'staff_mfa_required');identity[MFA_TIME_CLAIM]=now;
   verified=false;assert.equal((await send({verified:true})).status,403);verified=true;
   identity[AUTH_TIME_CLAIM]=now-43201;assert.equal((await(await send({})).json()).error,'reauthentication_required');identity[AUTH_TIME_CLAIM]=now;
   config.ORIGEN_COORDINATOR_BINDER_VIEWING='false';assert.equal((await send({enabled:true})).status,503);
  }finally{await new Promise(r=>server.close(r));}
 });
});
