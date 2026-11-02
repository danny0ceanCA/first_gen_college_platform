import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {coordinatorPilotFixture} from './fixtures/coordinator-pilot.mjs';
import {acceptsReview,requestsReview,validateReviewVoice,openReviewVoiceSession,assertReviewVoiceReady} from './review-request-voice.mjs';
import {voiceSession,createProfileVoiceHandler} from './profile-voice.mjs';
import {studentLiveSession} from './student-live-session.mjs';
import {reviewRequestVoiceTools} from '../src/reviewRequestVoiceTools.mjs';
import {exportDeletionManifest,replayDeletionManifest} from '../ops/privacy-recovery.mjs';

test('voice consent accepts explicit English/Spanish approval, never corrections or vague agreement',()=>{
 for(const text of ['Yes.','Yes, please!','Sí, por favor.','Sí, envíalo.','Approve this request.'])assert.equal(acceptsReview(text),true,text);
 for(const text of ['','okay','thanks','maybe yes','yes but change the note','yes? No, not yet.','sí pero cambia eso','do not send it'])assert.equal(acceptsReview(text),false,text);
 for(const text of ['Please ask my coordinator if I might qualify.','Can you send this question to Maria?','I want you to ask my coordinator because I am not sure.','Quiero que compartas esta pregunta porque no tengo seguro.','Pregúntale a mi coordinador sobre el seguro.'])assert.equal(requestsReview(text),true,text);
 for(const text of ['I am worried about aid.','My coordinator mentioned this.','Maybe ask my coordinator.','Do not send this.','Send it? No, never mind.'])assert.equal(requestsReview(text),false,text);
 const input={action:'confirm',sessionId:randomUUID(),sequence:2,turnId:'t',transcript:'yes'};
 assert.deepEqual(validateReviewVoice(input),input);
 for(const change of [{accepted:true},{confirmed:true},{enabled:true},{studentId:'someone'},{requestId:randomUUID()},{action:'open'},{action:'bind'},{action:'state'},{sequence:0},{sequence:1.5},{turnId:''}])assert.throws(()=>validateReviewVoice({...input,...change}),/invalid_review_voice/);
});

test('tools and Live readback instructions require server-owned student capability',async()=>{
 const input={language:'en',role:'student',mode:'planning',studentId:'alex',reviewRequestVoice:true};
 const config=voiceSession(input,{}),live=studentLiveSession(config,input);
 assert.equal(config.tools.filter(t=>t.name.includes('coordinator_review')).length,3);
 assert.match(config.instructions,/Read the returned readback exactly/);
 assert.match(live.instructions,/complete readback verbatim/);
 assert.equal(live.delegation.responses.parallel_tool_calls,false);
 for(const extra of [{reviewRequestVoice:false},{role:'parent'},{mode:'profile',onboarding:true},{role:'parent',routeConversations:true,targetConfirmed:false}])assert.equal(voiceSession({...input,...extra},{}).tools.some(t=>t.name.includes('coordinator_review')),false);
 let sent;
 const handler=createProfileVoiceHandler({OPENAI_API_KEY:'synthetic'},async(_url,options)=>{sent=JSON.parse(options.body.get('session'));return new Response('v=0\r\nanswer');},()=>{});
 const req=Object.assign(Readable.from([JSON.stringify({...input,sdp:'v=0\r\n'})]),{url:'/api/profile-voice',method:'POST',headers:{host:'127.0.0.1:5173',origin:'http://127.0.0.1:5173','content-type':'application/json'}});
 let status,body;await handler(req,{writeHead:s=>status=s,end:s=>body=JSON.parse(s)},()=>assert.fail());
 assert.equal(status,200,JSON.stringify(body));assert.equal(body.reviewVoiceSession,undefined);assert.equal(sent.tools.some(t=>t.name.includes('coordinator_review')),false);
});

