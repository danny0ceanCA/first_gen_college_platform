import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {retrievalFixture} from './history-retrieval-fixture.mjs';
import {runAsCoordinatorActor} from './account-isolation.mjs';
import {runCoordinatorCommand} from './coordinator-access.mjs';
import {runConnectionCommand,validateConnectionInput} from './coordinator-connections.mjs';
import {runSharingCommand,validateSharingInput,derivedSharingEnabled,assertBinderSharingReady} from './binder-sharing.mjs';
import {runCoordinatorBinderCommand,validateCoordinatorBinderInput} from './coordinator-binders.mjs';
import {createOrganizationService} from './binder-organization.mjs';
import {coordinatorConfigurationIssues} from './binder-sharing-policy.mjs';
const hash=v=>createHash('sha256').update(v).digest('hex');
const env={ORIGEN_COORDINATOR_ACCOUNTS:'true',ORIGEN_COORDINATOR_LINKING:'true',ORIGEN_BINDER_SHARING:'true',ORIGEN_DERIVED_BINDER_SHARING:'true',ORIGEN_BINDER_ORGANIZATION:'true',ORIGEN_BINDER_JOBS:'true',ORIGEN_PERSONALIZATION_MODE:'on',ORIGEN_PERSONALIZATION_EXTRACTION:'true',OPENAI_API_KEY:'synthetic'};

test('derived sharing is off by default and request bodies cannot enable it or supply provenance',()=>{
 assert.equal(derivedSharingEnabled({...env,ORIGEN_DERIVED_BINDER_SHARING:undefined}),false);
 assert.equal(derivedSharingEnabled(env),true);
 assert.equal(derivedSharingEnabled({...env,ORIGEN_BINDER_SHARING:'false'}),false);
 assert.ok(coordinatorConfigurationIssues({ORIGEN_DERIVED_BINDER_SHARING:'true'}).length);
 assert.ok(coordinatorConfigurationIssues({ORIGEN_DERIVED_BINDER_SHARING:'yes'}).length);
 assert.deepEqual(validateSharingInput({action:'entries',studentId:'alex',derivedEnabled:true,source:'student'}),{action:'entries',studentId:'alex'});
 assert.equal(validateCoordinatorBinderInput({action:'list',organizationId:randomUUID(),derivedEnabled:true}).derivedEnabled,undefined);
});

