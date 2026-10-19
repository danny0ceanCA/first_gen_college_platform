import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readdir,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {retrievalFixture} from './history-retrieval-fixture.mjs';
import {coordinatorTables,lineageTables} from './binder-sharing-policy.mjs';
import {migrateDatabase} from './database.mjs';
import {grantRuntimeAccess} from './runtime-grants.mjs';
import {createTopicRepository} from './topic-notes.mjs';
import {createLifecycleRepository} from './account-lifecycle.mjs';
import {assertRuntimeIsolation} from './account-isolation.mjs';

const requiresPostgres={skip:!process.env.DATABASE_TEST_URL};
const note=(content='Compare campus visit dates.')=>({topic:'options',kind:'note',content,language:'en'});
async function newNote(f,sub='other',studentId='alex',content){
 const id=randomUUID();await f.note({action:'create',studentId,id,note:note(content)},sub);return id;
}
async function lineage(f,id,kind='note'){
 return (await f.owner.query('SELECT * FROM origen_binder_source_lineage WHERE source_kind=$1 AND source_id=$2',[kind,id])).rows[0];
}
async function sharingFixture(f){
 const account=(await f.owner.query("SELECT id FROM origen_accounts WHERE auth0_subject='other'")).rows[0].id;
 const org=randomUUID(),profile=randomUUID(),connection=randomUUID(),grant=randomUUID(),publication=randomUUID();
 await f.owner.query("INSERT INTO origen_institution_representatives(auth0_subject,first_name,work_email,job_role) VALUES('staff','Synthetic','staff@example.invalid','Coordinator')");
 await f.owner.query("INSERT INTO origen_institutions(id,slug,verification_status,draft) VALUES($1,'synthetic','verified','{}')",[org]);
 await f.owner.query("INSERT INTO origen_institution_members VALUES($1,'staff','outreach')",[org]);
 await f.owner.query("INSERT INTO origen_coordinator_profiles(id,institution_id,auth0_subject,display_name,status) VALUES($1,$2,'staff','Synthetic','active')",[profile,org]);
 await f.owner.query("INSERT INTO origen_binder_connections(id,account_id,student_id,coordinator_id,status,request_id,expires_at,accepted_at) VALUES($1,$2,'alex',$3,'accepted',$4,now()+interval '7 days',now())",[connection,account,profile,randomUUID()]);
 await f.owner.query("INSERT INTO origen_binder_share_grants(id,account_id,student_id,coordinator_id,connection_id,grantor_subject,topics,permission_revision,coordinator_revision,connection_revision,notice_version,expires_at) VALUES($1,$2,'alex',$3,$4,'other',ARRAY['options'],1,1,1,'test',now()+interval '1 day')",[grant,account,profile,connection]);
 await f.owner.query("INSERT INTO origen_binder_publications(id,account_id,student_id,grant_id,version,grant_revision,preview_digest,confirmation_id,confirmed_by,policy_version) VALUES($1,$2,'alex',$3,1,1,$4,$5,'other','test')",[publication,account,grant,'a'.repeat(64),randomUUID()]);
 await f.owner.query('UPDATE origen_binder_share_grants SET current_publication_id=$2 WHERE id=$1',[grant,publication]);
 return {account,org,profile,connection,grant,publication};
}
async function item(f,s,id){
 const l=await lineage(f,id),n=(await f.owner.query('SELECT * FROM origen_topic_notes WHERE account_id=$1 AND id=$2',[s.account,id])).rows[0];
 return f.owner.query('INSERT INTO origen_binder_publication_items(account_id,student_id,grant_id,publication_id,lineage_id,lineage_revision,source_version,source_digest,topic,kind,language,content) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id',[s.account,'alex',s.grant,s.publication,l.id,l.revision,l.source_version,l.source_digest,n.topic,n.kind,n.language,n.content]);
}

