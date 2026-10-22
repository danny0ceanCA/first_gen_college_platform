import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {binderFixture} from './binder-jobs-fixture.mjs';
import {isolateDatabase,runRetentionJob} from './account-isolation.mjs';
import {createRecoveryRepository,createRecoveryProcessor,claimRecoveryJob,validateCheckpointBody,assertRecoveryReady,recoveryReady} from './conversation-recovery.mjs';
import {createPrivacyRepository} from './privacy-controls.mjs';
import {conversationCheckpoint} from '../src/conversationCheckpoint.mjs';
import {startBinderWorker} from './binder-jobs.mjs';
import {exportDeletionManifest,replayDeletionManifest} from '../ops/privacy-recovery.mjs';
import {jobNames} from './observability/metrics.mjs';
import {createJobRunner} from './observability/jobs.mjs';
import {createLifecycleRepository} from './account-lifecycle.mjs';
const enabled={skip:!process.env.DATABASE_TEST_URL};
const settings=()=>({ORIGEN_CONVERSATION_RECOVERY:'true',ORIGEN_BINDER_JOBS:'true',OPENAI_API_KEY:'synthetic'});
const body=(id=randomUUID(),studentId='alex')=>({id,studentId,mode:'planning',date:new Date().toISOString(),sources:[],language:'en',turns:[{role:'user',text:'Maybe nursing. I work Tuesdays and Thursdays.'}]});
const output=()=>new Response(JSON.stringify({status:'completed',output:[{content:[{type:'output_text',text:'Nursing remains tentative. The student works Tuesdays and Thursdays.'}]}]}));
async function setup(t){
 const f=await binderFixture();t.after(()=>f.close());const env=settings();
 const run=(input,sub='reader')=>f.as(sub,()=>createRecoveryRepository(f.db,env)(sub,input));
 const claim=()=>runRetentionJob(()=>claimRecoveryJob(isolateDatabase(f.maintenance,{schema:f.schema})));
 const checkpoint=async(b=body())=>{const {epoch}=await run({action:'status'});const contextRevision=(await f.memory({action:'revision',studentId:b.studentId})).revision;const input={action:'checkpoint',id:b.id,epoch,contextRevision,sequence:1,body:b};return {input,result:await run(input)};};
 const queue=async b=>{const value=await checkpoint(b);await run({action:'finalize',id:value.input.id,sequence:1});return value;};
 return {...f,env,run,claim,checkpoint,queue};
}
test('new maintenance jobs preserve the deployed advisory-lock indexes',()=>{assert.equal(jobNames.indexOf('permission-data'),0);assert.equal(jobNames.indexOf('binder-processing'),16);assert.equal(jobNames.indexOf('coordinator-lifecycle'),17);assert.ok(jobNames.indexOf('conversation-checkpoints')>17);});
test('checkpoint bounds, normalization and coordinator-code redaction',()=>{
 const b=body();b.turns[0].text='Code ABCDE-FGHJK';assert.doesNotMatch(JSON.stringify(validateCheckpointBody(b)),/ABCDE/);
 assert.throws(()=>validateCheckpointBody({...body(),turns:Array(201).fill({role:'user',text:'hello'})}),{status:400});
 assert.throws(()=>validateCheckpointBody({...body(),turns:Array(9).fill({role:'user',text:'a'.repeat(12000)})}),{status:413});
 assert.throws(()=>validateCheckpointBody({...body(),turns:[{role:'system',text:'hello'}]}),{status:400});
});
test('transport coalesces snapshots, retries the same version after an uncertain response and never claims saved early',async()=>{
 const calls=[],states=[];let fail=true;
 const stream=conversationCheckpoint({epoch:1,contextRevision:0,delayMs:100000,onState:s=>states.push(s),post:async input=>{calls.push(structuredClone(input));if(fail){fail=false;throw new Error('lost_ack');}return {acknowledged:true,sequence:input.sequence,status:input.action==='finalize'?'pending':'active'};}});
 const b=body();stream.update(b);await assert.rejects(stream.flush());assert.equal(states.at(-1),'failed');assert.ok(!states.includes('protected'));
 await stream.flush();assert.deepEqual(calls[0],calls[1]);assert.equal(states.at(-1),'protected');
 stream.update({...b,turns:[...b.turns,{role:'user',text:'What does college cost?'}]});await stream.finish();assert.equal(states.at(-1),'pending');assert.equal(calls.at(-1).sequence,2);stream.stop();
});
test('scoped durable snapshots survive a new repository; duplicates cannot overwrite or cross scopes',enabled,async t=>{
 const f=await setup(t);await assertRecoveryReady(f.db,f.env);await assert.rejects(assertRecoveryReady(f.db,{...f.env,ORIGEN_BINDER_JOBS:'false'}));
 const {input,result}=await f.checkpoint();assert.equal(result.acknowledged,true);
 assert.deepEqual(await f.run(input),result);assert.equal((await f.run({action:'read',id:input.id})).body.turns[0].text,input.body.turns[0].text);
 await assert.rejects(f.run({...input,body:{...input.body,turns:[{role:'user',text:'different'}]}}),{status:409});
 await assert.rejects(f.run({...input,sequence:2,body:{...input.body,studentId:'sam'}}),{status:409});
 await assert.rejects(f.run({action:'read',id:input.id},'other'),{status:404});
 assert.equal((await f.as('other',()=>f.db.query('SELECT * FROM origen_checkpoint_text'))).rows.length,0);
 await assert.rejects(runRetentionJob(()=>isolateDatabase(f.maintenance,{schema:f.schema}).query('SELECT * FROM origen_checkpoint_text')),{code:'42501'});
 await assert.rejects(f.history({action:'save',item:{...input.body,summary:'bypass'}}),{status:409});
});
test('browser loss and worker restart preserve one summary and one binder job, deleting raw text atomically',enabled,async t=>{
 const f=await setup(t),{input}=await f.queue();
 const pair=await Promise.all([f.claim(),f.claim()]);assert.equal(pair.filter(Boolean).length,1);const first=pair.find(Boolean);
 await f.owner.query("UPDATE origen_conversation_checkpoints SET lease_until=now()-interval '1 second' WHERE id=$1",[input.id]);
 const second=await f.claim();assert.notEqual(second.lease_token,first.lease_token);
 assert.equal(await createRecoveryProcessor(f.db,f.env,output)(first),'cancelled');
 assert.equal(await createRecoveryProcessor(f.db,f.env,output)(second),'complete');
 assert.equal((await f.history({action:'load',studentId:'alex'})).items.length,1);
 assert.equal((await f.owner.query('SELECT * FROM origen_checkpoint_text')).rows.length,0);
 assert.equal((await f.owner.query('SELECT * FROM origen_binder_jobs')).rows.length,1);
 assert.equal((await f.run({action:'finalize',id:input.id,sequence:1})).status,'complete');
 assert.equal((await f.run(input)).status,'complete');assert.equal(await f.claim(),null);
});
test('provider failures retry durably without acknowledgement loss',enabled,async t=>{
 const f=await setup(t);await f.queue();const first=await f.claim();
 assert.equal(await createRecoveryProcessor(f.db,f.env,async()=>new Response('',{status:503}))(first),'pending');
 assert.equal((await f.owner.query('SELECT * FROM origen_checkpoint_text')).rows.length,1);
 await f.owner.query("UPDATE origen_conversation_checkpoints SET available_at=now()-interval '1 second'");
 assert.equal(await createRecoveryProcessor(f.db,f.env,output)(await f.claim()),'complete');
});
test('a correction during provider work blocks the old commit until the student reviews the captured discussion',enabled,async t=>{
 const f=await setup(t),{input}=await f.queue();const job=await f.claim();
 assert.equal(await createRecoveryProcessor(f.db,f.env,async()=>{
  await f.memory({action:'create',studentId:'alex',id:randomUUID(),memory:{category:'constraint',content:'I work Wednesdays now.',language:'en',speaker:'student'}});return output();
 })(job),'review');
 assert.equal((await f.history({action:'load',studentId:'alex'})).items.length,0);
 const review=await f.run({action:'read',id:input.id});assert.equal(review.needsReview,true);
 await assert.rejects(f.run({...input,action:'review',sequence:2,reviewed:true,contextRevision:-1}),{status:409});
 const reviewed=await f.run({...input,action:'review',sequence:2,reviewed:true,contextRevision:review.contextRevision,body:{...review.body,turns:[{role:'user',text:'Maybe nursing.'}]}});
 await f.run({action:'finalize',id:input.id,sequence:reviewed.sequence});assert.equal(await createRecoveryProcessor(f.db,f.env,output)(await f.claim()),'complete');
});
test('logout barrier, permission withdrawal, deletion and expiry fence in-flight work and erase raw text',enabled,async t=>{
 const f=await setup(t);
 for(const event of ['stop','permission','delete','expiry','privacy'])await t.test(event,async()=>{
  const {input}=await f.queue(),job=await f.claim();
  const process=createRecoveryProcessor(f.db,f.env,async()=>{
   if(event==='stop')await f.run({action:'stop'});
   if(event==='permission')await f.owner.query("UPDATE origen_eligibility SET revision=revision+1 WHERE subject_hash=encode(sha256(convert_to('reader','UTF8')),'hex')");
   if(event==='delete')await f.history({action:'delete',id:input.id});
   if(event==='expiry'){await f.owner.query("UPDATE origen_conversation_checkpoints SET expires_at=now()-interval '1 second' WHERE id=$1",[input.id]);}
   if(event==='privacy')await f.as('reader',async()=>{const privacy=createPrivacyRepository(f.db),selection={categories:['memories'],studentId:'alex'};const preview=await privacy('reader',{action:'preview',...selection});await privacy('reader',{action:'erase',...selection,revision:preview.revision,confirmation:'DELETE'});});
   return output();
  });
  assert.equal(await process(job),'cancelled');
  assert.equal((await f.history({action:'find',id:input.id})).items.length,0);
  assert.equal((await f.owner.query('SELECT * FROM origen_checkpoint_text WHERE id=$1',[input.id])).rows.length,0);
  await assert.rejects(f.run({...input,sequence:2}),{status:410});
  // A request that had not yet reserved an ID cannot open after the barrier.
  if(['stop','permission','privacy'].includes(event)){const late=body();await assert.rejects(f.run({...input,id:late.id,body:late}),{status:409});}
 });
});
test('rollback flag stops new/late writes while retaining discard and retention controls',enabled,async t=>{
 const f=await setup(t),{input}=await f.queue();const job=await f.claim();f.env.ORIGEN_CONVERSATION_RECOVERY='false';
 assert.equal(await createRecoveryProcessor(f.db,f.env,output)(job),'pending');
 await assert.rejects(f.run({...input,sequence:2}),{status:503});assert.equal((await f.run({action:'status'})).enabled,false);
 await f.run({action:'discard',id:input.id});assert.equal((await f.owner.query('SELECT * FROM origen_checkpoint_text')).rows.length,0);
});
test('the existing worker drains recovery then binder work without an open browser',enabled,async t=>{
 const f=await setup(t),{input}=await f.queue();
 const stop=startBinderWorker({application:f.db,maintenance:f.maintenance,schema:f.schema,env:f.env,intervalMs:20,request:async(_url,options)=>JSON.parse(options.body).instructions.startsWith('Write a natural narrative')?output():new Response(JSON.stringify({output:[{content:[{type:'output_text',text:JSON.stringify({notes:[{topic:'options',kind:'note',content:'Nursing remains tentative.',quote:'Nursing remains tentative.'}]})}]}]}))});
 try{for(let i=0;i<200;i++){if((await f.notes()).notes.length)break;await new Promise(r=>setTimeout(r,20));}assert.equal((await f.history({action:'find',id:input.id})).items.length,1);assert.equal((await f.notes()).notes.length,1);assert.equal((await f.owner.query('SELECT * FROM origen_checkpoint_text')).rows.length,0);}finally{await stop();}
});
test('five failed automatic attempts and two reviewed retries are bounded; stale snapshots cannot bypass the limit',enabled,async t=>{
 const f=await setup(t),{input}=await f.queue(),process=createRecoveryProcessor(f.db,f.env,async()=>new Response('',{status:503}));
 for(let n=1;n<=5;n++){await f.owner.query("UPDATE origen_conversation_checkpoints SET available_at=now()-interval '1 second'");const job=await f.claim();assert.equal(job.attempts,n);assert.equal(await process(job),n===5?'failed':'pending');}
 for(let n=1;n<=2;n++){
  const record=await f.run({action:'read',id:input.id});const result=await f.run({...input,action:'review',body:record.body,sequence:record.sequence+1,contextRevision:record.contextRevision,reviewed:true});
  assert.equal(result.status,'active');await f.owner.query("UPDATE origen_conversation_checkpoints SET status='failed',attempts=5 WHERE id=$1",[input.id]);
 }
 const record=await f.run({action:'read',id:input.id});await assert.rejects(f.run({...input,action:'review',sequence:record.sequence+1,contextRevision:record.contextRevision,reviewed:true}),{status:409});
});
test('expiry works with the feature disabled; exports include active copies and restore discards them',enabled,async t=>{
 const f=await setup(t),{input}=await f.checkpoint();
 const exported=await f.as('reader',()=>createLifecycleRepository(f.db)('reader',{action:'export'}));assert.equal(exported.temporaryRecovery.length,1);assert.equal(exported.temporaryRecovery[0].id,input.id);
 f.env.ORIGEN_CONVERSATION_RECOVERY='false';await f.owner.query("UPDATE origen_conversation_checkpoints SET expires_at=now()-interval '1 second' WHERE id=$1",[input.id]);
 const sweeper=createJobRunner(f.maintenance,{schema:f.schema,log:()=>{}});
 try{assert.equal((await sweeper.run('conversation-checkpoints',async db=>{assert.equal(await recoveryReady(db),true);return claimRecoveryJob(db,{claim:false});})).outcome,'completed');}finally{await sweeper.stop();}
 assert.equal((await f.owner.query('SELECT * FROM origen_checkpoint_text')).rows.length,0);
 f.env.ORIGEN_CONVERSATION_RECOVERY='true';const second=await f.checkpoint();const manifest=await exportDeletionManifest(f.owner);await replayDeletionManifest(f.owner,manifest);
 assert.equal((await f.owner.query('SELECT * FROM origen_checkpoint_text')).rows.length,0);await assert.rejects(f.run(second.input),{status:410});
});
test('privacy preview tracks pending text versions; deleting a student cascades temporary text',enabled,async t=>{
 const f=await setup(t),{input}=await f.checkpoint(),privacy=(value)=>f.as('reader',()=>createPrivacyRepository(f.db)('reader',value)),selection={categories:['summaries'],studentId:'alex'};
 const preview=await privacy({action:'preview',...selection});assert.equal(preview.recoveryCopies,1);
 await f.run({...input,sequence:2,body:{...input.body,turns:[...input.body.turns,{role:'user',text:'I have a question about aid.'}]}});
 await assert.rejects(privacy({action:'erase',...selection,revision:preview.revision,confirmation:'DELETE'}),{status:409});
 await f.family('reader',{action:'delete-student',id:'alex'});
 assert.equal((await f.owner.query('SELECT * FROM origen_checkpoint_text')).rows.length,0);await assert.rejects(f.run(input),{status:404});
});

test('account deletion removes recovery text and still acknowledges cleanup-only logout',enabled,async t=>{
 const f=await setup(t);await f.checkpoint();
 await f.as('reader',()=>createLifecycleRepository(f.db)('reader',{action:'delete',confirmation:'DELETE'}));
 assert.equal((await f.owner.query('SELECT * FROM origen_checkpoint_text')).rows.length,0);
 assert.deepEqual(await f.run({action:'stop'}),{stopped:true});
 await assert.rejects(f.run({action:'status'}),{message:'account_closed'});
});