export async function derivedSharingFixture(){
 const f=await retrievalFixture();
 try{
 const account=(await f.owner.query("SELECT id FROM origen_accounts WHERE auth0_subject='other'")).rows[0].id,org=randomUUID();
 await f.owner.query("INSERT INTO origen_eligibility(subject_hash,age_band,audience,status,notice_version) VALUES($1,'18plus','grade9plus','adult','synthetic')",[hash('other')]);
 await f.owner.query("INSERT INTO origen_coordinator_student_pilots(account_id,student_id,permission_revision,approved_by) VALUES($1,'alex',1,'synthetic')",[account]);
 for(const sub of ['owner','staff','reviewer'])await f.owner.query('INSERT INTO origen_institution_representatives(auth0_subject,first_name,work_email,job_role) VALUES($1,$1,$2,$3)',[sub,`${sub}@example.test`,'Synthetic']);
 await f.owner.query("INSERT INTO origen_institutions(id,slug,draft,verification_status) VALUES($1,$2,$3,'verified')",[org,org,{name:'Community Pilot'}]);
 for(const [sub,role] of [['owner','owner'],['staff','outreach']])await f.owner.query('INSERT INTO origen_institution_members VALUES($1,$2,$3)',[org,sub,role]);
 const provision=(sub,action,extra={},admin=false)=>f.as(sub,()=>runAsCoordinatorActor(sub,{administrator:admin},()=>runCoordinatorCommand(f.db,{action,id:org,...extra})));
 await provision('reviewer','approve-organization',{},true);await provision('owner','enable-member',{subject:'staff'});
 const code=(await provision('staff','rotate-code')).code;
 const connect=(action,extra={})=>f.as('other',()=>runConnectionCommand(f.db,{...validateConnectionInput({action,...extra}),networkHash:hash('synthetic')}));
 const ctx={...await connect('open',{studentId:'alex',channel:'screen'}),sequence:0};
 const found=await connect('lookup',{...ctx,code});await connect('prepare',{...ctx,challengeId:found.challengeId});
 const connection=(await connect('confirm',{...ctx,challengeId:found.challengeId,topics:['options','costs'],confirmed:true})).connectionId;
 await f.as('staff',()=>runAsCoordinatorActor('staff',{},()=>runConnectionCommand(f.db,{action:'accept',organizationId:org,connectionId:connection})));
 const run=(action,extra={},derivedEnabled=true,sub='other')=>f.as(sub,()=>runSharingCommand(f.db,{...validateSharingInput({action,studentId:'alex',...extra}),enabled:true,derivedEnabled}));
 const preview=(entryIds,topics=['options','costs'])=>run('preview',{entryIds,topics,connectionId:connection});
 const publish=card=>run('publish',{previewId:card.previewId,confirmed:true});
 const read=(grantId,derivedEnabled=true)=>f.as('staff',()=>runAsCoordinatorActor('staff',{},()=>runCoordinatorBinderCommand(f.db,{action:'read',organizationId:org,grantId,derivedEnabled})));
 const organize=async(items,{sub='other',studentId='alex',summary=items.map(i=>i.quote).join(' '),id=randomUUID()}={})=>{
  await f.save(id,summary,{sub,studentId});
  await f.as(sub,()=>createOrganizationService(f.db,env,async()=>new Response(JSON.stringify({output:[{content:[{type:'output_text',text:JSON.stringify({items})}]}]})))(sub,{studentId,summaryId:id}));
  return id;
 };
 return {...f,account,org,connection,run,preview,publish,read,organize};
 }catch(e){await f.close();throw e;}
}
const goal=(quote='Maybe nursing would be a good fit.',language='en')=>({topic:'options',category:'goal',certainty:'tentative',language,quote});
const question=(quote='I still need help comparing college costs.',language='en')=>({topic:'costs',category:'question',certainty:'unresolved',language,quote});