test('PostgreSQL sharing foundation protects private lineage, publications and legacy APIs',requiresPostgres,async t=>{
 const f=await retrievalFixture();t.after(()=>f.close());const s=await sharingFixture(f);
 await t.test('runtime cannot create grants or change provenance; all new tables use RLS',async()=>{
  for(const table of [...coordinatorTables,...lineageTables]){
   const record=(await f.owner.query('SELECT relrowsecurity FROM pg_class WHERE oid=$1::regclass',[`${f.schema}.${table}`])).rows[0];assert.equal(record.relrowsecurity,true,table);
  }
  for(const table of coordinatorTables)await assert.rejects(f.as('staff',()=>f.db.query(`SELECT * FROM ${table}`)),{code:'42501'});
  await assert.rejects(f.as('other',()=>f.db.query("UPDATE origen_binder_source_lineage SET classification='student_only',complete=true")),{code:'42501'});
  await assert.rejects(f.as('other',()=>f.db.query("DELETE FROM origen_binder_source_edges")),{code:'42501'});
  await assert.rejects(f.as('staff',()=>f.db.query("INSERT INTO origen_binder_share_grants DEFAULT VALUES")),{code:'42501'});
  // Prove the empty RLS policy set still denies every row if SELECT is
  // accidentally granted; startup separately refuses that misconfiguration.
  await f.owner.query(`GRANT SELECT ON origen_binder_share_grants TO ${f.role}`);
  assert.deepEqual((await f.as('staff',()=>f.db.query('SELECT * FROM origen_binder_share_grants'))).rows,[]);
  await assert.rejects(assertRuntimeIsolation(f.runtime,{schema:f.schema}),/restricted_database_runtime_required/);
  await grantRuntimeAccess(f.owner,f.role,{schema:f.schema});
  const functions=(await f.owner.query("SELECT p.proname,p.proconfig,has_function_privilege($1,p.oid,'EXECUTE') AS callable FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$2 AND p.proname LIKE 'origen_binder_%'",[f.role,f.schema])).rows;
  assert.ok(functions.length>=7);for(const fn of functions){assert.equal(fn.callable,['origen_binder_sharing_command','origen_binder_help_command'].includes(fn.proname),fn.proname);assert.ok(fn.proconfig.some(setting=>setting.includes(`search_path=${f.schema}, pg_temp`)),fn.proname);}
  await f.owner.query(`GRANT UPDATE ON origen_binder_source_lineage TO ${f.role}`);
  await assert.rejects(assertRuntimeIsolation(f.runtime,{schema:f.schema}),/restricted_database_runtime_required/);
  await grantRuntimeAccess(f.owner,f.role,{schema:f.schema});await assertRuntimeIsolation(f.runtime,{schema:f.schema});
 });
 await t.test('parent, family and unknown student notes stay protected through edits and translations',async()=>{
  const parent=await newNote(f,'reader','alex','PRIVATE_FAMILY_SENTINEL'),family=await newNote(f,'other',null,'PRIVATE_FAMILY_SENTINEL'),student=await newNote(f);
  assert.equal((await lineage(f,parent)).classification,'parent');assert.equal((await lineage(f,family)).classification,'family');assert.equal((await lineage(f,student)).classification,'unknown');
  await f.note({action:'update',studentId:'alex',id:parent,version:1,note:note('Edited family content')},'reader');
  await f.as('reader',()=>f.db.query('UPDATE origen_topic_notes SET translations=$2 WHERE id=$1',[parent,JSON.stringify({es:'PRIVATE_FAMILY_SENTINEL'})]));
  assert.equal((await lineage(f,parent)).classification,'parent');assert.equal((await lineage(f,parent)).complete,false);assert.ok((await lineage(f,parent)).revision>=3);
  await f.family('reader',{action:'save-account',account:{firstName:'Synthetic',email:'',role:'student'}});
  assert.equal((await lineage(f,parent)).classification,'parent','role switching cannot launder provenance');
  await assert.rejects(item(f,s,student),{code:'23514'});
  for(const table of ['origen_topic_notes','origen_conversation_summaries','origen_binder_source_lineage'])assert.deepEqual((await f.as('staff',()=>f.db.query(`SELECT * FROM ${table}`))).rows,[]);
  const own=await f.as('other',()=>f.db.query('SELECT * FROM origen_binder_source_lineage'));assert.ok(own.rows.length>0);assert.ok(own.rows.every(row=>row.account_id===s.account));
  const exported=await f.as('other',()=>createLifecycleRepository(f.db)('other',{action:'export'}));assert.ok(exported.binderSourceLineage.length>0);assert.ok(exported.binderSourceLineage.every(row=>row.account_id===s.account));
 });
 await t.test('extraction preserves source edges; changing context invalidates descendants',async()=>{
  await f.save('source','PRIVATE_FAMILY_SENTINEL a family college discussion.',{sub:'other'});
  const id=randomUUID();await f.as('other',()=>f.db.query("INSERT INTO origen_topic_notes(account_id,id,student_id,topic,kind,content,language,status,origin,source_summary_id) VALUES($1,$2,'alex','options','note','PRIVATE_FAMILY_SENTINEL','en','saved','conversation','source')",[s.account,id]));
  const root=await lineage(f,'source','summary'),child=await lineage(f,id);
  assert.equal((await f.owner.query('SELECT * FROM origen_binder_source_edges WHERE derived_id=$1',[child.id])).rows[0].source_id,root.id);
  await f.owner.query("UPDATE origen_binder_source_lineage SET classification='family',revision=revision+1 WHERE id=$1",[root.id]);
  assert.equal((await lineage(f,id)).classification,'family');await assert.rejects(item(f,s,id),{code:'23514'});
  const copied=await newNote(f);await f.owner.query('INSERT INTO origen_binder_source_edges VALUES($1,$2,$3)',[s.account,(await lineage(f,copied)).id,child.id]);assert.equal((await lineage(f,copied)).classification,'family');
  await f.note({action:'update',studentId:'alex',id:copied,version:1,note:note('Edited copy')},'other');assert.equal((await lineage(f,copied)).classification,'family');
  await f.as('other',()=>f.db.query("INSERT INTO origen_memory_batches(account_id,summary_id,source_version,suppressed) VALUES($1,'source','erased',true)",[s.account]));assert.equal((await lineage(f,'source','summary')).active,false);assert.equal((await lineage(f,id)).complete,false);
  await f.note({action:'update',studentId:'alex',id,version:1,note:note('Edited wording')},'other');assert.equal((await lineage(f,id)).classification,'family');
  await f.history({action:'delete',id:'source'},'other');assert.equal(await lineage(f,id),undefined);assert.equal(await lineage(f,'source','summary'),undefined);
  assert.equal((await lineage(f,copied)).classification,'family');assert.equal((await lineage(f,copied)).active,false);
 });
 await t.test('complete evidence is test-owner-only and source edits remove published text immediately',async()=>{
  const id=await newNote(f);await f.owner.query("UPDATE origen_binder_source_lineage SET classification='student_only',complete=true WHERE source_kind='note' AND source_id=$1",[id]);
  const publicationItem=(await item(f,s,id)).rows[0].id;
  // Shared content remains inaccessible even for the intended coordinator.
  await assert.rejects(f.as('staff',()=>f.db.query('SELECT content FROM origen_binder_publication_items WHERE id=$1',[publicationItem])),{code:'42501'});
  await f.note({action:'update',studentId:'alex',id,version:1,note:note('Private new edit')},'other');
  const invalid=(await f.owner.query('SELECT * FROM origen_binder_publication_items WHERE id=$1',[publicationItem])).rows[0];assert.equal(invalid.content,'');assert.ok(invalid.withdrawn_at);assert.equal((await lineage(f,id)).classification,'unknown');
  await f.note({action:'delete',studentId:'alex',id,version:2},'other');assert.equal((await f.owner.query('SELECT * FROM origen_binder_publication_items WHERE id=$1',[publicationItem])).rows.length,0);
 });
 await t.test('student scope, forged text and a protected ancestor cannot be published',async()=>{
  const id=await newNote(f);await f.owner.query("UPDATE origen_binder_source_lineage SET classification='student_only',complete=true WHERE source_kind='note' AND source_id=$1",[id]);
  const iid=(await item(f,s,id)).rows[0].id;
  await assert.rejects(f.owner.query("UPDATE origen_binder_publication_items SET content='FORGED PRIVATE CONTENT' WHERE id=$1",[iid]),{code:'23514'});
  await assert.rejects(f.owner.query("UPDATE origen_binder_publication_items SET student_id='sam' WHERE id=$1",[iid]),{code:'23514'});
  await f.save('unsafe-parent','PRIVATE_FAMILY_SENTINEL',{sub:'other'});const parent=await lineage(f,'unsafe-parent','summary'),child=await lineage(f,id);
  await f.owner.query('INSERT INTO origen_binder_source_edges VALUES($1,$2,$3)',[s.account,child.id,parent.id]);
  const invalid=(await f.owner.query('SELECT content,withdrawn_at FROM origen_binder_publication_items WHERE id=$1',[iid])).rows[0];assert.equal(invalid.content,'');assert.ok(invalid.withdrawn_at);
  await assert.rejects(f.owner.query("UPDATE origen_binder_publication_items SET content='Compare campus visit dates.',withdrawn_at=NULL WHERE id=$1",[iid]),{code:'23514'});
  await assert.rejects(f.owner.query('INSERT INTO origen_binder_source_edges VALUES($1,$2,$3)',[s.account,parent.id,child.id]),{code:'23514'});
 });
 await t.test('late mixed-session attribution protects notes without rewriting private source text',async()=>{
  const session=randomUUID(),segment=randomUUID(),config=randomUUID();
  await f.save('mixed','PRIVATE_FAMILY_SENTINEL',{sub:'other'});
  await f.owner.query("INSERT INTO origen_ai_configurations VALUES($1,'synthetic','test','hash','hash','test','test',now())",[config]);
  await f.owner.query("INSERT INTO origen_guidance_sessions(account_id,id,actor_role,initial_language) VALUES($1,$2,'student','en')",[s.account,session]);
  await f.owner.query("INSERT INTO origen_guidance_segments(account_id,session_id,id,ordinal,topic,target_kind,student_id,configuration_id) VALUES($1,$2,$3,0,'planning','student','alex',$4)",[s.account,session,segment,config]);
  await f.owner.query("INSERT INTO origen_summary_segments(account_id,summary_id,segment_id,language) VALUES($1,'mixed',$2,'en')",[s.account,segment]);
  assert.equal((await lineage(f,'mixed','summary')).classification,'unknown');
  await f.owner.query("INSERT INTO origen_guidance_segments(account_id,session_id,id,ordinal,topic,target_kind,configuration_id) VALUES($1,$2,$3,1,'planning','family',$4)",[s.account,session,randomUUID(),config]);
  assert.equal((await lineage(f,'mixed','summary')).classification,'mixed');
  const existing=(await f.owner.query("SELECT summary FROM origen_conversation_summaries WHERE account_id=$1 AND id='mixed'",[s.account])).rows[0];assert.equal(existing.summary,'PRIVATE_FAMILY_SENTINEL');
 });
 await t.test('account closure cascades new metadata without runtime sharing privileges',async()=>{
  await f.as('other',()=>createLifecycleRepository(f.db)('other',{action:'delete',confirmation:'DELETE'}));
  for(const table of ['origen_binder_source_lineage','origen_binder_source_edges','origen_binder_connections','origen_binder_share_grants','origen_binder_publications','origen_binder_publication_items'])assert.equal((await f.owner.query(`SELECT * FROM ${table} WHERE account_id=$1`,[s.account])).rows.length,0,table);
 });
});

