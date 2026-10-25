import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {retrievalFixture} from './history-retrieval-fixture.mjs';
import {runAsAccount,runAsCoordinatorActor} from './account-isolation.mjs';
import {runCoordinatorCommand} from './coordinator-access.mjs';
import {runConnectionCommand,validateConnectionInput} from './coordinator-connections.mjs';
import {runSharingCommand,validateSharingInput,createBinderSharingHandler,assertBinderSharingReady,binderSharingEnabled} from './binder-sharing.mjs';
import {createApp} from './index.mjs';
import {createLifecycleRepository} from './account-lifecycle.mjs';
import {createCorrectionService,correctionSnapshot} from './binder-corrections.mjs';
const hash=v=>createHash('sha256').update(v).digest('hex');
const env={ORIGEN_COORDINATOR_ACCOUNTS:'true',ORIGEN_COORDINATOR_LINKING:'true',ORIGEN_BINDER_SHARING:'true'};
test('publication arguments cannot supply contents, ownership, provenance or a feature flag',()=>{
 const value=validateSharingInput({action:'preview',studentId:'alex',connectionId:randomUUID(),entryIds:[randomUUID()],topics:['options'],enabled:true,accountId:'forged',content:'PRIVATE_FAMILY_SENTINEL',classification:'student_only'});
 assert.deepEqual(Object.keys(value).sort(),['action','connectionId','entryIds','studentId','topics']);
 for(const extra of [{topics:['family']},{entryIds:[]},{entryIds:Array.from({length:51},()=>randomUUID())}])assert.throws(()=>validateSharingInput({...value,...extra}),{status:400});
 assert.throws(()=>validateSharingInput({action:'publish',studentId:'alex',previewId:randomUUID(),confirmed:'true'}),{status:400});
 assert.equal(binderSharingEnabled(env),true);assert.equal(binderSharingEnabled({ORIGEN_BINDER_SHARING:'true'}),false);
});
test('student publication is versioned, explicit, isolated and revocable',{skip:!process.env.DATABASE_TEST_URL},async t=>{
 const f=await retrievalFixture();t.after(()=>f.close());await assertBinderSharingReady(f.runtime,env);
 const account=(await f.owner.query("SELECT id FROM origen_accounts WHERE auth0_subject='other'")).rows[0].id;
 const legacy=randomUUID(),privateNote=randomUUID();
 const create=(id,content,topic='options',studentId='alex',sub='other')=>f.note({action:'create',studentId,id,note:{topic,kind:'note',content,language:'en'}},sub);
 await create(legacy,'Legacy private note');
 await f.owner.query("INSERT INTO origen_eligibility(subject_hash,age_band,audience,status,notice_version) VALUES($1,'18plus','grade9plus','adult','synthetic')",[hash('other')]);
 await f.owner.query("INSERT INTO origen_coordinator_student_pilots(account_id,student_id,permission_revision,approved_by) VALUES($1,'alex',1,'synthetic-reviewer')",[account]);
 const org=randomUUID();
 for(const sub of ['owner','staff','reviewer'])await f.owner.query('INSERT INTO origen_institution_representatives(auth0_subject,first_name,work_email,job_role) VALUES($1,$1,$2,$3)',[sub,`${sub}@example.test`,'Synthetic']);
 await f.owner.query("INSERT INTO origen_institutions(id,slug,draft,verification_status) VALUES($1,$2,$3,'verified')",[org,org,{name:'Community Pilot'}]);
 for(const [sub,role] of [['owner','owner'],['staff','outreach']])await f.owner.query('INSERT INTO origen_institution_members VALUES($1,$2,$3)',[org,sub,role]);
 const provision=(sub,action,extra={},admin=false)=>f.as(sub,()=>runAsCoordinatorActor(sub,{administrator:admin},()=>runCoordinatorCommand(f.db,{action,id:org,...extra})));
 await provision('reviewer','approve-organization',{},true);await provision('owner','enable-member',{subject:'staff'});
 const connect=async()=>{
  const code=(await provision('staff','rotate-code')).code;
  const run=(action,extra={})=>f.as('other',()=>runConnectionCommand(f.db,{...validateConnectionInput({action,...extra}),networkHash:hash('synthetic')}));
  const ctx={...await run('open',{studentId:'alex',channel:'screen'}),sequence:0};
  const found=await run('lookup',{...ctx,code});await run('prepare',{...ctx,challengeId:found.challengeId});
  const c=await run('confirm',{...ctx,challengeId:found.challengeId,topics:['options','costs'],confirmed:true});
  await f.as('staff',()=>runAsCoordinatorActor('staff',{},()=>runConnectionCommand(f.db,{action:'accept',organizationId:org,connectionId:c.connectionId})));
  return c.connectionId;
 };
 let connection=await connect();
 const run=(action,extra={},sub='other',enabled=true)=>f.as(sub,()=>runSharingCommand(f.db,{...validateSharingInput({action,studentId:'alex',...extra}),enabled}));
 const preview=(entryIds,topics=['options'])=>run('preview',{entryIds,topics,connectionId:connection});
 const publish=card=>run('publish',{previewId:card.previewId,confirmed:true});
 const one=randomUUID(),two=randomUUID();await create(one,'Compare campus visits.');await create(two,'Ask about the aid deadline.','costs');
 const edit=(id,version,content)=>f.note({action:'update',id,version,studentId:'alex',note:{topic:'options',kind:'note',content,language:'en'}},'other');
 let grant;
 await t.test('only new student-authored notes qualify; family, legacy, parent and derived text never enter previews',async()=>{
  await create(privateNote,'PRIVATE_FAMILY_SENTINEL','options',null);
  await create(randomUUID(),'PRIVATE_PARENT_SENTINEL','options','alex','reader');
  await f.save('private-family-summary','PRIVATE_DERIVED_SENTINEL',{studentId:null,sub:'other'});
  const derived=randomUUID();await f.owner.query("INSERT INTO origen_topic_notes(account_id,id,student_id,topic,kind,content,language,status,origin,source_summary_id) VALUES($1,$2,'alex','options','note','PRIVATE_DERIVED_SENTINEL','en','saved','conversation','private-family-summary')",[account,derived]);
  await edit(legacy,1,'Legacy edited is still private.');await edit(derived,1,'PRIVATE_DERIVED_SENTINEL edited');
  const list=await run('entries');assert.deepEqual(new Set(list.entries.map(e=>e.id)),new Set([one,two]));assert.ok(!JSON.stringify(list).includes('PRIVATE_'));
  for(const id of [privateNote,legacy,derived,randomUUID()])await assert.rejects(preview([id]),{status:409,message:'sharing_changed'});
  const card=await preview([one]);assert.deepEqual(card.entries,[{id:one,topic:'options',kind:'note',language:'en',content:'Compare campus visits.'}]);
  const stored=(await f.owner.query('SELECT * FROM origen_binder_previews')).rows;assert.ok(!JSON.stringify(stored).includes('PRIVATE_'));
  assert.ok(!JSON.stringify(stored).includes(hash('PRIVATE_FAMILY_SENTINEL')));
  assert.ok(Math.abs(Date.parse(card.shareExpiresAt)-Date.now()-90*86400000)<10000);
  await assert.rejects(run('entries',{},'reader'),{status:403});await assert.rejects(run('entries',{},'staff'),{status:403});
  await assert.rejects(run('preview',{entryIds:[one],topics:['options'],connectionId:randomUUID()}),{status:403});
  await assert.rejects(f.as('other',()=>runSharingCommand(f.db,{action:'publish',studentId:'alex',previewId:card.previewId,enabled:true})),{status:403});
 });
 await t.test('concurrent confirmation publishes one exact snapshot and never exposes direct table reads',async()=>{
  const card=await preview([one,two],['options','costs']);const results=await Promise.all([publish(card),publish(card)]);assert.equal(results[0].publicationId,results[1].publicationId);
  const state=await run('status');grant=state.grants[0].id;assert.equal(state.grants[0].items.length,2);
  assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_binder_publications')).rows[0].n,1);
  for(const table of ['origen_binder_share_grants','origen_binder_publications','origen_binder_publication_items','origen_binder_previews'])await assert.rejects(f.as('staff',()=>f.db.query(`SELECT * FROM ${table}`)),{code:'42501'});
  assert.equal((await f.as('staff',()=>f.db.query('SELECT * FROM origen_topic_notes'))).rows.length,0);
 });
 await t.test('editing and translating invalidate old text and reject stale previews; updates require another confirmation',async()=>{
  const card=await preview([one]);await edit(one,1,'Revised campus visit question.');await assert.rejects(publish(card),{status:409});
  assert.ok(!(await run('status')).grants[0].items.some(e=>e.content.includes('campus')));
  await publish(await preview([one]));let state=await run('status');assert.equal(state.grants[0].items.length,1);assert.equal(state.grants[0].items[0].content,'Revised campus visit question.');
  const translationCard=await preview([one]);await f.owner.query("UPDATE origen_topic_notes SET translations=$3 WHERE account_id=$1 AND id=$2",[account,one,{es:'Pregunta revisada.'}]);
  await assert.rejects(publish(translationCard),{status:409});assert.equal((await run('status')).grants[0].items.length,0);
  // An owner-side edit has no authenticated provenance, so it also removes eligibility.
  assert.ok(!(await run('entries')).entries.some(e=>e.id===one));
 });
 await t.test('item withdrawal and topic removal invalidate prepared updates and wipe snapshot text',async()=>{
  const three=randomUUID();await create(three,'A fresh question.');await publish(await preview([three,two],['options','costs']));
  const card=await preview([three,two],['options','costs']);const state=await run('status'),item=state.grants[0].items.find(i=>i.topic==='options');
  await run('withdraw',{grantId:grant,itemId:item.id});await assert.rejects(publish(card),{status:409});
  assert.equal((await run('status')).grants[0].items.length,1);
  await run('remove-topic',{grantId:grant,topic:'costs'});assert.equal((await run('status')).grants[0].items.length,0);
  assert.equal((await f.owner.query('SELECT content FROM origen_binder_publication_items WHERE id=$1',[item.id])).rows[0].content,'');
 });
 await t.test('source deletion, protected lineage and late ancestry invalidate copies synchronously',async()=>{
  for(const operation of ['delete','protect','edge']){
   const id=randomUUID();await create(id,'A removable note.');await publish(await preview([id]));const card=await preview([id]);
   if(operation==='delete')await f.note({action:'delete',id,version:1,studentId:'alex'},'other');
   else if(operation==='protect')await f.owner.query("UPDATE origen_binder_source_lineage SET classification='family',complete=false,revision=revision+1 WHERE account_id=$1 AND source_id=$2",[account,id]);
   else await f.owner.query("INSERT INTO origen_binder_source_edges SELECT $1,a.id,b.id FROM origen_binder_source_lineage a,origen_binder_source_lineage b WHERE a.account_id=$1 AND b.account_id=$1 AND a.source_id=$2 AND b.source_id=$3",[account,id,privateNote]);
   await assert.rejects(publish(card),{status:409});assert.equal((await run('status')).grants[0].items.length,0);
  }
 });
 await t.test('revocation is ordered with publication and no later read or duplicate confirmation restores content',async()=>{
  const id=randomUUID();await create(id,'Revocation race note.');const card=await preview([id]);
  const race=await Promise.allSettled([publish(card),run('revoke-all')]);assert.equal(race[1].status,'fulfilled');
  assert.equal((await run('status')).grants[0].status,'revoked');assert.equal((await run('status')).grants[0].items.length,0);await assert.rejects(publish(card),{status:409});
  assert.equal((await f.owner.query("SELECT count(*)::int n FROM origen_binder_publication_items WHERE content<>''")).rows[0].n,0);
  // A new review can explicitly restore sharing on a still-accepted connection.
  await publish(await preview([id]));const stale=await preview([id]);
  await f.as('other',()=>runConnectionCommand(f.db,{action:'withdraw',studentId:'alex',connectionId:connection}));
  await assert.rejects(publish(stale),{status:409});connection=await connect();assert.equal((await run('status')).grants[0].status,'revoked');
 });
 await t.test('held publish and revoke transactions enforce both ordering directions',async()=>{
  const id=randomUUID();await create(id,'Ordered transaction note.');
  let card=await preview([id]);
  const client=await f.as('other',()=>f.db.connect());
  try{
   await client.query('BEGIN');await runSharingCommand(client,{action:'publish',studentId:'alex',previewId:card.previewId,confirmed:true,enabled:true});
   let finished=false;const revoke=run('revoke-all').then(r=>{finished=true;return r;});
   await new Promise(r=>setTimeout(r,40));assert.equal(finished,false,'revocation waits for the authorized publication');
   await client.query('COMMIT');await revoke;assert.ok((await run('status')).grants.every(g=>g.items.length===0));
   card=await preview([id]);await client.query('BEGIN');await runSharingCommand(client,{action:'revoke-all',studentId:'alex',enabled:false});
   const blocked=assert.rejects(publish(card),{status:409});await client.query('COMMIT');await blocked;
  }finally{await client.query('ROLLBACK').catch(()=>{});client.release();}
 });
 await t.test('organization suspension wipes publications and restoring staff does not restore access',async()=>{
  const id=randomUUID();await create(id,'Organization test.');await publish(await preview([id]));const card=await preview([id]);
  await provision('reviewer','suspend-organization',{},true);await assert.rejects(publish(card),{status:409});
  assert.ok((await run('status')).grants.every(g=>g.items.length===0));
  assert.equal((await f.owner.query("SELECT count(*)::int n FROM origen_binder_publication_items WHERE content<>''")).rows[0].n,0);
  await provision('reviewer','approve-organization',{revision:(await f.owner.query('SELECT revision FROM origen_coordinator_organizations WHERE institution_id=$1',[org])).rows[0].revision},true);await provision('owner','enable-member',{subject:'staff'});
  assert.ok((await run('status')).grants.every(g=>g.status!=='active'));connection=await connect();
 });
 await t.test('undo after a correction and revoked sharing restores only a private note',async()=>{
  const id=randomUUID();await create(id,'Original private restoration example.');await publish(await preview([id]));
  const old=(await f.note({action:'load',studentId:'alex'},'other')).notes.find(n=>n.id===id);
  const change=input=>f.as('other',()=>createCorrectionService(f.db,{ORIGEN_BINDER_CORRECTIONS:'true'})('other',input));
  const result=await change({operationId:randomUUID(),action:'update',store:'note',studentId:'alex',id,version:1,before:correctionSnapshot(old,'note'),value:{topic:'options',kind:'note',content:'Revised private restoration example.',language:'en'}});
  assert.ok((await run('status')).grants.every(g=>g.items.length===0));
  await run('revoke-all');
  await change({operationId:randomUUID(),action:'undo',store:'note',studentId:'alex',id,version:result.version,before:result.undo.before,undoOf:result.undo.operationId});
  assert.equal((await f.note({action:'load',studentId:'alex'},'other')).notes.find(n=>n.id===id).content,old.content);
  assert.ok((await run('status')).grants.every(g=>g.status!=='active'&&g.items.length===0));
  assert.equal((await f.owner.query("SELECT count(*)::int n FROM origen_binder_publication_items WHERE content<>''")).rows[0].n,0);
 });
 await t.test('expiry, recipient identity changes and permission withdrawal fail closed',async()=>{
  const id=randomUUID();await create(id,'Permission test.');let card=await preview([id]);
  await f.owner.query("UPDATE origen_binder_previews SET expires_at=now()-interval '1 second' WHERE id=$1",[card.previewId]);await assert.rejects(publish(card),{status:409});
  card=await preview([id]);await provision('staff','save-profile',{displayName:'New name'});await assert.rejects(publish(card),{status:409});
  await publish(await preview([id]));let state=await run('status');const current=state.grants.find(g=>g.status==='active');
  await f.owner.query("UPDATE origen_binder_share_grants SET created_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE id=$1",[current.id]);assert.equal((await run('status')).grants.find(g=>g.id===current.id).items.length,0);
  await publish(await preview([id]));card=await preview([id]);
  await f.owner.query("UPDATE origen_eligibility SET status='revoked',revision=revision+1 WHERE subject_hash=$1",[hash('other')]);await assert.rejects(publish(card),{status:403});assert.equal((await run('status')).enabled,false);
  assert.ok((await run('status')).grants.every(g=>g.items.length===0));await run('revoke-all',{},'other',false);
 });
 await t.test('HTTP kill switch preserves stop controls, rejects forged enable flags, and never logs content',async()=>{
  const handler=createBinderSharingHandler(f.db,{});const server=createServer((req,res)=>{req.origenIdentity={sub:'other'};req.origenAuthorized=true;void runAsAccount(req.origenIdentity,()=>handler(req,res,()=>{res.writeHead(404);res.end();}));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{
   const post=body=>fetch(`http://127.0.0.1:${server.address().port}/api/binder-sharing`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({studentId:'alex',...body})});
   assert.equal((await post({action:'entries',enabled:true})).status,503);const response=await post({action:'revoke-all'});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
   const state=await(await post({action:'status'})).json();assert.ok(state.grants.every(g=>g.items.length===0));
  }finally{await new Promise(r=>server.close(r));}
  const logs=[],app=createApp(env,async()=>({sub:'other'}),f.db,line=>logs.push(line));const gateway=createServer(app);await new Promise(r=>gateway.listen(0,'127.0.0.1',r));
  try{for(const endpoint of ['coordinator-binders','coordinator-feedback','coordinator-notifications']){const res=await fetch(`http://127.0.0.1:${gateway.address().port}/api/${endpoint}`,{method:'POST',headers:{Authorization:'Bearer synthetic','Content-Type':'application/json'},body:JSON.stringify({content:'PRIVATE_FAMILY_SENTINEL'})});assert.equal(res.status,['coordinator-feedback','coordinator-notifications'].includes(endpoint)?400:503);}
   const res=await fetch(`http://127.0.0.1:${gateway.address().port}/api/binder-sharing`,{method:'POST',headers:{Authorization:'Bearer synthetic','Content-Type':'application/json'},body:JSON.stringify({action:'revoke-all',studentId:'alex',content:'PRIVATE_FAMILY_SENTINEL'})});assert.equal(res.status,200);
  }finally{await new Promise(r=>gateway.close(r));await app.flushLogs();}assert.ok(!JSON.stringify(logs).includes('PRIVATE_FAMILY_SENTINEL'));
 });
 await t.test('account deletion removes previews and all published copies',async()=>{
  await f.owner.query("UPDATE origen_eligibility SET status='adult' WHERE subject_hash=$1",[hash('other')]);
  connection=await connect();const id=randomUUID();await create(id,'Account deletion test.');await publish(await preview([id]));await preview([id]);
  await f.as('other',()=>createLifecycleRepository(f.db)('other',{action:'delete',confirmation:'DELETE'}));
  for(const table of ['origen_binder_previews','origen_binder_share_grants','origen_binder_publications','origen_binder_publication_items'])assert.equal((await f.owner.query(`SELECT count(*)::int n FROM ${table} WHERE account_id=$1`,[account])).rows[0].n,0,table);
  await assert.rejects(run('status'),{status:403});
 });
});
