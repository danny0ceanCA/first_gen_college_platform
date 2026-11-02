import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {studentFollowUpFixture} from './fixtures/student-follow-up.mjs';
import {validateReviewRequest,createReviewRequestRepository} from './review-requests.mjs';
import {validateReviewVoice,openReviewVoiceSession,requestsStudentUpdate} from './review-request-voice.mjs';
import {createProfileVoiceHandler} from './profile-voice.mjs';
const db={skip:!process.env.DATABASE_TEST_URL,timeout:90000};
const wording='I contacted the office. They still need proof of coverage.';
async function fixture(t){
 const f=await studentFollowUpFixture(t);Object.assign(f.env,{ORIGEN_STUDENT_FOLLOW_UP:'true',ORIGEN_REVIEW_REQUEST_VOICE:'true'});
 const input=(extra={})=>({action:'create',requestKey:randomUUID(),connectionId:f.connection,origin:'notebook',language:'en',kind:'student-update',originalQuestion:wording,entries:[],relatedResponse:f.source,...extra});
 const draft=async(extra={})=>(await f.student(input(extra))).request;
 const preview=async r=>(await f.student({action:'preview',id:r.id,version:r.version,wording:'original'})).preview;
 const submit=(r,p)=>f.student({action:'submit',id:r.id,version:1,previewId:p.id,digest:p.digest,confirmed:true});
 const share=async(extra={})=>{const r=await draft(extra);return (await submit(r,await preview(r))).request;};
 const reportCall=body=>f.httpCall('other','/api/student-follow-up-report',{studentId:'alex',...body});
 const saveReport=async(extra={})=>{const p=(await reportCall({action:'prepare',target:f.target,planVersion:(await f.plans()).plans[0].version,operationId:randomUUID(),language:'en',payload:{report:{responseState:'answered',reportedAction:'completed',reportedOutcome:'unresolved',detail:'PRIVATE_REPORT_DETAIL',helpfulness:'not_helpful',occurredOn:null,timeZone:'America/Chicago'},planStatus:null,...extra}})).preview;return reportCall({action:'confirm',previewId:p.id,digest:p.digest,confirmed:true});};
 const voice=async(language='en')=>{
  const session=await f.as('other',()=>openReviewVoiceSession(f.db,f.env,'alex'));let sequence=0,turnId,transcript;
  const call=(action,extra={})=>f.httpCall('other','/api/review-request-voice',{action,sessionId:session.id,...(action==='close'?{}:{sequence,turnId,transcript}),...extra});
  const turn=async text=>{sequence++;turnId=randomUUID();transcript=text;await call('turn',{language});};
  const prepare=()=>call('prepare',{requestKey:randomUUID(),connectionId:f.connection,kind:'student-update',question:wording,entries:[],relatedResponse:f.source});
  return {call,turn,prepare};
 };
 return {...f,input,draft,preview,submit,share,saveReport,voice};
}
test('update contracts require an exact response identity; private saves and vague answers do not request sharing',()=>{
 const input={action:'create',studentId:'alex',requestKey:randomUUID(),connectionId:randomUUID(),origin:'notebook',language:'en',kind:'student-update',originalQuestion:wording,entries:[]};
 assert.throws(()=>validateReviewRequest(input),{status:400});
 const source={kind:'review-response',requestId:randomUUID(),responseVersion:1};assert.equal(validateReviewRequest({...input,relatedResponse:source}).kind,'student-update');
 for(const extra of [{reportId:randomUUID()},{confirmed:true},{provenance:'institution_verified'},{snapshotPolicy:'live'}])assert.throws(()=>validateReviewRequest({...input,relatedResponse:source,...extra}),{status:400});
 assert.throws(()=>validateReviewVoice({action:'prepare',sessionId:randomUUID(),sequence:1,turnId:'turn',transcript:'Share an update with my coordinator.',connectionId:input.connectionId,requestKey:randomUUID(),question:wording,kind:'student-update',entries:[]}),{status:400});
 for(const text of ['I called.','Yes, save it.','Save a private update.','Share this later.','No, do not share with my coordinator.','Completé la acción.','Guarda una actualización privada.','No compartas esto con mi coordinadora.'])assert.equal(requestsStudentUpdate(text),false,text);
 for(const text of ['Share this update with my coordinator: I called.','Tell my coordinator I am waiting.','Comparte esta actualización con mi coordinadora: llamé.','Dile a mi coordinador que sigo esperando.'])assert.equal(requestsStudentUpdate(text),true,text);
});
test('only exact approved snapshots reach the coordinator; private corrections, deletion and retries cannot change them',db,async t=>{
 const f=await fixture(t),saved=await f.saveReport();
 const privateBefore=JSON.stringify(await f.staff({action:'read',id:f.request.id}));assert.doesNotMatch(privateBefore,/PRIVATE_REPORT_DETAIL|helpfulness|reported_outcome|PRIVATE_PLAN_NOT_SHARED/);
 const input=f.input({entries:[{id:f.notes[1],version:1}]}),r=(await f.student(input)).request;assert.equal((await f.student(input)).request.id,r.id);assert.equal(r.publication,null);
 assert.equal((await f.staff({action:'list'})).requests.some(x=>x.id===r.id),false);
 const p=await f.preview(r);assert.equal(p.selection.provenance,'student_reported');assert.equal(p.selection.snapshotPolicy,'separate-copy-v1');assert.equal(p.selection.entries.length,1);assert.equal(p.selection.question,wording);assert.deepEqual(p.selection.relatedResponse.source,f.source);
 assert.doesNotMatch(JSON.stringify(p),/PRIVATE_REPORT_DETAIL|PRIVATE_RESPONSE_NOT_COPIED|PRIVATE_PLAN_NOT_SHARED|helpfulness|reported_outcome/);
 await f.submit(r,p);await f.submit(r,p);await f.sweep();await f.sweep();
 const shared=await f.staff({action:'read',id:r.id});assert.equal(shared.kind,'student-update');assert.equal(shared.question,wording);assert.equal(shared.provenance,'student_reported');assert.equal(shared.response,null);assert.equal(shared.reviewedAt,null);
 const corrected=await f.saveReport({reportId:saved.reportId,reportVersion:1,report:{responseState:'answered',reportedAction:'attempted',reportedOutcome:'pending',detail:'PRIVATE_CORRECTION_NOT_SHARED',helpfulness:null,occurredOn:null,timeZone:'America/Chicago'}});assert.equal(corrected.version,2);
 await f.call({action:'delete-report',operationId:randomUUID(),reportId:saved.reportId,revision:2});assert.equal((await f.load()).reports.length,0);
 assert.equal((await f.staff({action:'read',id:r.id})).question,wording);
 const queue=(await f.owner.query("SELECT * FROM origen_coordinator_outbox WHERE grant_id=$1 AND kind='review-request'",[r.id])).rows;assert.equal(queue.length,1);assert.doesNotMatch(JSON.stringify(queue),/proof of coverage|PRIVATE_REPORT|helpfulness/);
 await assert.rejects(f.student({...input,originalQuestion:'Changed after approval'}),{status:409});
 const correction=await f.share({originalQuestion:'Correction: I emailed the office; I did not call.'});await f.sweep();assert.equal((await f.staff({action:'read',id:r.id})).question,wording);
 await f.staff({action:'respond',id:correction.id,publicationId:correction.publication.id,version:0,operationId:randomUUID(),guidance:'Thanks for the update.',suggestedAction:'Keep the email confirmation.'});
 assert.equal((await f.student({action:'get',id:correction.id})).request.publication.responded,true);
 await f.student({action:'withdraw',id:r.id,version:2});await assert.rejects(f.staff({action:'read',id:r.id}),{status:404});
 await f.student({action:'remove',id:correction.id,version:2});await assert.rejects(f.staff({action:'read',id:correction.id}),{status:404});
});
test('pause and cohort controls block new update approval without blocking withdrawal or leaking old reports',db,async t=>{
 const f=await fixture(t);assert.equal((await f.student({action:'list'})).studentUpdatesEnabled,true);const r=await f.draft(),p=await f.preview(r),sent=await f.share();
 for(const setting of [{ORIGEN_STUDENT_FOLLOW_UP:'false'},{ORIGEN_PERSONALIZATION_MODE:'off'},{ORIGEN_PERSONALIZATION_MODE:'cohort',ORIGEN_PERSONALIZATION_SUBJECTS:'someone-else'},{ORIGEN_PERSONALIZATION_RETRIEVAL:'false'}]){
  const before={...f.env};Object.assign(f.env,setting);assert.equal((await f.student({action:'list'})).studentUpdatesEnabled,false);await assert.rejects(f.draft(),{status:503});await assert.rejects(f.submit(r,p),{status:503});Object.keys(f.env).forEach(k=>delete f.env[k]);Object.assign(f.env,before);
 }
 f.env.ORIGEN_STUDENT_FOLLOW_UP='false';assert.equal((await f.student({action:'withdraw',id:sent.id,version:2})).request.status,'withdrawn');
});
test('source changes stop preview approval, queued delivery and delivered opening',db,async t=>{
 for(const stage of ['preview','queued','delivered'])await t.test(stage,async t=>{
  const f=await fixture(t),r=await f.draft(),p=await f.preview(r);if(stage!=='preview')await f.submit(r,p);if(stage==='delivered')await f.sweep();
  await f.reply(1);const kept=(await f.student({action:'get',id:r.id})).request;assert.equal(kept.originalQuestion,wording);assert.equal(kept.relatedResponse.availability,'unavailable');
  if(stage==='preview')await assert.rejects(f.submit(r,p),{status:409});else{await f.sweep();await assert.rejects(f.staff({action:'read',id:r.id}),{status:404});assert.deepEqual((await f.owner.query('SELECT payload FROM origen_review_request_publications WHERE request_id=$1',[r.id])).rows[0].payload,{});}
 });
});
test('scope, membership and recipient changes cannot retarget a linked update',db,async t=>{
 const f=await fixture(t);await assert.rejects(f.draft({studentId:'sam'}));await assert.rejects(f.httpCall('reader','/api/review-requests',{studentId:'alex',...f.input()}));
 const other=randomUUID();await f.owner.query("INSERT INTO origen_binder_connections(id,account_id,student_id,coordinator_id,status,request_id,expires_at,accepted_at,display_name) SELECT $1,c.account_id,c.student_id,p.id,'accepted',$2,c.expires_at,c.accepted_at,c.display_name FROM origen_binder_connections c JOIN origen_coordinator_profiles p ON p.auth0_subject='colleague' AND p.institution_id=$4 WHERE c.id=$3",[other,randomUUID(),f.connection,f.org]);
 await assert.rejects(f.draft({connectionId:other}),{status:409});
 const r=await f.draft(),p=await f.preview(r);await f.owner.query("DELETE FROM origen_institution_members WHERE institution_id=$1 AND auth0_subject='staff'",[f.org]);await assert.rejects(f.submit(r,p));
});
test('a concurrent source edit waits for approval and then invalidates the snapshot; duplicate submits remain one publication',db,async t=>{
 const f=await fixture(t),r=await f.draft(),p=await f.preview(r);let pending,finished=false;
 await f.as('other',async()=>{const c=await f.db.connect();try{await c.query('BEGIN');await createReviewRequestRepository(c,f.env,'other')({action:'submit',studentId:'alex',id:r.id,version:1,previewId:p.id,digest:p.digest,confirmed:true});pending=f.reply(1).then(()=>{finished=true;});await new Promise(resolve=>setTimeout(resolve,40));assert.equal(finished,false);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}});await pending;
 assert.equal((await f.student({action:'get',id:r.id})).request.publication.access,'unavailable');await f.sweep();await assert.rejects(f.staff({action:'read',id:r.id}),{status:404});
 const current=await f.draft({relatedResponse:{...f.source,responseVersion:2}}),preview=await f.preview(current);await Promise.all([f.submit(current,preview),f.submit(current,preview)]);assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_review_request_publications WHERE request_id=$1',[current.id])).rows[0].n,1);
});
test('spoken updates need a new complete snapshot disclosure and independent next-turn sharing approval in both languages',db,async t=>{
 const f=await fixture(t);
 for(const language of ['en','es']){
  const v=await f.voice(language);await v.turn(language==='es'?'Guarda una actualización privada: llamé.':'Save a private update: I called.');assert.equal((await v.prepare()).status,'not_requested');
  await v.turn(language==='es'?'Comparte esta actualización con mi coordinadora: llamé y sigo esperando.':'Share this update with my coordinator: I called and am waiting.');const p=await v.prepare();assert.equal(p.status,'readback_required');assert.match(p.readback,language==='es'?/copia separada/:/separate copy/);assert.match(p.readback,language==='es'?/no verificada/:/not institution-verified/);assert.ok(p.readback.includes(f.request.originalQuestion));
  assert.equal((await v.call('confirm')).status,'approval_required');assert.equal((await v.call('present',{presentation:p.readback.slice(0,-50)})).status,'not_presented');
  await v.call('present',{presentation:p.readback});await v.turn(language==='es'?'Sí, guárdalo.':'Yes, save it.');assert.equal((await v.call('confirm')).status,'approval_required');
  await v.turn(language==='es'?'Comparte esta actualización con mi coordinadora: llamé.':'Share this update with my coordinator: I called.');const fresh=await v.prepare();await v.call('present',{presentation:fresh.readback});await v.turn(language==='es'?'Sí, envíalo.':'Yes, send it.');assert.equal((await v.call('confirm')).status,'queued');assert.equal((await v.call('confirm')).status,'queued');await v.call('close');
 }
});
test('Live and Realtime only advertise student updates from current server-derived permission, including cached configurations',db,async t=>{
 const f=await fixture(t),configs=[];f.env.OPENAI_API_KEY='synthetic';
 const handler=createProfileVoiceHandler(f.env,async(url,options)=>{const live=url.includes('/live/');configs.push(live?JSON.parse(options.body).session:JSON.parse(options.body.get('session')));return live?new Response(JSON.stringify({transport:{sdp:'v=0\r\nanswer'}})):new Response('v=0\r\nanswer');},()=>{},f.db);
 const start=language=>f.as('other',async()=>{
  const body={sdp:'v=0\r\noffer',mode:'finance',language,role:'student',studentId:'alex',targetConfirmed:true,enableLiveMemory:true,voiceProtocol:'live-v1',responseContextProtocol:'review-response-v1',studentUpdateVoice:true};
  const req=Object.assign(Readable.from([JSON.stringify(body)]),{url:'/api/profile-voice',method:'POST',headers:{host:'127.0.0.1:5173',origin:'http://127.0.0.1:5173','content-type':'application/json'},origenAuthorized:true,origenIdentity:{sub:'other'}});let status;await handler(req,{writeHead:s=>status=s,end:()=>{}},()=>{});assert.equal(status,200);const config=configs.at(-1);if(config.delegation){if(f.env.ORIGEN_STUDENT_FOLLOW_UP==='true')assert.match(config.instructions,/separate-copy warning/);else assert.doesNotMatch(config.instructions,/separate-copy warning/);}return config.delegation?.responses||config;
 });
 for(const model of ['gpt-live-1','gpt-realtime-2.1'])for(const language of ['en','es']){
  f.env.OPENAI_MODEL_VOICE=model;f.env.ORIGEN_STUDENT_FOLLOW_UP='true';const on=await start(language);assert.ok(on.tools.find(t=>t.name==='prepare_coordinator_review_request').parameters.properties.kind.enum.includes('student-update'));assert.match(on.instructions,/STUDENT-CONTROLLED UPDATES/);
  f.env.ORIGEN_STUDENT_FOLLOW_UP='false';const off=await start(language);assert.ok(!off.tools.find(t=>t.name==='prepare_coordinator_review_request').parameters.properties.kind.enum.includes('student-update'));assert.doesNotMatch(off.instructions,/STUDENT-CONTROLLED UPDATES/);
 }
});