test('spoken review requests preserve exact consent, isolation, rollback and held delivery',{skip:!process.env.DATABASE_TEST_URL,timeout:120000},async t=>{
 const f=await coordinatorPilotFixture({reviewRequests:true,reviewVoice:true});t.after(()=>f.close());
 const account=(await f.owner.query("SELECT id FROM origen_accounts WHERE auth0_subject='other'")).rows[0].id,connection=randomUUID();
 await f.owner.query("INSERT INTO origen_binder_connections(id,account_id,student_id,coordinator_id,status,request_id,expires_at,accepted_at,display_name) SELECT $1,$2,'alex',id,'accepted',$3,now()+interval '7 days',now(),'Alex' FROM origen_coordinator_profiles WHERE auth0_subject='staff' AND institution_id=$4",[connection,account,randomUUID(),f.org]);
 const open=()=>f.as('other',()=>openReviewVoiceSession(f.db,f.env,'alex'));
 const notebook=input=>f.call('other','/api/review-requests',{studentId:'alex',...input});
 const count=async table=>(await f.owner.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;
 async function flow({language='en',text=language==='es'?'Pregúntale a mi coordinador si puedo solicitar una exención del seguro.':'Ask my coordinator if I might qualify for an insurance waiver.',entries=[]}={}){
  const session=await open();let sequence=0,turnId,transcript;
  const call=(action,extra={},sub='other')=>f.call(sub,'/api/review-request-voice',{action,sessionId:session.id,...(action==='close'?{}:{sequence,turnId,transcript}),...extra});
  const turn=async value=>{sequence++;turnId=randomUUID();transcript=value;await call('turn',{language});};
  await turn(text);
  const prepare=()=>call('prepare',{requestKey:randomUUID(),connectionId:connection,kind:'question',question:language==='es'?'¿Podría solicitar una exención del seguro?':'Could I qualify for an insurance waiver?',entries});
  return {session,call,turn,prepare};
 }
 await assertReviewVoiceReady(f.runtime,f.env);await assertReviewVoiceReady(null,{});
 await t.test('English and Spanish: exact readback then next-turn approval creates one receipt',async()=>{
  for(const language of ['en','es']){
   const v=await flow({language,entries:[{id:f.notes[1],version:1}]}),choices=await v.call('options');
   assert.equal(choices.connections.length,1);assert.deepEqual(choices.entries,[]);
   const searched=await v.call('options',{topic:'costs'});assert.equal(searched.entries[0].id,f.notes[1]);
   assert.ok(!JSON.stringify(searched).includes('FAMILY_DERIVED_SENTINEL'));
   const p=await v.prepare(),draft=(await notebook({action:'get',id:p.requestId})).request;
   assert.equal(draft.origin,'voice');assert.equal(draft.status,'draft');assert.equal(draft.publication,null);
   assert.match(draft.originalQuestion,language==='es'?/Pregúntale/:/Ask my coordinator/);
   assert.match(p.readback,/staff/);assert.match(p.readback,/Synthetic Community Center/);assert.match(p.readback,/Ask about local scholarships/);
   assert.equal((await v.call('confirm')).status,'approval_required');
   assert.equal((await v.call('present',{presentation:p.readback})).status,'presented');
   await v.turn(language==='es'?'Sí, por favor.':'Yes, please.');
   assert.equal((await v.call('confirm')).status,'queued');assert.equal((await v.call('confirm')).status,'queued');
   const r=(await notebook({action:'get',id:p.requestId})).request;
   assert.equal(r.publication.approvalMethod,'voice');assert.ok(r.publication.readbackAt);assert.equal(r.publication.notification,'pending');
   assert.equal((await f.owner.query("SELECT count(*)::int AS n FROM origen_coordinator_outbox WHERE grant_id=$1 AND kind='review-request'",[r.id])).rows[0].n,1);
   await notebook({action:'withdraw',id:r.id,version:r.version});assert.equal((await v.call('confirm')).status,'withdrawn');await v.call('close');
  }
 });
 await t.test('ordinary conversation cannot prepare a draft or discover private notes',async()=>{
  const v=await flow({text:'I wonder if my coordinator can help.'}),before=await count('origen_review_requests');
  assert.equal((await v.call('options',{topic:'costs'})).status,'not_requested');assert.equal((await v.prepare()).status,'not_requested');assert.equal(await count('origen_review_requests'),before);await v.call('close');
 });
 await t.test('missing, partial, altered or cleared playback never authorizes sharing',async()=>{
  for(const mode of ['missing','partial','different','cleared']){
   const v=await flow(),p=await v.prepare();
   if(mode!=='missing')await v.call('present',{presentation:mode==='partial'?p.readback.slice(0,-30):mode==='different'?p.readback.replace('staff','another coordinator'):p.readback});
   if(mode==='cleared')await v.call('present',{presentation:''});
   await v.turn('Yes');assert.equal((await v.call('confirm')).status,'approval_required');assert.equal((await notebook({action:'get',id:p.requestId})).request.publication,null);await v.call('close');
  }
 });
 await t.test('silence, negative answers, revised questions and delayed yes stay private',async()=>{
  for(const answer of ['', 'No.', 'Yes, but use a different note.', 'Sí, pero cambia la pregunta.', 'late']){
   const v=await flow(),p=await v.prepare();await v.call('present',{presentation:p.readback});
   await v.turn(answer==='late'?'Tell me about scholarships.':answer);
   if(answer==='late')await v.turn('Yes');
   if(answer==='')await assert.rejects(v.call('confirm'),{status:409});else assert.equal((await v.call('confirm')).status,'approval_required');
   assert.equal((await notebook({action:'get',id:p.requestId})).request.status,'draft');await v.call('close');
  }
 });
 await t.test('changed notes and superseded previews invalidate spoken consent',async()=>{
  const id=randomUUID();await f.note({action:'create',studentId:'alex',id,note:{topic:'costs',kind:'note',content:'My current note',language:'en'}},'other');
  for(const mode of ['note','preview']){
   const v=await flow({entries:mode==='note'?[{id,version:1}]:[]}),p=await v.prepare();await v.call('present',{presentation:p.readback});
   if(mode==='note')await f.note({action:'update',studentId:'alex',id,version:1,note:{topic:'costs',kind:'note',content:'Changed private note',language:'en'}},'other');
   else await notebook({action:'preview',id:p.requestId,version:1,wording:'original'});
   await v.turn('Yes');await assert.rejects(v.call('confirm'),{status:409});assert.equal((await notebook({action:'get',id:p.requestId})).request.publication,null);await v.call('close');
  }
 });
 await t.test('oversized readback rolls back draft and preview together',async()=>{
  const entries=[];for(let i=0;i<3;i++){const id=randomUUID();await f.note({action:'create',studentId:'alex',id,note:{topic:'costs',kind:'note',content:'Long private note. '.repeat(120).slice(0,1999),language:'en'}},'other');entries.push({id,version:1});}
  const v=await flow({entries}),before=await count('origen_review_requests');await assert.rejects(v.prepare(),{status:409});assert.equal(await count('origen_review_requests'),before);await v.call('close');
 });
 await t.test('actual client bridge plus HTTP and PostgreSQL records only a fully played next-turn approval',async()=>{
  let changed=0;const tools=reviewRequestVoiceTools({onChanged:()=>changed++,post:async body=>f.call('other','/api/review-request-voice',body)});
  tools.configure(await open());tools.begin('ask');tools.transcript('ask','Ask my coordinator if I might qualify for an insurance waiver.');
  const p=await tools.invoke({name:'prepare_coordinator_review_request',call_id:'p',arguments:JSON.stringify({connectionId:connection,question:'Could I qualify for a waiver?',kind:'question',entries:[]})});
  assert.equal(p.status,'readback_required');
  for(const event of [{type:'response.created',response:{id:'spoken'}},{type:'output_audio_buffer.started',response_id:'spoken'},{type:'response.output_audio_transcript.done',response_id:'spoken',item_id:'audio',transcript:p.readback},{type:'response.done',response:{id:'spoken',status:'completed'}},{type:'output_audio_buffer.stopped',response_id:'spoken'}])tools.event(event);
  tools.event({type:'input_audio_buffer.speech_started',item_id:'yes'});tools.begin('yes');tools.transcript('yes','Yes, please.');
  assert.equal((await tools.invoke({name:'confirm_coordinator_review_request',call_id:'yes-call',arguments:'{}'})).status,'queued');assert.equal(changed,2);tools.stop();
 });
 await t.test('authenticated negotiation and guide updates issue scoped sessions for both providers',async()=>{
  for(const protocol of [undefined,'live-v1']){
   let config;
   const handler=createProfileVoiceHandler({...f.env,OPENAI_API_KEY:'synthetic'},async(_url,options)=>{
    config=protocol?JSON.parse(options.body).session:JSON.parse(options.body.get('session'));
    return protocol?Response.json({transport:{sdp:'v=0\r\nanswer'},session:{id:'synthetic'}}):new Response('v=0\r\nanswer');
   },()=>{},f.db);
   for(const action of [undefined,'update-guide']){
    const input={language:'en',role:'student',mode:'planning',studentId:'alex',sdp:'v=0\r\n',voiceProtocol:protocol,action};
    const req=Object.assign(Readable.from([JSON.stringify(input)]),{url:'/api/profile-voice',method:'POST',headers:{'content-type':'application/json'},origenAuthorized:true,origenIdentity:{sub:'other'}});
    let status,body;await f.as('other',()=>handler(req,{writeHead:s=>status=s,end:s=>body=JSON.parse(s)},()=>assert.fail()));
    assert.equal(status,200,JSON.stringify(body));assert.ok(body.reviewVoiceSession?.id);
    const tools=action?body.session.tools:protocol?config.delegation.responses.tools:config.tools;
    assert.ok(tools.some(t=>t.name==='prepare_coordinator_review_request'));
    const row=(await f.owner.query('SELECT student_id,account_id FROM origen_review_voice_sessions WHERE id=$1',[body.reviewVoiceSession.id])).rows[0];
    assert.equal(row.student_id,'alex');assert.equal(row.account_id,account);
    await f.call('other','/api/review-request-voice',{action:'close',sessionId:body.reviewVoiceSession.id});
   }
  }
 });
 await t.test('stale playback, expired session and permission revision are refused',async()=>{
  for(const mode of ['playback','session','permission']){
   const v=await flow(),p=await v.prepare();await v.call('present',{presentation:p.readback});await v.turn('Yes');
   if(mode==='playback')await f.owner.query("UPDATE origen_review_voice_sessions SET presented_at=now()-interval '3 minutes' WHERE id=$1",[v.session.id]);
   if(mode==='session')await f.owner.query("UPDATE origen_review_voice_sessions SET expires_at=now()-interval '1 second' WHERE id=$1",[v.session.id]);
   if(mode==='permission')await f.owner.query('UPDATE origen_eligibility SET revision=revision+1 WHERE subject_hash=$1',[createHash('sha256').update('other').digest('hex')]);
   if(mode==='playback')assert.equal((await v.call('confirm')).status,'approval_required');else await assert.rejects(v.call('confirm'),{status:mode==='session'?409:403});await v.call('close');
  }
 });
 await t.test('other accounts, parent role, forged tool authority and direct table access fail',async()=>{
  const v=await flow();
  await assert.rejects(v.call('options',{},'reader'),{status:404});
  for(const extra of [{accepted:true},{enabled:true},{studentId:'sam'}])await assert.rejects(v.call('confirm',extra),{status:400});
  await assert.rejects(f.as('other',()=>f.db.query('SELECT * FROM origen_review_voice_sessions')),{code:'42501'});
  await f.owner.query("UPDATE origen_accounts SET role='parent' WHERE id=$1",[account]);
  assert.equal(await open(),undefined);await assert.rejects(v.call('options'),{status:403});
  await f.owner.query("UPDATE origen_accounts SET role='student' WHERE id=$1",[account]);await v.call('close');
 });
 await t.test('rollout pause allows close; maintenance and restore discard temporary consent',async()=>{
  const v=await flow();f.env.ORIGEN_REVIEW_REQUEST_VOICE='false';
  assert.equal(await open(),undefined);await assert.rejects(v.call('options'),{status:503});assert.equal((await v.call('close')).status,'closed');f.env.ORIGEN_REVIEW_REQUEST_VOICE='true';
  await f.sweep();assert.equal(await count('origen_review_voice_sessions'),0);
  const fresh=await flow();assert.ok(fresh.session.id);const manifest=await exportDeletionManifest(f.owner);await replayDeletionManifest(f.owner,manifest);assert.equal(await count('origen_review_voice_sessions'),0);
 });

});
