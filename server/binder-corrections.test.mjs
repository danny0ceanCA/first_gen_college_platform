import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {mkdtemp,readdir,copyFile,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {retrievalFixture} from './history-retrieval-fixture.mjs';
import {migrateDatabase} from './database.mjs';
import {binderFixture} from './binder-jobs-fixture.mjs';
import {createOrganizationService} from './binder-organization.mjs';
import {createCorrectionService,correctionSnapshot,validateCorrection} from './binder-corrections.mjs';
import {assertCorrectionsReady} from './binder-corrections-policy.mjs';
import {loadVoiceWorkspace} from './voice-workspace.mjs';
import {createApp} from './index.mjs';
const enabled={skip:!process.env.DATABASE_TEST_URL};
const env={ORIGEN_BINDER_CORRECTIONS:'true'};
const organization={ORIGEN_BINDER_ORGANIZATION:'true',ORIGEN_BINDER_JOBS:'true',ORIGEN_PERSONALIZATION_MODE:'on',ORIGEN_PERSONALIZATION_EXTRACTION:'true',OPENAI_API_KEY:'synthetic'};
const response=items=>new Response(JSON.stringify({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({items})}]}]}));
async function setup(t,language='en'){
 const f=await binderFixture();t.after(()=>f.close());
 const constraint=language==='es'?'La estudiante trabaja por las tardes.':'The student works evenings.';
 const question=language==='es'?'¿Qué ayuda económica puedo solicitar?':'Which aid application is needed?';
 const goal=language==='es'?'La estudiante quizá estudie enfermería.':'The student is considering nursing.';
 await f.save('source',[constraint,question,goal].join(' '));
 await f.as('reader',()=>createOrganizationService(f.db,organization,async()=>response([{topic:'transfer',category:'constraint',certainty:'stated',language,quote:constraint},{topic:'costs',category:'question',certainty:'unresolved',language,quote:question},{topic:'options',category:'goal',certainty:'tentative',language,quote:goal}]))('reader',{studentId:'alex',summaryId:'source'}));
 return {...f,change:(input,options,sub='reader')=>f.as(sub,()=>createCorrectionService(f.db,env)(sub,input,options)),memories:async()=>(await f.memory({action:'load',studentId:'alex'})).memories};
}
const command=(store,item,action='delete',value)=>({operationId:randomUUID(),store,studentId:'alex',id:item.id,version:item.version,action,before:correctionSnapshot(item,store),...(value?{value}:{})});
const undo=(store,result)=>({operationId:randomUUID(),store,studentId:'alex',action:'undo',id:result.id,version:result.version,before:result.undo.before,undoOf:result.undo.operationId});

test('correction contract requires explicit scope, versions, bounded snapshots and operation identities',()=>{
 const input=command('note',{id:randomUUID(),version:1,topic:'costs',kind:'question',content:'Which aid?',language:'en',status:'suggested',origin:'conversation',summaryId:'source'});
 assert.equal(validateCorrection({...input,accountId:'forged'}).accountId,undefined);
 for(const extra of [{operationId:'bad'},{version:0},{studentId:undefined},{action:'share'},{store:'profile'},{before:null},{action:'undo',undoOf:'bad'},{before:{content:'x'.repeat(19000)}}])assert.throws(()=>validateCorrection({...input,...extra}),{status:400});
});

