import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {coordinatorPilotFixture} from './fixtures/coordinator-pilot.mjs';
import {validateReviewRequest} from './review-requests.mjs';
import {validateReviewVoice,openReviewVoiceSession} from './review-request-voice.mjs';
import {createLifecycleRepository} from './account-lifecycle.mjs';
import {exportDeletionManifest,replayDeletionManifest} from '../ops/privacy-recovery.mjs';
import {createProfileVoiceHandler} from './profile-voice.mjs';
import {createReviewRequestRepository} from './review-requests.mjs';
const enabled={skip:!process.env.DATABASE_TEST_URL,timeout:90000};
const ref=(id,responseVersion=1)=>({kind:'review-response',requestId:id,responseVersion});
async function fixture(t){
 const f=await coordinatorPilotFixture({reviewRequests:true,reviewDelivery:true,reviewVoice:true});t.after(()=>f.close());
 Object.assign(f.env,{ORIGEN_REVIEW_RESPONSE_CONTEXT:'true',ORIGEN_PERSONALIZATION_MODE:'on'});
 const account=(await f.owner.query("SELECT id FROM origen_accounts WHERE auth0_subject='other'")).rows[0].id,connection=randomUUID();
 await f.owner.query("INSERT INTO origen_binder_connections(id,account_id,student_id,coordinator_id,status,request_id,expires_at,accepted_at,display_name) SELECT $1,$2,'alex',id,'accepted',$3,now()+interval '7 days',now(),'Alex' FROM origen_coordinator_profiles WHERE auth0_subject='staff' AND institution_id=$4",[connection,account,randomUUID(),f.org]);
 const student=input=>f.call('other','/api/review-requests',{studentId:'alex',...input});
 const staff=input=>f.call('staff','/api/coordinator-review-requests',{organizationId:f.org,...input});
 const input=(relatedResponse,extra={})=>({action:'create',requestKey:randomUUID(),connectionId:connection,origin:'notebook',language:'en',kind:'question',originalQuestion:relatedResponse?'Which document should I request from my employer?':'Which insurance waiver documents are accepted?',proposedClarification:'',entries:[],...(relatedResponse?{relatedResponse}:{}),...extra});
 const preview=async r=>(await student({action:'preview',id:r.id,version:1,wording:'original'})).preview;
 const submit=async(r,p)=>(await student({action:'submit',id:r.id,version:1,previewId:p.id,digest:p.digest,confirmed:true})).request;
 const reply=(r,version=0)=>staff({action:'respond',id:r.id,publicationId:r.publication.id,version,operationId:randomUUID(),guidance:'RESPONSE_BODY_MUST_NOT_BE_COPIED: Check the campus coverage requirements.',suggestedAction:'Ask your employer for proof.',resourceUrl:'https://example.edu/private-response-resource',followUpOn:'2027-03-01'});
 const make=async relatedResponse=>{const d=(await student(input(relatedResponse))).request,r=await submit(d,await preview(d));await f.sweep();await reply(r);return r;};
 const voice=async(language='en')=>{
  const session=await f.as('other',()=>openReviewVoiceSession(f.db,f.env,'alex'));let sequence=0,turnId,transcript;
  const call=(action,extra={})=>f.call('other','/api/review-request-voice',{action,sessionId:session.id,...(action==='close'?{}:{sequence,turnId,transcript}),...extra});
  const turn=async text=>{sequence++;turnId=randomUUID();transcript=text;await call('turn',{language});};
  await turn(language==='es'?'Pregúntale a mi coordinador cuál documento necesito de mi trabajo.':'Ask my coordinator which document I need from my employer.');
  return {call,turn,prepare:source=>call('prepare',{requestKey:randomUUID(),connectionId:connection,kind:'question',question:language==='es'?'¿Cuál documento necesito de mi trabajo?':'Which document do I need from my employer?',entries:[],relatedResponse:source})};
 };
 return {...f,account,connection,student,staff,input,preview,submit,reply,make,voice};
}
test('follow-up contracts accept identity only and never client-supplied context or approval',()=>{
 const source=ref(randomUUID()),input={action:'create',studentId:'alex',requestKey:randomUUID(),connectionId:randomUUID(),origin:'notebook',language:'en',kind:'question',originalQuestion:'Which proof?',entries:[],relatedResponse:source};
 assert.deepEqual(validateReviewRequest(input).relatedResponse,source);
 for(const relatedResponse of [null,{...source,responseVersion:0},{...source,question:'FORGED'},{...source,confirmed:true}])assert.throws(()=>validateReviewRequest({...input,relatedResponse}),{status:400});
 assert.throws(()=>validateReviewVoice({action:'confirm',sessionId:randomUUID(),sequence:2,turnId:'t',transcript:'Yes',relatedResponse:source}),{status:400});
});
test('notebook follow-up shares only its exact approved question, selected notes and bounded source reference, once',enabled,async t=>{
 const f=await fixture(t),parent=await f.make(),source=ref(parent.id),input=f.input(source,{entries:[{id:f.notes[1],version:1}]});
 const d=(await f.student(input)).request;assert.equal(d.status,'draft');assert.equal(d.publication,null);assert.deepEqual(d.relatedResponse.source,source);
 assert.equal((await f.student(input)).request.id,d.id);await assert.rejects(f.student({...input,relatedResponse:ref(parent.id,2)}),{status:409});
 await assert.rejects(f.student({...input,relatedResponse:undefined}),{status:409});
 assert.equal((await f.staff({action:'list'})).requests.some(r=>r.id===d.id),false);
 const p=await f.preview(d);assert.deepEqual(p.selection.relatedResponse.source,source);assert.equal(p.selection.relatedResponse.question,parent.originalQuestion);assert.equal(p.selection.entries.length,1);
 assert.ok(!JSON.stringify(p).includes('RESPONSE_BODY_MUST_NOT_BE_COPIED'));assert.ok(!JSON.stringify(p).includes('private-response-resource'));assert.ok(!JSON.stringify(p).includes('FAMILY_DERIVED_SENTINEL'));
 const submitted=await f.submit(d,p);assert.equal(submitted.publication.notification,'pending');await f.submit(d,p);
 await assert.rejects(f.staff({action:'read',id:d.id}),{status:404});await f.sweep();
 const shared=await f.staff({action:'read',id:d.id});assert.deepEqual(shared.relatedResponse,p.selection.relatedResponse);assert.equal(shared.question,input.originalQuestion);assert.equal(shared.entries.length,1);
 assert.equal((await f.owner.query("SELECT count(*)::int n FROM origen_coordinator_outbox WHERE grant_id=$1 AND kind='review-request'",[d.id])).rows[0].n,1);
 assert.ok(!JSON.stringify(shared).includes('studentActivity'));assert.ok(!JSON.stringify(shared).includes('reviewOn'));
});
test('source changes invalidate previews, queued delivery and delivered access without rewriting private questions',enabled,async t=>{
 const f=await fixture(t);
 for(const stage of ['preview','queued','delivered']){
  const parent=await f.make(),d=(await f.student(f.input(ref(parent.id)))).request,p=await f.preview(d);
  if(stage!=='preview')await f.submit(d,p);if(stage==='delivered')await f.sweep();
  await f.reply(parent,1);
  const kept=(await f.student({action:'get',id:d.id})).request;assert.equal(kept.originalQuestion,d.originalQuestion);assert.equal(kept.relatedResponse.availability,'unavailable');assert.equal(kept.relatedResponse.source,null);assert.equal(kept.relatedResponse.question,undefined);
  if(stage==='preview'){await assert.rejects(f.submit(d,p),{status:409});await assert.rejects(f.preview(d),{status:409});}
  else{assert.equal(kept.publication.access,'unavailable');assert.deepEqual((await f.owner.query('SELECT payload FROM origen_review_request_publications WHERE request_id=$1',[d.id])).rows[0].payload,{});await f.sweep();await assert.rejects(f.staff({action:'read',id:d.id}),{status:404});assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_coordinator_notifications WHERE grant_id=$1',[d.id])).rows[0].n,0);}
  const fresh=(await f.student(f.input(ref(parent.id,2)))).request;assert.equal((await f.preview(fresh)).selection.relatedResponse.responseVersion,2);
 }
});
test('scope, recipient, historical sources and pause controls cannot create or silently retarget a linked request',enabled,async t=>{
 const f=await fixture(t),parent=await f.make(),source=ref(parent.id),before=(await f.owner.query('SELECT count(*)::int n FROM origen_review_requests')).rows[0].n;
 for(const extra of [{studentId:'sam'},{relatedResponse:ref(parent.id,2)},{relatedResponse:ref(randomUUID())},{connectionId:randomUUID()}])await assert.rejects(f.student(f.input(source,extra)));
 const otherConnection=randomUUID();await f.owner.query("INSERT INTO origen_binder_connections(id,account_id,student_id,coordinator_id,status,request_id,expires_at,accepted_at,display_name) SELECT $1,c.account_id,c.student_id,p.id,'accepted',$2,c.expires_at,c.accepted_at,c.display_name FROM origen_binder_connections c JOIN origen_coordinator_profiles p ON p.auth0_subject='colleague' AND p.institution_id=$4 WHERE c.id=$3",[otherConnection,randomUUID(),f.connection,f.org]);
 await assert.rejects(f.student(f.input(source,{connectionId:otherConnection})),{status:409});
 assert.notEqual((await f.request('reader','/api/review-requests',{...f.input(source),studentId:'alex'})).status,200);
 assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_review_requests')).rows[0].n,before);
 f.env.ORIGEN_REVIEW_RESPONSE_CONTEXT='false';await assert.rejects(f.student(f.input(source)),{status:503});f.env.ORIGEN_REVIEW_RESPONSE_CONTEXT='true';
 const draft=(await f.student(f.input(source))).request,p=await f.preview(draft);f.env.ORIGEN_REVIEW_RESPONSE_CONTEXT='false';await assert.rejects(f.submit(draft,p),{status:503});f.env.ORIGEN_REVIEW_RESPONSE_CONTEXT='true';
 await f.student({action:'withdraw',id:parent.id,version:2});await assert.rejects(f.student(f.input(source)),{status:409});assert.equal((await f.student({action:'get',id:draft.id})).request.relatedResponse.availability,'unavailable');
});
test('the linked reference includes approved wording only and stays locked through the approval transaction',enabled,async t=>{
 const f=await fixture(t),d=(await f.student(f.input(undefined,{originalQuestion:'Please ask whether my insurance qualifies.',proposedClarification:'Could my work coverage qualify for a campus waiver?'}))).request;
 const p=(await f.student({action:'preview',id:d.id,version:1,wording:'clarification'})).preview,parent=await f.submit(d,p);await f.sweep();await f.reply(parent);
 const child=(await f.student(f.input(ref(parent.id)))).request,preview=await f.preview(child);assert.equal(preview.selection.relatedResponse.question,p.selection.question);assert.notEqual(preview.selection.relatedResponse.question,parent.originalQuestion);
 let pending,finished=false;
 await f.as('other',async()=>{
  const c=await f.db.connect();try{await c.query('BEGIN');
   const run=createReviewRequestRepository(c,f.env);await run({action:'submit',studentId:'alex',id:child.id,version:1,previewId:preview.id,digest:preview.digest,confirmed:true});
   pending=f.reply(parent,1).then(()=>{finished=true;});await new Promise(r=>setTimeout(r,40));assert.equal(finished,false);
   await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 });await pending;
 const kept=(await f.student({action:'get',id:child.id})).request;assert.equal(kept.status,'submitted');assert.equal(kept.publication.access,'unavailable');assert.equal(kept.relatedResponse.question,undefined);
});
test('both voice providers advertise connected preparation only from current server-derived capabilities',enabled,async t=>{
 const f=await fixture(t),configs=[];f.env.OPENAI_API_KEY='synthetic';
 const handler=createProfileVoiceHandler(f.env,async(url,options)=>{const live=url.includes('/live/');configs.push(live?JSON.parse(options.body).session:JSON.parse(options.body.get('session')));return live?new Response(JSON.stringify({transport:{sdp:'v=0\r\nanswer'}})):new Response('v=0\r\nanswer');},()=>{},f.db);
 const start=language=>f.as('other',async()=>{
  const body={sdp:'v=0\r\noffer',mode:'finance',language,role:'student',studentId:'alex',targetConfirmed:true,enableLiveMemory:true,voiceProtocol:'live-v1',responseContextProtocol:'review-response-v1',reviewFollowupVoice:true};
  const req=Object.assign(Readable.from([JSON.stringify(body)]),{url:'/api/profile-voice',method:'POST',headers:{host:'127.0.0.1:5173',origin:'http://127.0.0.1:5173','content-type':'application/json'},origenAuthorized:true,origenIdentity:{sub:'other'}});let status,result;
  await handler(req,{writeHead:s=>status=s,end:value=>result=JSON.parse(value)},()=>assert.fail());assert.equal(status,200,JSON.stringify(result));return configs.at(-1);
 });
 for(const model of ['gpt-live-1','gpt-realtime-2.1'])for(const language of ['en','es']){
  f.env.OPENAI_MODEL_VOICE=model;const config=await start(language),backend=config.delegation?.responses||config;
  assert.ok(backend.tools.find(x=>x.name==='prepare_coordinator_review_request').parameters.properties.relatedResponse);
  assert.match(backend.instructions,/CONNECTED CLARIFICATION/);
 }
 f.env.ORIGEN_REVIEW_REQUEST_DELIVERY='false';let config=await start('en');assert.equal(config.tools.find(x=>x.name==='prepare_coordinator_review_request').parameters.properties.relatedResponse,undefined);
 f.env.ORIGEN_REVIEW_REQUEST_DELIVERY='true';f.env.ORIGEN_REVIEW_RESPONSE_CONTEXT='false';config=await start('en');assert.equal(config.tools.find(x=>x.name==='prepare_coordinator_review_request').parameters.properties.relatedResponse,undefined);
});
test('withdrawal, deletion, nested dependencies, export and restore never revive prior shared source context',enabled,async t=>{
 const f=await fixture(t),parent=await f.make(),child=await f.make(ref(parent.id)),grandchild=await f.make(ref(child.id));
 const exported=await f.as('other',()=>createLifecycleRepository(f.db)('other',{action:'export'}));assert.ok(JSON.stringify(exported).includes('relatedResponse'));
 await f.staff({action:'withdraw-response',id:parent.id,publicationId:parent.publication.id,version:1,operationId:randomUUID()});
 for(const r of [child,grandchild]){assert.equal((await f.student({action:'get',id:r.id})).request.relatedResponse.availability,'unavailable');await assert.rejects(f.staff({action:'read',id:r.id}),{status:404});}
 await f.student({action:'remove',id:parent.id,version:2});assert.equal((await f.student({action:'get',id:child.id})).request.originalQuestion,child.originalQuestion);
 const live=await f.make(),draft=(await f.student(f.input(ref(live.id)))).request;await f.preview(draft);
 const manifest=await exportDeletionManifest(f.owner);await replayDeletionManifest(f.owner,manifest);
 assert.equal((await f.student({action:'get',id:draft.id})).request.relatedResponse.availability,'unavailable');await assert.rejects(f.preview(draft));
 await f.as('other',()=>createLifecycleRepository(f.db)('other',{action:'delete',confirmation:'DELETE'}));assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_review_requests WHERE account_id=$1',[f.account])).rows[0].n,0);
});
test('English and Spanish voice follow-ups require the complete connected readback and immediate independent approval',enabled,async t=>{
 const f=await fixture(t),parent=await f.make(),source=ref(parent.id);
 for(const language of ['en','es']){
  const v=await f.voice(language),p=await v.prepare(source);assert.equal(p.status,'readback_required');assert.ok(p.readback.includes(parent.originalQuestion));assert.match(p.readback,language==='es'?/versión 1/:/version 1/);assert.ok(!p.readback.includes('RESPONSE_BODY_MUST_NOT_BE_COPIED'));
  assert.equal((await v.call('present',{presentation:p.readback.replace(parent.originalQuestion,'')})).status,'not_presented');
  assert.equal((await v.call('confirm')).status,'approval_required');
  assert.equal((await v.call('present',{presentation:p.readback})).status,'presented');await v.turn(language==='es'?'Sí, por favor.':'Yes, please.');assert.equal((await v.call('confirm')).status,'queued');assert.equal((await v.call('confirm')).status,'queued');
  const r=(await f.student({action:'get',id:p.requestId})).request;assert.equal(r.publication.approvalMethod,'voice');assert.deepEqual(r.relatedResponse.source,source);await v.call('close');
 }
 const stale=await f.voice(),p=await stale.prepare(source);await stale.call('present',{presentation:p.readback});await f.reply(parent,1);await stale.turn('Yes');await assert.rejects(stale.call('confirm'),{status:409});assert.equal((await f.student({action:'get',id:p.requestId})).request.publication,null);await stale.call('close');
});
