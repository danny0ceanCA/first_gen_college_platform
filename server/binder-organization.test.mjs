import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {binderFixture} from './binder-jobs-fixture.mjs';
import {createOrganizationService,validateOrganization} from './binder-organization.mjs';
import {organizationEnabled,organizationConfigurationIssues,assertOrganizationReady} from './binder-organization-policy.mjs';
import {createMemoryService} from './student-memory.mjs';
import {createTopicService} from './topic-notes.mjs';
import {createBinderProcessor,binderJobStatus} from './binder-jobs.mjs';

const database={skip:!process.env.DATABASE_TEST_URL};
const settings=()=>({ORIGEN_BINDER_ORGANIZATION:'true',ORIGEN_BINDER_JOBS:'true',ORIGEN_PERSONALIZATION_MODE:'on',ORIGEN_PERSONALIZATION_EXTRACTION:'true',OPENAI_API_KEY:'synthetic'});
const source='The student is considering nursing. The student works evenings. Which aid application is needed? The student decided to ask the counselor about transfer.';
const entries=[
 {topic:'options',category:'goal',certainty:'tentative',language:'en',quote:'The student is considering nursing.'},
 {topic:'transfer',category:'constraint',certainty:'stated',language:'en',quote:'The student works evenings.'},
 {topic:'costs',category:'question',certainty:'unresolved',language:'en',quote:'Which aid application is needed?'},
 {topic:'transfer',category:'decision',certainty:'stated',language:'en',quote:'The student decided to ask the counselor about transfer.'},
];
const response=items=>new Response(JSON.stringify({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({items})}]}]}));
const input=(summaryId='source',studentId='alex')=>({action:'suggest',summaryId,studentId,language:'en'});
const organize=(f,service,request=input(),options)=>f.as('reader',()=>service('reader',request,options));
const count=async(f,table)=>Number((await f.owner.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n);

test('bounded extractive contract retains full qualifiers, rejects inventions, forged scope, sensitivity and implied commitments',()=>{
 assert.deepEqual(validateOrganization({items:entries},source),entries);
 assert.deepEqual(validateOrganization({items:[]},source),[]);
 for(const items of [
  [{...entries[0],certainty:'stated'}], [{...entries[0],quote:'considering nursing.'}],
  [{...entries[0],quote:'The student committed to nursing.'}], [{...entries[0],studentId:'other'}],
  [{...entries[0],category:'decision',certainty:'stated'}], [{...entries[2],certainty:'stated'}],
  [entries[0],entries[0]],Array(7).fill(entries[0]),
 ])assert.throws(()=>validateOrganization({items},source),{message:'invalid_organization'});
 for(const quote of ['My income is 42000 dollars.','My social security number is 123-45-6789.','My email is private@example.test.'])assert.throws(()=>validateOrganization({items:[{...entries[1],quote}]},quote),{message:'invalid_organization'});
 const spanish='La estudiante quizá estudie enfermería. ¿Qué ayuda económica puedo solicitar?';
 assert.equal(validateOrganization({items:[{...entries[0],language:'es',quote:'La estudiante quizá estudie enfermería.'},{...entries[2],language:'es',quote:'¿Qué ayuda económica puedo solicitar?'}]},spanish).length,2);
 assert.throws(()=>validateOrganization({items:[{...entries[0],certainty:'stated',language:'es',quote:'La estudiante quizá estudie enfermería.'}]},spanish),{message:'invalid_organization'});
 for(const quote of ['The student never decided on nursing.','La estudiante no decidió estudiar enfermería.'])assert.throws(()=>validateOrganization({items:[{...entries[3],quote}]},quote),{message:'invalid_organization'});
 assert.equal(validateOrganization({items:[{...entries[3],language:'es',quote:'La estudiante decidió consultar al consejero.'}]},'La estudiante decidió consultar al consejero.').length,1);
 assert.equal(organizationEnabled(settings(),'reader'),true);
 assert.equal(organizationEnabled({...settings(),ORIGEN_BINDER_JOBS:'false'},'reader'),false);
 assert.equal(organizationEnabled({...settings(),ORIGEN_PERSONALIZATION_MODE:'cohort',ORIGEN_PERSONALIZATION_SUBJECTS:'other'},'reader'),false);
 assert.equal(organizationConfigurationIssues({...settings(),ORIGEN_BINDER_JOBS:'false'}).length,1);
});

test('one provider pass atomically routes each item once and preserves captured parent attribution after account role changes',database,async()=>{
 const f=await binderFixture();try{
  await assertOrganizationReady(f.db,settings());await f.save('source',source);
  await f.family('reader',{action:'save-account',account:{firstName:'Synthetic',email:'',role:'student'}});
  let calls=0;const service=createOrganizationService(f.db,settings(),async(url,options)=>{calls++;const body=JSON.parse(options.body);assert.equal(body.store,false);assert.equal(JSON.parse(body.input).reportedBy,'parent');return response(entries);});
  await Promise.all([organize(f,service),organize(f,service)]);
  const notes=(await f.notes()).notes,memories=(await f.memory({action:'load',studentId:'alex'})).memories;
  assert.equal(calls,1);assert.equal(notes.length,2);assert.equal(memories.length,2);
  assert.ok(notes.every(n=>n.status==='suggested'&&n.origin==='conversation'&&n.kind!=='decision'));
  assert.ok(memories.every(m=>m.status==='proposed'&&m.reportedBy==='parent'&&m.speaker==='parent'));
  assert.equal(memories.find(m=>m.category==='goal').organization.certainty,'tentative');
  assert.equal(notes.find(n=>n.organization.category==='decision').kind,'note');
  assert.equal(new Set([...notes,...memories].map(n=>n.content)).size,4);
  assert.equal(await count(f,'origen_plans'),0);assert.equal(await count(f,'origen_topic_note_batches'),1);assert.equal(await count(f,'origen_memory_batches'),1);
  await organize(f,createOrganizationService(f.db,settings(),()=>{throw Error('A completed source must not call the provider');}));
  for(const [sub,studentId] of [['other','alex'],['reader','sam'],['reader',null]]){
   assert.equal((await f.memory({action:'load',studentId},sub)).memories.length,0);
   await assert.rejects(f.as(sub,()=>service(sub,input('source',studentId))),{status:404});
  }
 }finally{await f.close();}
});

test('a failure after inserts rolls back both stores and receipts; a retry commits once',database,async()=>{
 const f=await binderFixture();try{
  await f.save('source',source);const service=createOrganizationService(f.db,settings(),async()=>response(entries));
  await assert.rejects(organize(f,service,input(),{beforeCommit:()=>{throw Error('synthetic_commit_failure');}}),/synthetic_commit_failure/);
  for(const table of ['origen_topic_notes','origen_student_memories','origen_topic_note_batches','origen_memory_batches'])assert.equal(await count(f,table),0,table);
  await organize(f,service);assert.equal(await count(f,'origen_topic_notes'),2);assert.equal(await count(f,'origen_student_memories'),2);
 }finally{await f.close();}
});

test('completed receipts and scoped fingerprints prevent repeat extraction after dismissal, including a repeated later summary',database,async()=>{
 const f=await binderFixture();try{
  await f.save('source',source);const service=createOrganizationService(f.db,settings(),async()=>response(entries));await organize(f,service);
  const note=(await f.notes()).notes.find(n=>n.kind==='question');await f.note({action:'delete',studentId:'alex',id:note.id,version:note.version});
  await organize(f,service);assert.equal((await f.notes()).notes.length,1);
  await f.save('repeat',source);await organize(f,service,input('repeat'));
  assert.equal((await f.notes()).notes.length,1);assert.equal((await f.memory({action:'load',studentId:'alex'})).memories.length,2);
  const memory=(await f.memory({action:'load',studentId:'alex'})).memories[0];await f.memory({action:'delete',studentId:'alex',id:memory.id,version:memory.version});
  await assert.rejects(organize(f,service),{status:409,message:'summary_suppressed'});
  await f.save('repeat-again',source);await organize(f,service,input('repeat-again'));
  assert.equal((await f.memory({action:'load',studentId:'alex'})).memories.length,0);
  await f.save('sibling',source,{studentId:'sam'});await organize(f,service,input('sibling','sam'));
  assert.equal((await f.memory({action:'load',studentId:'sam'})).memories.length,2,'deduplication is scoped, not global');
 }finally{await f.close();}
});

test('late extraction cannot overwrite a correction, survive source deletion, or commit after its gate is disabled',database,async()=>{
 for(const change of ['correct','delete','disable']){
  const f=await binderFixture();try{
   const env=settings();await f.save('source',source);
   const service=createOrganizationService(f.db,env,async()=>{
    if(change==='correct')await f.memory({action:'create',studentId:'alex',id:randomUUID(),memory:{category:'constraint',content:'I now work mornings.',language:'en',speaker:'student'}});
    if(change==='delete')await f.history({action:'delete',id:'source'});
    if(change==='disable')env.ORIGEN_BINDER_ORGANIZATION='false';
    return response(entries);
   });
   await assert.rejects(organize(f,service),{status:change==='correct'?409:change==='delete'?404:503});
   assert.equal(await count(f,'origen_topic_notes'),0);assert.equal(await count(f,'origen_topic_note_batches'),0);
   assert.equal((await f.memory({action:'load',studentId:'alex'})).memories.length,change==='correct'?1:0);
  }finally{await f.close();}
 }
});

test('Spanish organization uses the existing durable worker; memory UI sync only enqueues, retry survives a provider failure',database,async()=>{
 const f=await binderFixture();try{
  const env=settings(),spanish='La estudiante quizá estudie enfermería. ¿Qué ayuda económica puedo solicitar?';
  const items=[{...entries[0],language:'es',quote:'La estudiante quizá estudie enfermería.'},{...entries[2],language:'es',quote:'¿Qué ayuda económica puedo solicitar?'}];
  await f.save('source',spanish);let calls=0;
  const memory=createMemoryService(f.db,env,async()=>{throw Error('Memory sync must not extract');});
  const queued=await f.as('reader',()=>memory('reader',{action:'sync',studentId:'alex'}));assert.equal(queued.organizationManaged,true);assert.equal(queued.background.pending,1);
  const process=createBinderProcessor(f.db,env,async()=>{calls++;return calls===1?new Response('',{status:503}):response(items);});
  assert.equal(await process(await f.claim()),'pending');assert.equal(await count(f,'origen_memory_batches'),0);
  await f.owner.query("UPDATE origen_binder_jobs SET available_at=now()-interval '1 second'");assert.equal(await process(await f.claim()),'complete');
  assert.equal((await f.notes()).notes[0].language,'es');assert.equal((await f.memory({action:'load',studentId:'alex'})).memories[0].content,items[0].quote);
  const done=await f.as('reader',()=>memory('reader',{action:'load',studentId:'alex'}));assert.equal(done.pendingCount,0);assert.equal(done.memories.length,1);
  assert.equal(calls,2);assert.equal(await f.claim(),null);
 }finally{await f.close();}
});

test('family sources remain family-scoped; legacy receipts are respected; disabling organization preserves the legacy path',database,async()=>{
 const f=await binderFixture();try{
  await f.save('family',source,{studentId:null});await organize(f,createOrganizationService(f.db,settings(),async()=>response(entries)),input('family',null));
  assert.ok((await f.memory({action:'load',studentId:null})).memories.every(m=>m.speaker==='family'));
  assert.equal((await f.notes()).notes.length,0);
  await f.save('legacy',source);let calls=0;
  const legacy=createTopicService(f.db,{OPENAI_API_KEY:'synthetic'},async()=>{calls++;return new Response(JSON.stringify({output:[{content:[{type:'output_text',text:JSON.stringify({notes:[{topic:'costs',kind:'question',content:'Which aid application is needed?',quote:entries[2].quote}]})}]}]}));});
  await f.as('reader',()=>legacy('reader',input('legacy')));assert.equal(calls,1);
  await organize(f,createOrganizationService(f.db,settings(),()=>{throw Error('No automatic backfill of completed legacy extraction');}),input('legacy'));
  assert.equal((await f.notes()).notes.length,1);assert.equal((await f.memory({action:'load',studentId:'alex'})).memories.length,0);
  assert.equal((await f.as('reader',()=>binderJobStatus(f.db,'reader',{action:'load',studentId:'alex'}))).enabled,true);
 }finally{await f.close();}
});

test('worker lease fencing and permission revision stop both stores from committing',database,async()=>{
 for(const change of ['lease','permission']){
  const f=await binderFixture();try{
   await f.save('source',source);const job=await f.claim();
   const process=createBinderProcessor(f.db,settings(),async()=>{
    if(change==='lease')await f.owner.query("UPDATE origen_binder_jobs SET lease_until=now()-interval '1 second'");
    else await f.owner.query('UPDATE origen_eligibility SET revision=revision+1');
    return response(entries);
   });
   assert.equal(await process(job),'cancelled');assert.equal(await count(f,'origen_topic_notes'),0);assert.equal(await count(f,'origen_student_memories'),0);
  }finally{await f.close();}
 }
});

test('independent processors racing the same source commit one batch, and source deletion cascades all derived content',database,async()=>{
 const f=await binderFixture();try{
  await f.save('source',source);let calls=0,release;const barrier=new Promise(r=>{release=r;});
  const provider=async()=>{calls++;if(calls===2)release();await barrier;return response(entries);};
  await Promise.all([organize(f,createOrganizationService(f.db,settings(),provider)),organize(f,createOrganizationService(f.db,settings(),provider))]);
  assert.equal(calls,2,'cross-process requests may both reach the provider but cannot double-persist');
  assert.equal(await count(f,'origen_topic_notes'),2);assert.equal(await count(f,'origen_student_memories'),2);assert.equal(await count(f,'origen_memory_batches'),1);
  await f.history({action:'delete',id:'source'});
  for(const table of ['origen_topic_notes','origen_student_memories','origen_topic_note_batches','origen_memory_batches'])assert.equal(await count(f,table),0);
 }finally{await f.close();}
});

test('empty results receive both receipts; invalid results receive neither and remain retryable',database,async()=>{
 const f=await binderFixture();try{
  await f.save('source',source);let invalid=true,calls=0;
  const service=createOrganizationService(f.db,settings(),async()=>{calls++;return response(invalid?[{...entries[0],quote:'An invented decision.'}]:[]);});
  await assert.rejects(organize(f,service),{status:502});assert.equal(await count(f,'origen_topic_note_batches'),0);assert.equal(await count(f,'origen_memory_batches'),0);
  invalid=false;await organize(f,service);await organize(f,service);assert.equal(calls,2);assert.equal(await count(f,'origen_topic_note_batches'),1);assert.equal(await count(f,'origen_memory_batches'),1);
 }finally{await f.close();}
});

test('worker reports only a finite rejection code and leaves invalid organization retryable without receipts',database,async()=>{
 const f=await binderFixture();try{
  await f.save('source',source);const failures=[];
  const process=createBinderProcessor(f.db,settings(),async()=>response([{...entries[0],quote:'Private invented source content.'}]));
  assert.equal(await process(await f.claim(),{onFailure:code=>failures.push(code)}),'pending');
  assert.deepEqual(failures,['organization_quote']);
  for(const table of ['origen_topic_notes','origen_student_memories','origen_topic_note_batches','origen_memory_batches'])assert.equal(await count(f,table),0);
  await f.owner.query("UPDATE origen_binder_jobs SET available_at=now()-interval '1 second'");
  const retry=createBinderProcessor(f.db,settings(),async()=>response(entries));
  assert.equal(await retry(await f.claim(),{onFailure:()=>{throw Error('No failure expected');}}),'complete');
  assert.equal(await count(f,'origen_topic_note_batches'),1);
 }finally{await f.close();}
});

test('existing memory receipt wins a late legacy extraction race without duplicating personal facts into the topic store',database,async()=>{
 const f=await binderFixture();try{
  await f.save('source',source);
  const service=createOrganizationService(f.db,settings(),async()=>{
   await f.owner.query("INSERT INTO origen_memory_batches(account_id,summary_id,source_version) SELECT account_id,id,'legacy' FROM origen_conversation_summaries WHERE id='source'");
   return response(entries);
  });
  await organize(f,service);assert.equal(await count(f,'origen_topic_notes'),0);assert.equal(await count(f,'origen_student_memories'),0);assert.equal(await count(f,'origen_topic_note_batches'),1);
 }finally{await f.close();}
});

test('capacity failure writes neither store nor receipt and keeps the saved source',database,async()=>{
 const f=await binderFixture();try{
  await f.save('source',source);
  await f.owner.query("INSERT INTO origen_student_memories(account_id,id,version,student_id,category,content,language,speaker,reported_by,last_action,status) SELECT a.id,gen_random_uuid(),1,'alex','constraint','Existing detail '||n,'en','student','student','create','confirmed' FROM origen_accounts a CROSS JOIN generate_series(1,200) n WHERE a.auth0_subject='reader'");
  await assert.rejects(organize(f,createOrganizationService(f.db,settings(),async()=>response(entries))),{status:409,message:'memory_limit'});
  assert.equal(await count(f,'origen_topic_notes'),0);assert.equal(await count(f,'origen_topic_note_batches'),0);assert.equal(await count(f,'origen_memory_batches'),0);assert.equal(await count(f,'origen_conversation_summaries'),1);
  const process=createBinderProcessor(f.db,settings(),async()=>response(entries));assert.equal(await process(await f.claim()),'failed');
  assert.equal((await f.as('reader',()=>binderJobStatus(f.db,'reader',{action:'load',studentId:'alex'}))).canRetry,true);
  await f.owner.query('DELETE FROM origen_student_memories');
  await f.as('reader',()=>binderJobStatus(f.db,'reader',{action:'retry',studentId:'alex'}));assert.equal(await process(await f.claim()),'complete');
 }finally{await f.close();}
});