test('English and Spanish corrections preserve source provenance and retain only current effective facts',enabled,async t=>{
 for(const language of ['en','es'])await t.test(language,async t=>{
  const f=await setup(t,language);await assertCorrectionsReady(f.db,env);
  const old=(await f.memories()).find(m=>m.category==='constraint');
  const content=language==='es'?'Trabajo solo los martes y jueves.':'I work only Tuesdays and Thursdays.';
  const edit=command('memory',old,'update',{category:'constraint',content,language,speaker:'student'});
  const result=await f.change(edit);assert.equal(result.version,2);assert.equal(result.withdrawnSuggestions,1);
  const current=(await f.memories())[0];assert.equal(current.id,old.id);assert.equal(current.content,content);assert.equal(current.reportedBy,'parent');assert.deepEqual(current.organization,old.organization);
  assert.equal(current.quote,old.quote);assert.equal(current.status,'confirmed');
  assert.ok((await f.retrieve(language==='es'?'martes jueves':'Tuesdays Thursdays')).items.some(i=>i.content.includes(content)));
  assert.ok(!(await f.retrieve(language==='es'?'tardes':'evenings')).items.some(i=>i.kind==='summary'));
  const workspace=await f.as('reader',()=>loadVoiceWorkspace(f.db,'reader',{studentId:'alex',mode:'finance',suppressedSummaryIds:['source']}));assert.equal(workspace.conversationPoints.length,0);
  assert.equal((await f.notes()).notes[0].excludedFromGuidance,true);
  const replay=await f.change(edit);assert.equal(replay.replayed,true);assert.equal((await f.memories())[0].version,2);
  assert.ok(!JSON.stringify((await f.owner.query('SELECT * FROM origen_binder_changes')).rows).includes(content));
  await assert.rejects(f.change({...edit,value:{...edit.value,content:'Changed retry'}}),{status:409,message:'operation_changed'});
 });
});

test('note correction replaces voice/retrieval content without reintroducing its old summary; undo restores only selected note',enabled,async t=>{
 const f=await setup(t),old=(await f.notes()).notes[0];
 const result=await f.change(command('note',old,'update',{topic:'costs',kind:'question',content:'Which nursing scholarship accepts part-time students?',language:'en'}));
 const data=await f.memory({action:'load',studentId:'alex'});assert.deepEqual(data.suppressedSummaryIds,['source']);assert.equal(data.memories.length,0);
 const current=(await f.notes()).notes[0];
 const workspace=await f.as('reader',()=>loadVoiceWorkspace(f.db,'reader',{studentId:'alex',mode:'finance',suppressedSummaryIds:data.suppressedSummaryIds,focus:{kind:'note',noteId:current.id,studentId:'alex',topic:'costs',version:current.version}}));
 assert.equal(workspace.notes[0].content,current.content);assert.equal(workspace.sourceSummary,undefined);
 assert.ok((await f.retrieve('nursing scholarship part-time')).items.some(i=>i.kind==='note'&&i.content===current.content));
 const restored=await f.change(undo('note',result));assert.equal(restored.id,old.id);assert.equal(restored.version,3);assert.equal(restored.undo,null);
 assert.equal((await f.notes()).notes[0].content,old.content);assert.equal((await f.memories()).length,0);
 assert.deepEqual((await f.memory({action:'load',studentId:'alex'})).suppressedSummaryIds,['source']);
 const restoredWorkspace=await f.as('reader',()=>loadVoiceWorkspace(f.db,'reader',{studentId:'alex',mode:'finance',suppressedSummaryIds:['source'],focus:{kind:'point',noteId:old.id,studentId:'alex',topic:'costs',version:3}}));
 assert.equal(restoredWorkspace.conversationPoints[0].content,old.content);assert.equal(restoredWorkspace.sourceSummary,undefined);
});

test('confirm and undo preserve original parent attribution without withdrawing unrelated proposals',enabled,async t=>{
 const f=await setup(t),old=(await f.memories())[0];
 await f.family('reader',{action:'save-account',account:{firstName:'Synthetic',email:'',role:'student'}});
 const confirmed=await f.change(command('memory',old,'confirm'));
 const current=(await f.memories()).find(m=>m.id===old.id);assert.equal(current.reportedBy,'parent');assert.equal(current.organization.reportedBy,'parent');assert.equal(current.status,'confirmed');
 const restored=await f.change(undo('memory',confirmed));assert.equal(restored.withdrawnSuggestions,0);
 assert.equal((await f.memories()).length,2);assert.equal((await f.memories()).find(m=>m.id===old.id).status,'proposed');
 assert.deepEqual((await f.memory({action:'load',studentId:'alex'})).suppressedSummaryIds,[]);
});

