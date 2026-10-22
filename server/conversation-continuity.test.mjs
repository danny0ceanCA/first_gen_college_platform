import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {continuityEnabled,assertContinuityReady,savedSourceEvidence,continuitySnapshot,continuityInstructions,loadQuestionContinuity} from './conversation-continuity.mjs';
import {retrievalTerms} from './history-retrieval.mjs';
import {historyRetrievalCatalog} from '../evals/history-retrieval.cases.v1.mjs';
import {retrievalFixture} from './history-retrieval-fixture.mjs';
import {createProfileVoiceHandler} from './profile-voice.mjs';
import {createLiveMemoryService} from './live-memory.mjs';
import {createCorrectionService,correctionSnapshot} from './binder-corrections.mjs';
import {createPermissionRepository} from './guardian-permission.mjs';
import {voiceContextVersion} from './voice-preparation.mjs';
import {personalizationPolicy} from './personalization-controls.mjs';
import {productionConfigIssues} from './production-config.mjs';
const enabled={skip:!process.env.DATABASE_TEST_URL};
const settings=()=>({OPENAI_API_KEY:'synthetic',ORIGEN_PERSONALIZATION_MODE:'on',ORIGEN_BINDER_CORRECTIONS:'true',ORIGEN_CONVERSATION_CONTINUITY:'true',ORIGEN_VOICE_PREPARATION:'true'});
const now=Date.parse('2026-10-21T12:00:00Z');

test('saved references retain dates without manufacturing official verification or a cycle',()=>{
 const sources=savedSourceEvidence([
  {url:'https://admission.universityofcalifornia.edu/apply',checkedAt:'2025-10-01'},
  {url:'https://studentaid.gov/apply',checkedAt:'2026-10-21T11:00:00Z'},
  {url:'https://example.edu/new',checkedAt:'2099-01-01'},
 ],now);
 assert.deepEqual(sources.map(s=>s.freshness),['stale','recent_unverified','unknown']);
 assert.ok(sources.every(s=>s.requiresFreshLookup&&s.effectivePeriod===null&&s.evidenceClass==='saved_reference'));
 assert.equal(sources[2].recordedCheckedAt,null);
 assert.equal(savedSourceEvidence([{url:'http://example.edu'},{url:'https://a:b@example.edu'},{url:'https://example.edu/?student=secret'},{url:'javascript:alert(1)'}]).length,0);
 assert.ok(JSON.stringify(savedSourceEvidence(Array.from({length:20},(_,i)=>({url:`https://example.edu/${i}/`+'a'.repeat(900)})))).length<=2000);
 const context=continuitySnapshot({profile:{entryTerm:'Fall 2027'},memory:[{id:'one',sources:[{url:sources[0].url,checkedAt:'2025-10-01'}]}],workspace:{notes:[{kind:'question',evidenceRef:'note:open'},{kind:'note',evidenceRef:'note:resolved'}]}},[{key:'work_days',status:'declined',expiresAt:'2026-10-22'},{key:'interests',status:'asked',expiresAt:'2026-10-20'}],now);
 assert.equal(context.applicationCycle,'Fall 2027');assert.deepEqual(context.openQuestionRefs,['note:open']);assert.equal(context.recentQuestions.length,1);
 assert.match(continuityInstructions(context),/recent saved date never waives/);assert.match(continuityInstructions(context),/No automatic search is needed/);
});

test('continuity is gated by server retrieval policy and invalidates prepared/active policy on rollback',async()=>{
 const env=settings();assert.equal(continuityEnabled(env,'reader'),true);const before=personalizationPolicy(env,'reader');env.ORIGEN_CONVERSATION_CONTINUITY='false';assert.equal(continuityEnabled(env,'reader'),false);assert.notEqual(personalizationPolicy(env,'reader'),before);
 assert.equal(continuityEnabled({...settings(),ORIGEN_PERSONALIZATION_RETRIEVAL:'false'},'reader'),false);
 assert.equal(continuityEnabled(settings(),undefined),false);
 await assert.rejects(assertContinuityReady(null,settings()),/configuration_required/);
 assert.ok(productionConfigIssues({...settings(),ORIGEN_BINDER_CORRECTIONS:'false'}).some(x=>x.includes('required for conversation continuity')));
 assert.ok(productionConfigIssues({...settings(),ORIGEN_CONVERSATION_CONTINUITY:'yes'}).some(x=>x.startsWith('ORIGEN_CONVERSATION_CONTINUITY:')));
 assert.deepEqual(retrievalTerms('¿Cuál era el problema con el depósito de renta?'),['depósito','renta']);
 assert.deepEqual(retrievalTerms('¿Qué créditos de química?'),['créditos','química']);
});