test('derived snapshots preserve student choice, provenance, uncertainty and privacy',{skip:!process.env.DATABASE_TEST_URL},async t=>{
 const f=await derivedSharingFixture();t.after(()=>f.close());await assertBinderSharingReady(f.runtime,env);
 let ids,source,grant;
 await t.test('organization alone shares nothing; preview equals exact published coordinator content',async()=>{
  source=await f.organize([goal(),question()]);
  assert.equal((await f.run('status')).grants.length,0);
  assert.equal((await f.run('entries',{},false)).entries.length,0);
  const entries=(await f.run('entries')).entries;assert.equal(entries.length,2);ids=entries.map(e=>e.id);
  assert.ok(entries.find(e=>e.topic==='options').content.includes('Tentative, not a decision: Maybe nursing'));
  assert.ok(entries.every(e=>e.content.includes('not a verbatim quote')));
  const card=await f.preview(ids),both=await Promise.all([f.publish(card),f.publish(card)]);assert.equal(both[0].publicationId,both[1].publicationId);
  const state=await f.run('status');grant=state.grants[0].id;
  const shared=(await f.read(grant)).entries;assert.deepEqual(shared.map(e=>e.content).sort(),card.entries.map(e=>e.content).sort());
  assert.ok(!JSON.stringify(shared).includes(source));assert.equal((await f.read(grant,false)).entries.length,0);
  assert.equal((await f.run('status',{},false)).grants[0].items.length,0);
  await assert.rejects(f.run('entries',{},true,'reader'),{status:403});
 });
 await t.test('editing a memory withdraws its copy and rejects a prepared preview',async()=>{
  const card=await f.preview(ids),item=(await f.owner.query("SELECT * FROM origen_student_memories WHERE account_id=$1 AND source_summary_id=$2 AND status='proposed'",[f.account,source])).rows[0];
  await f.memory({action:'update',id:item.id,version:item.version,studentId:'alex',memory:{content:'I am considering engineering instead.',category:'goal',speaker:'student',language:'en'}},'other');
  await assert.rejects(f.publish(card),{status:409});assert.ok(!(await f.read(grant)).entries.some(e=>e.content.includes('nursing')));
 });
 await t.test('sensitive whole sources, family and parent sources are excluded despite a harmless selected sentence',async()=>{
  for(const [summary,options] of [
   ['I want help with campus options. My mother prefers a nearby school.',{}],
   ['I need a campus visit. My diagnosis is private.',{}],
   ['Quiero comparar universidades. Mi padre necesita ayuda.',{language:'es'}],
   ['Quiero visitar el campus. Mi situación de inmigración es privada.',{language:'es'}],
   ['I need more college options.',{studentId:null}],
   ['I need more campus options.',{sub:'reader'}]
  ]){
   const quote=summary.slice(0,summary.indexOf('.')+1),sid=await f.organize([{topic:'options',category:'question',certainty:'unresolved',language:options.language||'en',quote}],{summary,...options});
   const candidates=(await f.owner.query('SELECT id FROM origen_topic_notes WHERE source_summary_id=$1',[sid])).rows;
   for(const {id} of candidates)await assert.rejects(f.preview([id]),{status:409});
  }
 });
 await t.test('Spanish provenance is shown and deleting its source removes all shared copies',async()=>{
  const sid=await f.organize([goal('Tal vez estudiar enfermería sería una buena opción.','es'),question('Necesito ayuda para comparar los costos de estudiar.','es')]);
  const entries=(await f.run('entries')).entries.filter(e=>e.language==='es');assert.equal(entries.length,2);
  const card=await f.preview(entries.map(e=>e.id));assert.ok(card.entries.some(e=>e.content.includes('Posibilidad, no una decisión')));await f.publish(card);
  await f.history({action:'delete',id:sid},'other');assert.equal((await f.read(grant)).entries.length,0);
  await assert.rejects(f.publish(card),{status:409});
 });
 await t.test('source edits and late protected ancestry invalidate both memory and topic snapshots',async()=>{
  for(const operation of ['edit','protect','suppress']){
   const sid=await f.organize([goal(`Maybe ${operation} planning would help me choose.`),question(`I need help with ${operation} college costs.`)]);
   const rows=(await f.owner.query("SELECT source_id FROM origen_binder_source_lineage WHERE account_id=$1 AND source_kind IN ('note','memory') AND id IN (SELECT derived_id FROM origen_binder_source_edges WHERE source_id=(SELECT id FROM origen_binder_source_lineage WHERE account_id=$1 AND source_kind='summary' AND source_id=$2))",[f.account,sid])).rows;
   const card=await f.preview(rows.map(r=>r.source_id));await f.publish(card);
   const pending=await f.preview(rows.map(r=>r.source_id));
   if(operation==='edit')await f.owner.query("UPDATE origen_conversation_summaries SET summary=summary||' Changed.' WHERE account_id=$1 AND id=$2",[f.account,sid]);
   if(operation==='protect')await f.owner.query("UPDATE origen_binder_source_lineage SET classification='family',revision=revision+1 WHERE account_id=$1 AND source_kind='summary' AND source_id=$2",[f.account,sid]);
   if(operation==='suppress')await f.owner.query('UPDATE origen_memory_batches SET suppressed=true WHERE account_id=$1 AND summary_id=$2',[f.account,sid]);
   assert.equal((await f.read(grant)).entries.length,0);await assert.rejects(f.publish(pending),{status:409});
  }
 });
 await t.test('revoke wins a publication race and a replay cannot restore access',async()=>{
  await f.organize([goal('Maybe studying design would be interesting.')]);
  const candidates=(await f.run('entries')).entries;assert.ok(candidates.length);const card=await f.preview([candidates[0].id]);
  const results=await Promise.allSettled([f.publish(card),f.run('revoke-all')]);assert.equal(results[1].status,'fulfilled');
  assert.ok((await f.run('status')).grants.every(g=>g.status==='revoked'&&g.items.length===0));
  await assert.rejects(f.publish(card),{status:409});await assert.rejects(f.read(grant),{status:404});
 });
});