test('removal clears text; undo makes one replacement without reversing the deletion journal',enabled,async t=>{
 for(const store of ['memory','note'])await t.test(store,async t=>{
  const f=await setup(t),old=store==='memory'?(await f.memories())[0]:(await f.notes()).notes[0];
  const removal=command(store,old),result=await f.change(removal);
  assert.equal((await f.change(removal)).replayed,true);
  const restoring=undo(store,result);const restored=await f.change(restoring);assert.notEqual(restored.id,old.id);assert.equal(restored.version,1);
  const replay=await f.change(restoring);assert.equal(replay.id,restored.id);assert.equal(replay.replayed,true);
  const rows=store==='memory'?await f.memories():(await f.notes()).notes;assert.equal(rows.length,1);assert.equal(rows[0].content,old.content);
  assert.ok((await f.owner.query('SELECT * FROM origen_deletion_journal')).rows.length>0);
  await assert.rejects(f.change({...restoring,operationId:randomUUID()}),{status:409,message:'undo_unavailable'});
 });
});

test('stale edits, forged undo payloads, expired undo and concurrent duplicate requests are fenced',enabled,async t=>{
 const f=await setup(t),old=(await f.notes()).notes[0];
 const edit=command('note',old,'update',{topic:'costs',kind:'question',content:'Which aid deadline applies to nursing?',language:'en'});
 const results=await Promise.all([f.change(edit),f.change(edit)]);assert.equal(results.filter(r=>r.replayed).length,1);
 const restoration=undo('note',results[0]);
 await assert.rejects(f.change({...restoration,before:{...restoration.before,content:'Injected fact'}}),{status:409});
 await assert.rejects(f.change({...edit,operationId:randomUUID()}),{status:409,message:'item_changed'});
 await f.owner.query("UPDATE origen_binder_changes SET undo_until=now()-interval '1 second'");
 await assert.rejects(f.change(restoration),{status:409,message:'undo_unavailable'});
 assert.equal((await f.change(edit)).undo,null);
});

test('restoring a removed parent-authored manual note after a role change cannot acquire student sharing eligibility',enabled,async t=>{
 const f=await setup(t),id=randomUUID();await f.note({action:'create',studentId:'alex',id,note:{topic:'options',kind:'note',content:'A parent perspective.',language:'en'}});
 const old=(await f.notes()).notes.find(n=>n.id===id),removed=await f.change(command('note',old));
 await f.family('reader',{action:'save-account',account:{firstName:'Synthetic',email:'',role:'student'}});
 const restored=await f.change(undo('note',removed));
 const lineage=(await f.owner.query("SELECT * FROM origen_binder_source_lineage WHERE source_kind='note' AND source_id=$1",[restored.id])).rows[0];
 assert.equal(lineage.active,false);assert.equal(lineage.complete,false);assert.notEqual(lineage.classification,'student_only');
 assert.equal((await f.owner.query('SELECT restored_from FROM origen_topic_notes WHERE id=$1',[restored.id])).rows[0].restored_from,id);
});

test('undo rejects newer item versions and changed permission or source; erased source cascades receipts',enabled,async t=>{
 for(const mutation of ['version','permission','source-change','source-delete'])await t.test(mutation,async t=>{
  const f=await setup(t),old=(await f.notes()).notes[0];
  const result=await f.change(command('note',old,'update',{topic:'costs',kind:'question',content:'A revised aid question?',language:'en'}));
  if(mutation==='version')await f.change(command('note',(await f.notes()).notes[0],'update',{topic:'costs',kind:'question',content:'A newer aid question?',language:'en'}));
  if(mutation==='permission')await f.owner.query('UPDATE origen_eligibility SET revision=revision+1');
  if(mutation==='source-change')await f.owner.query("UPDATE origen_conversation_summaries SET summary='Changed evidence.' WHERE id='source'");
  if(mutation==='source-delete')await f.history({action:'delete',id:'source'});
  await assert.rejects(f.change(undo('note',result)),{status:409});
  if(mutation==='source-delete'){assert.equal((await f.owner.query('SELECT * FROM origen_binder_changes')).rows.length,0);assert.equal((await f.notes()).notes.length,0);}
 });
});