test('return conversations use current scoped evidence, respect question state and fence stale preparations',enabled,async t=>{
 const f=await retrievalFixture(),env=settings();
 await f.as('reader',()=>createPermissionRepository(f.db).account('reader',{action:'screen',ageBand:'18plus',audience:'grade9plus'}));
 await f.family('reader',{action:'save-student',student:{id:'alex',name:'Alex',stage:'12th grade',entryTerm:'Fall 2027',interest:'',goals:'',needs:'',gpa:'',color:'peach'}});
 let last,providerCalls=0;
 const handler=createProfileVoiceHandler(env,async(u,o)=>{providerCalls++;last=JSON.parse(o.body.get('session'));return new Response('v=0\r\n');},()=>{},f.db);
 const call=async(extra={},sub='reader',target=handler)=>{
  const req=Object.assign(Readable.from([JSON.stringify({sdp:'v=0\r\n',mode:'planning',studentId:'alex',role:'parent',language:'en',targetConfirmed:true,routeConversations:true,...extra})]),{url:'/api/profile-voice',method:'POST',headers:{'content-type':'application/json',host:'localhost'},origenAuthorized:true,origenIdentity:{sub}});let status,body;
  await f.as(sub,()=>target(req,{writeHead:s=>{status=s;},end:s=>{body=JSON.parse(s);}},()=>{}));return {status,body,prompt:last?.instructions};
 };
 const hold=(student='alex',status='declined',sub='reader')=>f.owner.query("INSERT INTO origen_guidance_questions(account_id,scope_key,student_id,question_key,status) SELECT id,$1,$1,'work_days',$2 FROM origen_accounts WHERE auth0_subject=$3 ON CONFLICT(account_id,scope_key,question_key) DO UPDATE SET status=excluded.status,expires_at=now()+interval '7 days'",[student,status,sub]);
 const change=async(store,row,action,value)=>f.as('reader',()=>createCorrectionService(f.db,env)('reader',{operationId:randomUUID(),store,studentId:'alex',id:row.id,version:row.version,action,before:correctionSnapshot(row,store),...(value?{value}:{})}));
 try{
  await assertContinuityReady(f.db,env);
  await t.test('exact Spanish baseline case finds the redacted stored evidence without lowering match threshold',async()=>{
   const c=historyRetrievalCatalog.cases.find(c=>c.id==='es-renta');await f.save('rent',c.content);
   const result=await f.retrieve(c.query);assert.equal(result.items[0].id,'rent');assert.match(result.items[0].content,/connection code omitted/);
   assert.equal((await f.retrieve('zirconium dragonfly')).items.length,0);
  });
  await t.test('declines and answered prompts persist by account/student and expire',async()=>{
   const version=await f.as('reader',()=>voiceContextVersion(f.db,'reader'));await hold();await hold('sam','answered');await hold('alex','asked','other');
   assert.notEqual(await f.as('reader',()=>voiceContextVersion(f.db,'reader')),version);
   assert.deepEqual((await f.as('reader',()=>loadQuestionContinuity(f.db,'reader','alex'))).map(q=>q.status),['declined']);
   assert.equal((await f.as('reader',()=>loadQuestionContinuity(f.db,'reader',null))).length,0);
   await assert.rejects(f.as('other',()=>loadQuestionContinuity(f.db,'reader','alex')),{status:403});
   await f.owner.query("UPDATE origen_guidance_questions SET expires_at=now()-interval '1 second' WHERE student_id='sam'");
   assert.equal((await f.as('reader',()=>loadQuestionContinuity(f.db,'reader','sam'))).length,0);
  });
  const oldText='I work evenings at the bakery.',newText='I work only Tuesdays and Thursdays.';
  await f.save('old-work',oldText);const revision=(await f.memory({action:'revision',studentId:'alex'})).revision;
  await f.memory({action:'store-proposals',studentId:'alex',summaryId:'old-work',revision,sourceVersion:createHash('sha256').update(JSON.stringify(oldText)).digest('hex'),proposals:[{category:'constraint',content:oldText,quote:oldText,language:'en',speaker:'parent'}]});
  const old=(await f.memory({action:'load',studentId:'alex'})).memories[0];
  await change('memory',old,'update',{category:'constraint',content:newText,language:'en',speaker:'parent'});
  await f.save('private-sibling','SIBLING_SECRET',{studentId:'sam'});await f.save('private-other','OTHER_SECRET',{sub:'other'});
  const noteId=randomUUID();await f.note({action:'create',id:noteId,studentId:'alex',note:{topic:'transfer',kind:'question',content:'Which chemistry class fits?',language:'en'}});
  await f.history({action:'save',item:{id:'old-policy',studentId:'alex',mode:'planning',summary:'The prior application deadline was discussed.',date:'2025-01-01',sources:[{url:'https://www.calstate.edu/apply',title:'Official application page',checkedAt:'2025-01-01'}]}});
  await t.test('a new call gets the correction, open question, cycle and dated policy references; forged context is ignored',async()=>{
   const result=await call({returnContext:{savedReferences:[{url:'FORGED_CONTEXT'}]}});assert.equal(result.status,200,JSON.stringify(result.body));
   assert.match(result.prompt,/RETURN CONVERSATION/);assert.ok(result.prompt.includes(newText));assert.doesNotMatch(result.prompt,/I work evenings at the bakery|SIBLING_SECRET|OTHER_SECRET|FORGED_CONTEXT/);
   assert.match(result.prompt,/Fall 2027/);assert.match(result.prompt,/recentQuestions.*declined/);assert.match(result.prompt,/recordedCheckedAt.*2025-01-01/);assert.match(result.prompt,/requiresFreshLookup.*true/);
   assert.ok(result.prompt.includes(`note:${noteId}`));
   const unresolved=await call({targetConfirmed:false});assert.equal(unresolved.status,200);assert.doesNotMatch(unresolved.prompt,/RETURN CONVERSATION|Tuesdays|Which chemistry/);
  });
  await t.test('question metadata and corrected notes invalidate cached context; removed evidence cannot return',async()=>{
   const prepared=await call({action:'prepare'});assert.ok(prepared.body.preparedContextId);
   await hold('alex','answered');
   const row=(await f.note({action:'load',studentId:'alex'})).notes.find(n=>n.id===noteId);
   await change('note',row,'update',{topic:'transfer',kind:'note',content:'The counselor explained the chemistry choice.',language:'en'});
   const next=await call({preparedContextId:prepared.body.preparedContextId});assert.equal(next.status,200,JSON.stringify(next.body));assert.doesNotMatch(next.prompt,/Which chemistry class fits/);assert.match(next.prompt,/openQuestionRefs.*\[\]/);assert.match(next.prompt,/recentQuestions.*answered/);
   const current=(await f.memory({action:'load',studentId:'alex'})).memories.find(m=>m.id===old.id);await change('memory',current,'delete');
   const deleted=await call();assert.equal(deleted.status,200);assert.ok(!deleted.prompt.includes(newText));assert.ok(!deleted.prompt.includes(oldText));
  });
  await t.test('live recall returns source dates as unverified pointers with the current note kind',async()=>{
   const live=input=>f.as('reader',()=>createLiveMemoryService(f.db,env)('reader',input));
   const revision=(await f.memory({action:'revision',studentId:'alex'})).revision,session=await live({action:'open',studentId:'alex',revision});
   const turn={sessionId:session.id,sequence:1,turnId:'recall',transcript:'What was that application deadline?'};
   await live({...turn,action:'turn',language:'en'});const result=await live({...turn,action:'read',query:'application deadline'});
   assert.equal(result.status,'retrieved');assert.equal(result.continuity.savedReferences[0].requiresFreshLookup,true);assert.match(result.instruction,/fresh official lookup/);
   const note=(await f.retrieve('chemistry',{continuity:true})).items.find(n=>n.id===noteId);assert.equal(note.noteKind,'note');
  });
  await t.test('a concurrent context change during assembly never reaches the provider',async()=>{
   const before=providerCalls;let changed=false;
   const database={connect:async()=>{const c=await f.db.connect();return {...c,query:async(sql,...args)=>{const result=await c.query(sql,...args);if(!changed&&typeof sql==='string'&&sql.startsWith('SELECT question_key,status')){changed=true;await c.query("UPDATE origen_guidance_questions SET status='asked' WHERE student_id='alex'");}return result;}};}};
   const raced=createProfileVoiceHandler(env,async()=>{throw Error('must not negotiate');},()=>{},database);
   const result=await call({},'reader',raced);assert.equal(changed,true);assert.equal(result.status,409);assert.equal(result.body.error,'memory_changed');assert.equal(providerCalls,before);
  });
  await t.test('deleting a saved policy source also removes its continuity references',async()=>{
   const prepared=await call({action:'prepare'});await f.history({action:'delete',id:'old-policy'});
   const result=await call({preparedContextId:prepared.body.preparedContextId});assert.equal(result.status,200);assert.doesNotMatch(result.prompt,/https:\/\/www\.calstate\.edu\/apply|prior application deadline/);
   assert.equal((await f.retrieve('application deadline',{continuity:true})).items.length,0);
  });
  await t.test('rollback drops new metadata and invalidates a prepared context without dropping schema',async()=>{
   const prepared=await call({action:'prepare'});env.ORIGEN_CONVERSATION_CONTINUITY='false';
   const result=await call({preparedContextId:prepared.body.preparedContextId});assert.equal(result.status,200);assert.doesNotMatch(result.prompt,/RETURN CONVERSATION/);
  });
 }finally{await f.close();}
});
