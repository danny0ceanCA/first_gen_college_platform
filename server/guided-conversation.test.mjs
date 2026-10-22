import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {chooseGuidanceQuestion,spokenCorrectionIntent,assertGuidedConversationReady,guidanceQuestions} from './guided-conversation.mjs';
import {createLiveMemoryRepository,validateLiveMemoryRequest} from './live-memory.mjs';
import {retrievalFixture} from './history-retrieval-fixture.mjs';
import {createPrivacyRepository} from './privacy-controls.mjs';
import {createProfileVoiceHandler} from './profile-voice.mjs';
import {createPermissionRepository} from './guardian-permission.mjs';
import {voicePresentation} from '../src/voicePresentation.mjs';
import {voiceMemoryTools} from '../src/voiceMemoryTools.mjs';
import {createLifecycleRepository} from './account-lifecycle.mjs';
import {exportDeletionManifest,replayDeletionManifest} from '../ops/privacy-recovery.mjs';
const env={ORIGEN_PERSONALIZATION_MODE:'on',ORIGEN_BINDER_CORRECTIONS:'true',ORIGEN_GUIDED_CONVERSATION:'true'};
const enabled={skip:!process.env.DATABASE_TEST_URL};

test('gap policy selects one relevant question, uses known context and respects recent declines',()=>{
 for(const [transcript,content] of [['Which classes fit my schedule?','I work evenings.'],['¿Qué clases caben en mi horario?','Trabajo por las tardes.']]){
  const base={topic:'transfer',transcript,memories:[{category:'constraint',content}]};
  assert.equal(chooseGuidanceQuestion(base),'work_days');
  assert.equal(chooseGuidanceQuestion({...base,held:['work_days']}),null);
  assert.equal(chooseGuidanceQuestion({...base,notes:[{kind:'note',content:'I work Tuesdays and Thursdays.'}]}),null);
  assert.equal(chooseGuidanceQuestion({...base,profile:{needs:'I work Tuesdays and Thursdays.'}}),null);
  assert.equal(chooseGuidanceQuestion({...base,notes:[{kind:'note',content:'The library opens Mondays.'}]}),'work_days');
  assert.equal(chooseGuidanceQuestion({...base,memories:[{category:'constraint',content:'I might work Tuesdays.'}]}),'work_days');
 }
 assert.equal(chooseGuidanceQuestion({topic:'costs',transcript:'How do I apply for FAFSA?'}),'aid_progress');
 assert.equal(chooseGuidanceQuestion({topic:'costs',transcript:'How do I apply for FAFSA?',memories:[{category:'constraint',content:'I have submitted FAFSA.'}]}),null);
 assert.equal(chooseGuidanceQuestion({topic:'applications',transcript:'What application deadline applies?',profile:{entryTerm:'Fall 2027'}}),null);
 assert.equal(chooseGuidanceQuestion({topic:'applications',transcript:'What application deadline applies?'}),'entry_term');
 assert.equal(chooseGuidanceQuestion({topic:'options',transcript:'What should I study?'}),'interests');
 assert.equal(chooseGuidanceQuestion({topic:'options',transcript:'What should I study?',memories:[{category:'goal',content:'Maybe nursing.'}]}),null);
 for(const topic of ['options','transfer','costs','applications'])assert.equal(chooseGuidanceQuestion({topic,transcript:'What does a college major mean?'}),null);
});
test('natural corrections require grounded replacement text; deletions and decisions always need confirmation',()=>{
 const old={content:'I work evenings.',kind:'note'},change={kind:'update',content:'I work Tuesdays and Thursdays.'};
 assert.equal(spokenCorrectionIntent('Actually, I work Tuesdays and Thursdays.',change,old),'clarify');
 assert.equal(spokenCorrectionIntent('En realidad, trabajo los martes.',{...change,content:'Trabajo los martes.'},old),'clarify');
 assert.equal(spokenCorrectionIntent('Actually, I work Tuesdays.',change,old),'not_requested');
 assert.equal(spokenCorrectionIntent('Actually, maybe engineering.',{...change,content:'engineering'},old),'not_requested');
 assert.equal(spokenCorrectionIntent('En realidad, tal vez ingeniería.',{...change,content:'ingeniería'},old),'not_requested');
 assert.equal(spokenCorrectionIntent('I work Tuesdays and Thursdays.',change,old),'not_requested');
 assert.equal(spokenCorrectionIntent('Actually, do I work Tuesdays?',{...change,content:'I work Tuesdays'},old),'not_requested');
 assert.equal(spokenCorrectionIntent('Forget I work evenings.',{kind:'delete'},old),'clarify');
 const exact=`Change ${old.content} to ${change.content}`;
 assert.equal(spokenCorrectionIntent(exact,change,old),'authorized');
 assert.equal(spokenCorrectionIntent(exact,change,{...old,kind:'decision'}),'clarify');
 assert.throws(()=>validateLiveMemoryRequest({action:'question',sessionId:randomUUID(),sequence:1,turnId:'x',transcript:'x',topic:'costs',studentId:'other'}),{status:400});
});
test('presentation requires complete playback and rejects cancellation, interruption, stale and duplicate delivery',()=>{
 let seq=1,audible=true;const heard=[],p=voicePresentation(text=>heard.push(text),()=>seq,()=>audible);
 const emit=(type,id='a',extra={})=>p.event({type,response_id:id,...extra});
 const start=id=>emit('response.created',id,{response:{id}});
 const transcript=id=>emit('response.output_audio_transcript.done',id,{item_id:id,transcript:'Should I save this exact correction?'});
 start('a');transcript('a');emit('response.done','a',{response:{id:'a',status:'completed'}});assert.equal(heard.length,0);
 emit('output_audio_buffer.started');emit('output_audio_buffer.stopped');assert.equal(heard.length,1);emit('output_audio_buffer.stopped');assert.equal(heard.length,1);
 start('b');transcript('b');emit('output_audio_buffer.started','b');emit('input_audio_buffer.speech_started','b');emit('response.done','b',{response:{id:'b',status:'completed'}});emit('output_audio_buffer.stopped','b');assert.equal(heard.length,1);
 start('c');transcript('c');emit('output_audio_buffer.started','c');emit('response.done','c',{response:{id:'c',status:'cancelled'}});emit('output_audio_buffer.stopped','c');assert.equal(heard.length,1);
 start('d');transcript('d');seq++;emit('output_audio_buffer.started','d');emit('response.done','d',{response:{id:'d',status:'completed'}});emit('output_audio_buffer.stopped','d');assert.equal(heard.length,1);
 start('e');emit('output_audio_buffer.started','e');emit('output_audio_buffer.stopped','e');emit('response.done','e',{response:{id:'e',status:'completed'}});transcript('e');assert.equal(heard.length,2);
 audible=false;start('blocked');transcript('blocked');emit('output_audio_buffer.started','blocked');emit('response.done','blocked',{response:{id:'blocked',status:'completed'}});emit('output_audio_buffer.stopped','blocked');assert.equal(heard.length,2);
});
test('client delivers gap questions only after playback and registers the next turn after presentation',async()=>{
 const requests=[],client=voiceMemoryTools({post:async body=>{requests.push(body);return body.action==='question'?{status:'question',key:'work_days'}:{status:'registered'};}});
 client.configure({id:randomUUID(),revision:0});client.transcript('u1','Which classes fit?');
 await client.invoke({name:'get_guidance_question',call_id:'q',arguments:'{"topic":"transfer"}'});
 client.event({type:'response.created',response:{id:'r'}});client.event({type:'response.output_audio_transcript.done',response_id:'r',item_id:'a',transcript:guidanceQuestions.work_days.en});assert.equal(requests.filter(r=>r.action==='question-present').length,0);
 client.event({type:'output_audio_buffer.started',response_id:'r'});client.event({type:'response.done',response:{id:'r',status:'completed'}});client.event({type:'output_audio_buffer.stopped',response_id:'r'});client.transcript('u2','Skip this');
 await client.invoke({name:'get_guidance_question',call_id:'q2',arguments:'{"topic":"transfer"}'});
 assert.ok(requests.findIndex(r=>r.action==='question-present')<requests.findIndex(r=>r.turnId==='u2'));
 assert.equal(requests.filter(r=>r.action==='write').length,0);client.stop();
});