test('account/student isolation, rollback, feature disablement and permission fencing leave no partial mutation',enabled,async t=>{
 const f=await setup(t),old=(await f.memories())[0],edit=command('memory',old,'update',{category:'goal',content:'An explicit corrected goal.',speaker:'student',language:'en'});
 await assert.rejects(f.change({...edit,studentId:'sam'}),{status:404});await assert.rejects(f.change(edit,undefined,'other'),{status:404});
 assert.equal((await f.as('other',()=>f.db.query('SELECT * FROM origen_binder_changes'))).rows.length,0);
 await assert.rejects(f.change(edit,{beforeCommit:()=>{throw Error('rollback-proof');}}),/rollback-proof/);
 assert.equal((await f.memories()).length,2);assert.equal((await f.owner.query('SELECT * FROM origen_binder_changes')).rows.length,0);
 await assert.rejects(f.as('reader',()=>createCorrectionService(f.db,{} )('reader',edit)),{status:503});
 const settings={...env};await assert.rejects(f.as('reader',()=>createCorrectionService(f.db,settings)('reader',edit,{beforeCommit:()=>{settings.ORIGEN_BINDER_CORRECTIONS='false';}})),{status:503});
 assert.equal((await f.memories()).length,2);
});

test('HTTP accepts only authorized bounded corrections, blocks legacy mutations when enabled and keeps logs content-free',enabled,async t=>{
 const f=await setup(t),logs=[],app=createApp(env,async()=>({sub:'reader'}),f.db,line=>logs.push(line)),server=createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const url=`http://127.0.0.1:${server.address().port}`;
  const post=(path,body,token=true)=>fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer synthetic'}:{})},body:JSON.stringify(body)});
  const old=(await f.memories())[0],input=command('memory',old,'update',{category:'goal',content:'PRIVATE_CORRECTION_SENTINEL',speaker:'student',language:'en'});
  assert.equal((await post('/api/binder-changes',input,false)).status,401);
  assert.equal((await post('/api/binder-changes',{...input,operationId:'bad'})).status,400);
  assert.equal((await post('/api/student-memory',{action:'delete',studentId:'alex',id:old.id,version:old.version})).status,409);
  const saved=await post('/api/binder-changes',input);assert.equal(saved.status,200);assert.equal(saved.headers.get('cache-control'),'no-store');
  assert.equal((await post('/api/binder-changes',input)).status,200);
  await app.flushLogs();assert.ok(!JSON.stringify(logs).includes('PRIVATE_CORRECTION_SENTINEL'));
 }finally{await new Promise(r=>server.close(r));}
});

test('migration refreshes preexisting note digests without certifying stale notes or changing protected classification',enabled,async()=>{
 const directory=await mkdtemp(resolve('tmp','phase3-migrations-'));let f;
 try{
  for(const name of await readdir('server/migrations'))if(name.endsWith('.sql')&&name<'063_')await copyFile(join('server/migrations',name),join(directory,name));
  f=await retrievalFixture({migrationDirectory:pathToFileURL(directory+'/')});
  const ids=[randomUUID(),randomUUID()];
  for(const id of ids)await f.note({action:'create',studentId:'alex',id,note:{topic:'options',kind:'note',content:'An existing private parent note.',language:'en'}});
  const stale='0'.repeat(64);await f.owner.query('UPDATE origen_binder_source_lineage SET source_digest=$2 WHERE source_id=$1',[ids[1],stale]);
  const before=(await f.owner.query("SELECT * FROM origen_binder_source_lineage WHERE source_id=$1",[ids[0]])).rows[0];
  await migrateDatabase(f.owner);
  const rows=(await f.owner.query("SELECT n.id,l.*,l.source_digest=encode(sha256(convert_to(to_jsonb(n)::text,'UTF8')),'hex') AS matches FROM origen_topic_notes n JOIN origen_binder_source_lineage l ON l.account_id=n.account_id AND l.source_id=n.id::text AND l.source_kind='note'")).rows;
  const refreshed=rows.find(r=>r.source_id===ids[0]);assert.equal(refreshed.matches,true);assert.equal(refreshed.classification,before.classification);assert.equal(refreshed.complete,before.complete);assert.equal(refreshed.active,before.active);assert.equal(refreshed.revision,before.revision+1);
  assert.equal(rows.find(r=>r.source_id===ids[1]).source_digest,stale);
 }finally{await f?.close();await rm(directory,{recursive:true,force:true});}
});