test('049 upgrade preserves old operations, marks legacy notes private and is idempotent',requiresPostgres,async()=>{
 const directory=await mkdtemp(join(tmpdir(),'origen-sharing-migrations-'));let f;
 try{
  for(const name of await readdir(new URL('./migrations/',import.meta.url)))if(/^\d{3}_.*\.sql$/.test(name)&&Number(name.slice(0,3))<50)await copyFile(new URL('./migrations/'+name,import.meta.url),join(directory,name));
  f=await retrievalFixture({migrationDirectory:pathToFileURL(directory+'/')});
  const id=await newNote(f),parent=await newNote(f,'reader');await f.save('legacy','Historical student context.',{sub:'other'});
  await migrateDatabase(f.owner);await grantRuntimeAccess(f.owner,f.role,{schema:f.schema});await migrateDatabase(f.owner);
  assert.equal((await lineage(f,id)).classification,'unknown');assert.equal((await lineage(f,parent)).classification,'parent');
  const existing=await f.as('other',()=>createTopicRepository(f.db)('other',{action:'load',studentId:'alex'}));assert.equal(existing.notes[0].content,'Compare campus visit dates.');
  await f.note({action:'update',studentId:'alex',id,version:1,note:note('Existing API after migration')},'other');
  assert.equal((await lineage(f,id)).classification,'unknown');assert.equal((await lineage(f,id)).source_version,2);
  assert.equal((await f.owner.query('SELECT * FROM origen_binder_publications')).rows.length,0);
 }finally{await f?.close();await rm(directory,{recursive:true,force:true});}
});