test('guided conversation uses scoped metadata and atomic binder corrections',enabled,async t=>{
 const f=await retrievalFixture();t.after(()=>f.close());const run=input=>f.as('reader',()=>createLiveMemoryRepository(f.db,env)('reader',input));
 await f.as('reader',()=>createPermissionRepository(f.db).account('reader',{action:'screen',ageBand:'18plus',audience:'grade9plus'}));
 const open=async(studentId='alex')=>run({action:'open',studentId,revision:(await f.memory({action:'revision',studentId})).revision});
 const turn=async(s,n,transcript,language='en')=>{const base={sessionId:s.id,sequence:n,turnId:'turn-'+n,transcript};await run({...base,action:'turn',language});return base;};
 const write=(base,change,requestId=randomUUID())=>run({...base,action:'write',change,requestId});
 const makeMemory=async content=>{const id=randomUUID();await f.memory({action:'create',studentId:'alex',id,memory:{category:'constraint',content,language:'en',speaker:'student'}});return (await f.memory({action:'load',studentId:'alex'})).memories.find(m=>m.id===id);};
 await assertGuidedConversationReady(f.db,env);await assert.rejects(assertGuidedConversationReady(f.db,{...env,ORIGEN_BINDER_CORRECTIONS:'false'}));
 await t.test('the stored entry term uses the effective profile field mapping',async()=>{
  const student={id:'alex',name:'Alex',stage:'12th grade',interest:'',gpa:'',color:'peach',entryTerm:'Fall 2027'};
  await f.family('reader',{action:'save-student',student});const s=await open(),base=await turn(s,1,'What application deadline applies?');assert.equal((await run({...base,action:'question',topic:'applications'})).status,'no_question');
  await f.family('reader',{action:'save-student',student:{...student,entryTerm:''}});
 });
 await t.test('known, skipped and answered questions are scoped, content-free and do not save answers',async()=>{
  await makeMemory('I work evenings.');const s=await open(),base=await turn(s,1,'Which classes fit my schedule?');
  const q=await run({...base,action:'question',topic:'transfer'});assert.equal(q.key,'work_days');assert.deepEqual(await run({...base,action:'question',topic:'transfer'}),q);
  assert.equal((await run({...base,action:'question-present',key:q.key,presentation:'An unrelated question?'})).status,'not_presented');
  assert.equal((await run({...base,action:'question-present',key:q.key,presentation:q.question})).status,'presented');
  const declined=await turn(s,2,'I would rather not share that.');assert.equal((await run({...declined,action:'question',topic:'transfer'})).status,'no_question');
  assert.equal((await f.owner.query('SELECT status FROM origen_guidance_questions')).rows[0].status,'declined');
  const later=await open();assert.equal((await run({...await turn(later,1,'Which classes fit my schedule?'),action:'question',topic:'transfer'})).status,'no_question');
  const sibling=await open('sam'),other=await turn(sibling,1,'Trabajo por las tardes. ¿Qué clases puedo tomar?','es');const sq=await run({...other,action:'question',topic:'transfer'});assert.equal(sq.question,guidanceQuestions.work_days.es);
  await run({...other,action:'question-present',key:sq.key,presentation:sq.question});await turn(sibling,2,'Trabajo los martes y jueves.','es');
  assert.equal((await f.owner.query("SELECT status FROM origen_guidance_questions WHERE student_id='sam'")).rows[0].status,'answered');assert.equal((await f.memory({action:'load',studentId:'sam'})).memories.length,0);
  assert.doesNotMatch(JSON.stringify((await f.owner.query('SELECT * FROM origen_guidance_questions')).rows),/martes|rather|evenings/);
  assert.equal((await f.as('other',()=>f.db.query('SELECT * FROM origen_guidance_questions'))).rows.length,0);
  await f.owner.query("UPDATE origen_guidance_questions SET expires_at=now()-interval '1 second'");
  const fresh=await open();assert.equal((await run({...await turn(fresh,1,'Which classes fit my schedule?'),action:'question',topic:'transfer'})).status,'question');
 });
 await t.test('English and Spanish natural corrections require exact readback and keep original attribution',async()=>{
  for(const [language,content,prefix,yes] of [['en','I work Tuesdays and Thursdays.','Actually, ','Yes, save it'],['es','Trabajo los lunes.','En realidad, ','Sí, guárdalo']]){
   const old=await makeMemory(language==='en'?'My previous work schedule.':'Mi horario anterior de trabajo.');
   const s=await open(),base=await turn(s,1,prefix+content,language),change={store:'memory',kind:'update',id:old.id,version:old.version,content};
   assert.equal((await write(base,change)).status,'clarification_required');assert.equal((await write(await turn(s,2,yes,language),change)).status,'not_requested');
   const again=await turn(s,3,prefix+content,language);await write(again,change);
   if(language==='en')assert.equal((await run({...again,action:'present',change,presentation:`Should I not save ${old.content} to ${content}?`})).status,'not_presented');
   await run({...again,action:'present',change,presentation:language==='en'?`Change ${old.content} to ${content} and save it?`:`¿Quieres cambiar ${old.content} a ${content} y guardar?`});
   const accepted=await turn(s,4,yes,language),requestId=randomUUID();const [one,two]=await Promise.all([write(accepted,change,requestId),write(accepted,change,requestId)]);assert.equal(one.status,'saved');assert.equal(two.id,one.id);
   const current=(await f.memory({action:'load',studentId:'alex'})).memories.find(m=>m.id===old.id);assert.equal(current.version,old.version+1);assert.equal(current.reportedBy,old.reportedBy);assert.equal(current.speaker,old.speaker);
   assert.equal((await f.owner.query('SELECT count(*)::int AS n FROM origen_binder_changes WHERE operation_id=$1',[requestId])).rows[0].n,1);
  }
 });
 await t.test('topic-note corrections preserve identity and uncertainty; removal is confirmed separately',async()=>{
  const id=randomUUID();await f.note({action:'create',studentId:'alex',id,note:{topic:'options',kind:'note',content:'Maybe nursing.',language:'en'}});
  const s=await open(),base=await turn(s,1,'Actually, maybe engineering.'),change={store:'note',kind:'update',id,version:1,content:'Maybe engineering.'};
  assert.equal((await write(base,change)).status,'clarification_required');await run({...base,action:'present',change,presentation:'Change Maybe nursing. to Maybe engineering. and save it?'});
  assert.equal((await write(await turn(s,2,'Yes, save it'),change)).status,'saved');
  const row=(await f.owner.query('SELECT * FROM origen_topic_notes WHERE id=$1',[id])).rows[0];assert.equal(row.content,'Maybe engineering.');assert.equal(row.kind,'note');assert.equal(row.version,2);
  const next=await open(),removal=await turn(next,1,'Delete Maybe engineering.'),remove={store:'note',kind:'delete',id,version:2};assert.equal((await write(removal,remove)).status,'clarification_required');
  await run({...removal,action:'present',change:remove,presentation:'Should I delete Maybe engineering.?'});assert.equal((await write(await turn(next,2,'Yes'),remove)).status,'saved');assert.equal((await f.owner.query('SELECT * FROM origen_topic_notes WHERE id=$1',[id])).rows.length,0);
 });
 await t.test('ambiguity, stale versions, changed scope, disabled gates and cancelled transactions cannot write',async()=>{
  const old=await makeMemory('Duplicate current fact.'),other=await makeMemory(old.content),s=await open(),base=await turn(s,1,'Change Duplicate current fact. to Exact new fact.');
  const change={store:'memory',kind:'update',id:old.id,version:1,content:'Exact new fact.'};assert.equal((await write(base,change)).status,'target_ambiguous');
  await f.memory({action:'delete',studentId:'alex',id:other.id,version:1});await assert.rejects(write(base,change),{status:409});
  const fresh=await open(),b=await turn(fresh,1,'Change Duplicate current fact. to Exact new fact.');
  await assert.rejects(f.as('other',()=>createLiveMemoryRepository(f.db,env)('other',{...b,action:'write',requestId:randomUUID(),change})),{status:409});
  await assert.rejects(f.as('reader',()=>createLiveMemoryRepository(f.db,{...env,ORIGEN_GUIDED_CONVERSATION:'false'})('reader',{...b,action:'question',topic:'costs'})),{status:503});
  const abort=new AbortController(),requestId=randomUUID(),db={connect:async()=>{const c=await f.db.connect();return {...c,query:async(sql,...args)=>{const result=await c.query(sql,...args);if(String(sql).startsWith('INSERT INTO origen_live_memory_receipts'))abort.abort();return result;}};}};
  await assert.rejects(f.as('reader',()=>createLiveMemoryRepository(db,env)('reader',{...b,action:'write',requestId,change},{signal:abort.signal})),{name:'AbortError'});
  assert.equal((await f.owner.query('SELECT * FROM origen_binder_changes WHERE operation_id=$1',[requestId])).rows.length,0);assert.equal((await f.memory({action:'load',studentId:'alex'})).memories.find(m=>m.id===old.id).version,1);
 });
 await t.test('expired proposals cannot save and flag rollback retains Phase 3 correction safeguards',async()=>{
  const old=await makeMemory('An old work preference.'),s=await open(),base=await turn(s,1,'Actually, I work Fridays.'),change={store:'memory',kind:'update',id:old.id,version:1,content:'I work Fridays.'};
  await write(base,change);await run({...base,action:'present',change,presentation:'Change An old work preference. to I work Fridays. and save it?'});
  await run({...base,action:'present',change,presentation:'Would you like another example?'});assert.equal((await f.owner.query('SELECT proposal_presented FROM origen_live_memory_sessions WHERE id=$1',[s.id])).rows[0].proposal_presented,false);
  await run({...base,action:'present',change,presentation:'Change An old work preference. to I work Fridays. and save it?'});
  await f.owner.query("UPDATE origen_live_memory_sessions SET proposal_at=now()-interval '3 minutes' WHERE id=$1",[s.id]);
  assert.equal((await write(await turn(s,2,'Yes, save it'),change)).status,'not_requested');
  const fresh=await open(),b=await turn(fresh,1,'Change An old work preference. to I work Fridays.'),requestId=randomUUID();
  const result=await f.as('reader',()=>createLiveMemoryRepository(f.db,{...env,ORIGEN_GUIDED_CONVERSATION:'false'})('reader',{...b,action:'write',requestId,change:{kind:'update',id:old.id,version:1,content:'I work Fridays.',category:'constraint'}}));
  assert.equal(result.status,'saved');assert.equal((await f.owner.query('SELECT * FROM origen_binder_changes WHERE operation_id=$1',[requestId])).rows.length,1);
 });
 await t.test('privacy erasure clears question metadata and closes outstanding capabilities',async()=>{
  const privacy=input=>f.as('reader',()=>createPrivacyRepository(f.db)('reader',input)),s=await open();const preview=await privacy({action:'preview',categories:['memories'],studentId:'alex'});await privacy({action:'erase',categories:['memories'],studentId:'alex',revision:preview.revision,confirmation:'DELETE'});
  assert.equal((await f.owner.query("SELECT * FROM origen_guidance_questions WHERE student_id='alex'")).rows.length,0);await assert.rejects(turn(s,1,'Late question'),{status:409});
 });
 await t.test('export includes question metadata and recovery discards restored questions and confirmations',async()=>{
  const s=await open(),base=await turn(s,1,'How do I apply for FAFSA?'),q=await run({...base,action:'question',topic:'costs'});await run({...base,action:'question-present',key:q.key,presentation:q.question});
  const exported=await f.as('reader',()=>createLifecycleRepository(f.db)('reader',{action:'export'}));assert.ok(exported.guidanceQuestions.some(row=>row.question_key==='aid_progress'));
  const manifest=await exportDeletionManifest(f.owner);await replayDeletionManifest(f.owner,manifest);
  assert.equal((await f.owner.query('SELECT * FROM origen_guidance_questions')).rows.length,0);assert.equal((await f.owner.query('SELECT * FROM origen_live_memory_sessions')).rows.length,0);
 });
});

test('voice advertises guided capabilities only through server gates and confirmed scope',enabled,async t=>{
 const f=await retrievalFixture();t.after(()=>f.close());
 for(const on of [false,true])for(const confirmed of [false,true]){
  let config;const handler=createProfileVoiceHandler({...env,ORIGEN_GUIDED_CONVERSATION:String(on),OPENAI_API_KEY:'synthetic'},async(u,o)=>{config=JSON.parse(o.body.get('session'));return new Response('v=0\r\n');},()=>{},f.db);
  const req=Readable.from([JSON.stringify({sdp:'v=0\r\n',language:'en',role:'parent',mode:'planning',routeConversations:true,targetConfirmed:confirmed,studentId:'alex',enableLiveMemory:true,guidedConversation:true})]);Object.assign(req,{url:'/api/profile-voice',method:'POST',headers:{'content-type':'application/json',host:'localhost'},origenAuthorized:true,origenIdentity:{sub:'reader'}});let status;
  await f.as('reader',()=>handler(req,{writeHead:s=>{status=s;},end:()=>{}},()=>{}));assert.equal(status,200);assert.equal(config.tools.some(t=>t.name==='get_guidance_question'),on&&confirmed);assert.equal(config.tools.some(t=>t.name==='correct_binder_item'),on&&confirmed);
 }
});
