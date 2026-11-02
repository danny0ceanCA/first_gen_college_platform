import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {coordinatorPilotFixture} from './fixtures/coordinator-pilot.mjs';
import {validateReviewResponseChoice,createReviewResponseChoiceRepository} from './review-response-choices.mjs';
import {createPlanRepository,validatePlan} from './plans.mjs';
import {createProfileVoiceHandler} from './profile-voice.mjs';
import {validateWorkspaceFocus} from './voice-workspace.mjs';
import {createLiveMemoryRepository,createLiveMemoryService,validateLiveChange} from './live-memory.mjs';
import {createLifecycleRepository} from './account-lifecycle.mjs';
import {loadReviewResponseContext,verifyReviewResponseContext} from './review-response-context.mjs';
import {exportDeletionManifest,replayDeletionManifest} from '../ops/privacy-recovery.mjs';

const enabled={skip:!process.env.DATABASE_TEST_URL,timeout:90000};
const source=(id,version=1)=>({kind:'review-response',requestId:id,responseVersion:version});
const actionInput=(ref,overrides={})=>({action:'create',requestId:randomUUID(),fromResponse:{source:ref,stepId:'accepted-step',confirmed:true},plan:{studentId:'alex',title:'My private next step',goal:'',category:'financial',status:'active',summaryIds:[],steps:[{id:'accepted-step',title:'Ask the office',action:'Ask which proof of coverage is accepted.',notes:'My own wording.',status:'not-started',dueDate:null,sources:[]}]},...overrides});

test('private choices, focus and linked actions accept identity and explicit acceptance, never model authority',()=>{
 const ref=source(randomUUID()),choice={action:'defer',studentId:'alex',source:ref,revision:0,operationId:randomUUID(),reviewOn:null};
 assert.deepEqual(validateReviewResponseChoice(choice),choice);
 for(const extra of [{confirmed:true},{enabled:true},{subject:'other'},{reviewOn:'2027-02-30'},{reviewOn:'2020-01-01'},{revision:-1},{action:'attach-plan'},{studentId:null}])assert.throws(()=>validateReviewResponseChoice({...choice,...extra}),{status:400});
 const focus={kind:'review-response',studentId:'alex',topic:'costs',source:ref};assert.deepEqual(validateWorkspaceFocus(focus),focus);
 for(const extra of [{source:{...ref,responseVersion:0}},{body:'INJECTED'},{studentId:null}])assert.throws(()=>validateWorkspaceFocus({...focus,...extra}),{status:400});
 const plan=actionInput(ref);assert.deepEqual(validatePlan(plan).fromResponse,plan.fromResponse);
 for(const extra of [{confirmed:false},{confirmed:undefined},{responseText:'private'},{stepId:'missing'}])assert.throws(()=>validatePlan({...plan,fromResponse:{...plan.fromResponse,...extra}}),{status:400});
 assert.throws(()=>validatePlan({...plan,fromFeedback:{id:randomUUID(),version:1,stepId:'accepted-step'}}),{status:400});
 assert.throws(()=>validateLiveChange({kind:'create',category:'goal',content:'Remember this',responseSource:ref}),{status:400});
});

async function fixture(t){
 const f=await coordinatorPilotFixture({reviewRequests:true,reviewDelivery:true});t.after(()=>f.close());
 Object.assign(f.env,{ORIGEN_REVIEW_RESPONSE_CONTEXT:'true',ORIGEN_PERSONALIZATION_MODE:'on',OPENAI_API_KEY:'synthetic'});
 const account=(await f.owner.query("SELECT id FROM origen_accounts WHERE auth0_subject='other'")).rows[0].id,connection=randomUUID();
 await f.owner.query("INSERT INTO origen_binder_connections(id,account_id,student_id,coordinator_id,status,request_id,expires_at,accepted_at,display_name) SELECT $1,$2,'alex',id,'accepted',$3,now()+interval '7 days',now(),'Alex' FROM origen_coordinator_profiles WHERE auth0_subject='staff' AND institution_id=$4",[connection,account,randomUUID(),f.org]);
 const student=input=>f.call('other','/api/review-requests',{studentId:'alex',...input});
 const staff=input=>f.call('staff','/api/coordinator-review-requests',{organizationId:f.org,...input});
 const reply=(r,version=0,guidance='SOURCE_QUOTATION: Your coverage may qualify if it meets campus requirements.')=>staff({action:'respond',id:r.id,publicationId:r.publication.id,version,operationId:randomUUID(),guidance,suggestedAction:'Ask which proof of coverage is accepted.',resourceUrl:'https://example.edu/insurance',followUpOn:'2027-03-01'});
 const make=async()=>{
  const draft=(await student({action:'create',requestKey:randomUUID(),connectionId:connection,origin:'notebook',language:'en',kind:'question',originalQuestion:'Which insurance waiver documents are accepted?',entries:[]})).request;
  const preview=(await student({action:'preview',id:draft.id,version:1,wording:'original'})).preview;
  const r=(await student({action:'submit',id:draft.id,version:1,previewId:preview.id,digest:preview.digest,confirmed:true})).request;await f.sweep();await reply(r);return r;
 };
 const choose=(ref,input={action:'load'})=>f.call('other','/api/review-response-choices',{studentId:'alex',source:ref,...input});
 const plans=(input={action:'load',studentId:'alex'},subject='other',db=f.db)=>f.as(subject,()=>createPlanRepository(db,f.env)(subject,validatePlan(input)));
 const repo=createLiveMemoryRepository(f.db,f.env),service=createLiveMemoryService(f.db,f.env);
 const memory=input=>f.as('other',()=>repo('other',{...input,...(input.change?{change:validateLiveChange(input.change)}:{})}));
 const recall=input=>f.as('other',()=>service('other',input));
 const lookup=ref=>f.as('other',()=>loadReviewResponseContext(f.db,'other',{studentId:'alex',focus:ref},f.env));
 const configs=[];const handler=createProfileVoiceHandler(f.env,async(url,options)=>{
  const live=url.includes('/live/');configs.push(live?JSON.parse(options.body).session:JSON.parse(options.body.get('session')));
  return live?new Response(JSON.stringify({transport:{sdp:'v=0\r\nanswer'}})):new Response('v=0\r\nanswer');
 },()=>{},f.db);
 const voice=(ref,overrides={},subject='other')=>f.as(subject,async()=>{
  const body={sdp:'v=0\r\noffer',mode:'finance',language:'en',role:'student',studentId:'alex',targetConfirmed:true,enableLiveMemory:true,voiceProtocol:'live-v1',responseContextProtocol:'review-response-v1',workspaceFocus:{kind:'review-response',studentId:'alex',topic:'costs',source:ref},...overrides};
  const req=Object.assign(Readable.from([JSON.stringify(body)]),{url:'/api/profile-voice',method:'POST',headers:{host:'127.0.0.1:5173',origin:'http://127.0.0.1:5173','content-type':'application/json'},origenAuthorized:true,origenIdentity:{sub:subject}});let status,result;
  await handler(req,{writeHead:value=>status=value,end:value=>result=JSON.parse(value)},()=>assert.fail());return {status,...result};
 });
 return {...f,account,student,staff,reply,make,choose,plans,memory,recall,lookup,voice,configs};
}

test('deferral is private, durable across edits, optional-date aware and revision/idempotency checked',enabled,async t=>{
 const f=await fixture(t),r=await f.make(),ref=source(r.id),before=(await f.owner.query('SELECT count(*)::int n FROM origen_coordinator_outbox')).rows[0].n;
 const first=await f.choose(ref);assert.equal(first.enabled,true);assert.deepEqual(first.choice,{state:'available',revision:0,reviewOn:null,shouldOffer:true});
 const defer={action:'defer',revision:0,operationId:randomUUID(),reviewOn:null};
 const saved=await f.choose(ref,defer);assert.equal(saved.choice.state,'deferred');assert.equal(saved.choice.shouldOffer,false);assert.equal(saved.choice.revision,1);
 assert.deepEqual(await f.choose(ref,defer),saved);
 await assert.rejects(f.choose(ref,{...defer,reviewOn:'2099-12-01'}),{status:409});
 await f.reply(r,1);const changed=await f.choose(source(r.id,2));assert.equal(changed.choice.state,'deferred');assert.equal(changed.choice.shouldOffer,false);
 await assert.rejects(f.choose(ref,{action:'revisit',revision:1,operationId:randomUUID()}),{status:404});
 const future=await f.choose(source(r.id,2),{action:'defer',revision:1,operationId:randomUUID(),reviewOn:'2099-01-01'});assert.equal(future.choice.shouldOffer,false);
 const today=await f.choose(source(r.id,2),{action:'defer',revision:2,operationId:randomUUID(),reviewOn:new Date().toISOString().slice(0,10)});assert.equal(today.choice.shouldOffer,true);
 const revisited=await f.choose(source(r.id,2),{action:'revisit',revision:3,operationId:randomUUID()});assert.equal(revisited.choice.state,'available');assert.equal(revisited.choice.reviewOn,null);
 const staffView=await f.staff({action:'read',id:r.id});assert.ok(!JSON.stringify(staffView).includes('reviewOn'));assert.ok(!JSON.stringify(staffView).includes('shouldOffer'));
 const receipt=(await f.student({action:'get',id:r.id})).request;assert.deepEqual(receipt.coordinatorReview.connection.studentActivity,{opened:'not_recorded',discussed:'not_recorded',actionAccepted:'not_recorded'});
 assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_coordinator_outbox')).rows[0].n,before+1,'Only the explicit coordinator edit adds an outbox record');
 for(const table of ['origen_review_response_choices','origen_review_response_plan_links'])await assert.rejects(f.as('other',()=>f.db.query(`SELECT * FROM ${table}`)),/permission denied/);
 for(const [actor,status] of [['reader',404],['staff',403]])assert.equal((await f.request(actor,'/api/review-response-choices',{studentId:'alex',source:source(r.id,2),action:'load'})).status,status);
 assert.equal((await f.request('other','/api/review-response-choices',{studentId:'sam',source:source(r.id,2),action:'load'})).status,404);
 f.env.ORIGEN_REVIEW_RESPONSE_CONTEXT='false';assert.equal((await f.choose(source(r.id,2))).enabled,false);
 await assert.rejects(f.choose(source(r.id,2),{action:'defer',revision:4,operationId:randomUUID(),reviewOn:null}),{status:503});
});

test('accepted wording and provenance survive edits, withdrawal, request deletion and plan updates without copying response prose',enabled,async t=>{
 const f=await fixture(t),r=await f.make(),ref=source(r.id),input=actionInput(ref);
 const created=await f.plans(input),plan=created.plans[0];assert.equal(plan.steps[0].action,input.plan.steps[0].action);assert.equal(plan.steps[0].responseSource.availability,'current');assert.deepEqual(plan.steps[0].responseSource.source,ref);
 assert.ok(!JSON.stringify(created).includes('SOURCE_QUOTATION'));assert.ok(!JSON.stringify(created).includes('example.edu'));assert.equal(plan.steps[0].notes,'My own wording.');
 assert.equal((await f.plans(input)).plans.length,1);await assert.rejects(f.plans({...input,fromResponse:{...input.fromResponse,source:source(r.id,2)}}),{status:409});
 assert.equal((await f.choose(ref)).acceptedActionCount,1);assert.equal((await f.student({action:'get',id:r.id})).request.coordinatorReview.connection.studentActivity.actionAccepted,'recorded');
 f.env.ORIGEN_REVIEW_RESPONSE_CONTEXT='false';const paused=(await f.plans()).plans[0];assert.equal(paused.steps[0].responseSource.source,null);assert.equal(paused.steps[0].responseSource.availability,'current');assert.equal(paused.steps[0].action,input.plan.steps[0].action);
 f.env.ORIGEN_REVIEW_RESPONSE_CONTEXT='true';assert.deepEqual((await f.plans()).plans[0].steps[0].responseSource.source,ref);
 const updated=await f.plans({action:'update',id:plan.id,version:plan.version,plan:{...plan,steps:plan.steps.map(s=>({...s,status:'in-progress',action:'My independently edited action.'}))}});
 assert.equal(updated.plans[0].steps[0].responseSource.responseVersion,1);
 await f.reply(r,1,'NEW_SOURCE: A revised suggestion.');
 await assert.rejects(f.plans(actionInput(ref)),{status:404});
 const old=(await f.plans()).plans[0];assert.equal(old.steps[0].action,'My independently edited action.');assert.equal(old.steps[0].responseSource.availability,'unavailable');assert.equal(old.steps[0].responseSource.source,null);
 const second=(await f.plans(actionInput(source(r.id,2)))).plans.find(p=>p.id!==plan.id);
 await f.student({action:'withdraw',id:r.id,version:2});
 assert.equal((await f.plans()).plans.find(p=>p.id===second.id).steps[0].responseSource.availability,'historical');
 await f.student({action:'remove',id:r.id,version:3});
 const kept=await f.plans();assert.equal(kept.plans.length,2);assert.ok(kept.plans.every(p=>p.steps[0].responseSource.availability==='unavailable'));
 const exported=await f.as('other',()=>createLifecycleRepository(f.db)('other',{action:'export'}));
 assert.equal(exported.reviewResponsePlanLinks.length,2);assert.ok(exported.planSteps.some(s=>s.action==='My independently edited action.'));assert.ok(!JSON.stringify(exported.reviewResponsePlanLinks).includes('SOURCE_QUOTATION'));
 const remove=kept.plans[0];await f.plans({action:'update',id:remove.id,version:remove.version,plan:{...remove,steps:[]}});
 assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_review_response_plan_links')).rows[0].n,1);
 await f.family('other',{action:'delete-student',id:'alex'});assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_review_response_plan_links')).rows[0].n,0);
});

test('response withdrawal strips source access, restore defers choices and detaches sources, and account deletion removes private choices/actions',enabled,async t=>{
 const f=await fixture(t),r=await f.make(),ref=source(r.id);
 await f.plans(actionInput(ref));await f.choose(ref,{action:'defer',revision:0,operationId:randomUUID(),reviewOn:'2099-01-01'});
 const manifest=await exportDeletionManifest(f.owner);await replayDeletionManifest(f.owner,manifest);
 const after=(await f.plans()).plans[0];assert.equal(after.steps[0].responseSource.availability,'unavailable');assert.equal(after.steps[0].responseSource.source,null);assert.equal(after.steps[0].action,'Ask which proof of coverage is accepted.');
 const choice=await f.choose(ref);assert.equal(choice.choice.state,'deferred');assert.equal(choice.choice.reviewOn,null);assert.equal(choice.choice.shouldOffer,false);
 const exported=await f.as('other',()=>createLifecycleRepository(f.db)('other',{action:'export'}));assert.equal(exported.reviewResponseChoices.length,1);assert.equal(exported.reviewResponsePlanLinks[0].source_detached,true);
 await f.as('other',()=>createLifecycleRepository(f.db)('other',{action:'delete',confirmation:'DELETE'}));
 for(const table of ['origen_review_response_choices','origen_review_response_plan_links','origen_plans'])assert.equal((await f.owner.query(`SELECT count(*)::int n FROM ${table} WHERE account_id=$1`,[f.account])).rows[0].n,0);
});

test('source checks and action creation serialize with a concurrent coordinator edit',enabled,async t=>{
 const f=await fixture(t),r=await f.make();let pendingEdit,intercepted=false,finished=false;
 const db={connect:async()=>{const c=await f.db.connect();return {release:()=>c.release(),query:async(sql,args)=>{
  const result=await c.query(sql,args);
  if(!intercepted&&args?.[0]&&sql.includes('origen_review_response_choice_command')&&JSON.parse(args[0]).action==='check-source'){
   intercepted=true;pendingEdit=f.reply(r,1,'A newer coordinator response.').then(()=>{finished=true;});await new Promise(resolve=>setTimeout(resolve,30));assert.equal(finished,false);
  }
  return result;
 }};}};
 const created=await f.plans(actionInput(source(r.id)),'other',db);assert.equal(created.plans[0].steps[0].responseSource.responseVersion,1);await pendingEdit;
 assert.equal((await f.plans()).plans[0].steps[0].responseSource.availability,'unavailable');
});

test('withdrawn responses remove source access without deleting accepted actions, and pausing during creation rolls back the entire action',enabled,async t=>{
 const f=await fixture(t),r=await f.make(),ref=source(r.id);await f.plans(actionInput(ref));
 await f.staff({action:'withdraw-response',id:r.id,publicationId:r.publication.id,version:1,operationId:randomUUID()});
 const kept=(await f.plans()).plans[0];assert.equal(kept.steps[0].action,'Ask which proof of coverage is accepted.');assert.equal(kept.steps[0].responseSource.availability,'unavailable');assert.equal(kept.steps[0].responseSource.source,null);
 await assert.rejects(f.plans(actionInput(ref)),{status:404});assert.notEqual((await f.lookup(ref)).status,'retrieved');
 const other=await f.make();let paused=false;
 const db={connect:async()=>{const c=await f.db.connect();return {release:()=>c.release(),query:async(sql,args)=>{const result=await c.query(sql,args);if(args?.[0]&&sql.includes('origen_review_response_choice_command')&&JSON.parse(args[0]).action==='attach-plan'){f.env.ORIGEN_REVIEW_RESPONSE_CONTEXT='false';paused=true;}return result;}};}};
 await assert.rejects(f.plans(actionInput(source(other.id)),'other',db),{status:503});assert.equal(paused,true);assert.equal((await f.plans()).plans.length,1);
 assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_review_response_plan_links')).rows[0].n,1);
});

test('explicit response focus reaches both providers in either language, with a freshness guard and no implicit action',enabled,async t=>{
 const f=await fixture(t),r=await f.make(),ref=source(r.id);
 for(const model of ['gpt-live-1','gpt-realtime-2.1'])for(const language of ['en','es']){
  f.env.OPENAI_MODEL_VOICE=model;const started=await f.voice(ref,{language});assert.equal(started.status,200,JSON.stringify(started));assert.equal(started.reviewResponseGuard.mode,'focus');
  const config=f.configs.at(-1),instructions=config.delegation?.responses.instructions||config.instructions;
  assert.ok(instructions.includes('SOURCE_QUOTATION'));assert.ok(instructions.includes('"selection":"review-response"'));assert.match(instructions,/already supplied the exact verified response/);
  const result=await f.as('other',()=>verifyReviewResponseContext(f.db,'other','alex',started.reviewResponseGuard,f.env));assert.equal(result.status,'current');
  const turn={sessionId:started.liveMemorySession.id,sequence:1,turnId:randomUUID(),transcript:language==='es'?'Explícame eso.':'Explain that.'};await f.memory({...turn,action:'turn',language});
  const recall=await f.recall({...turn,action:'read',query:'insurance',responseContextProtocol:'review-response-v1'});assert.equal(recall.reviewResponse.response.source.requestId,r.id);
  const update=await f.voice(ref,{language,action:'update-guide',mode:'planning',memorySessionId:started.liveMemorySession.id,workspaceRefreshOnly:true});assert.equal(update.status,200);assert.ok(update.session.instructions.includes('SOURCE_QUOTATION'));
 }
 assert.equal((await f.plans()).plans.length,0);
 assert.equal((await f.voice(source(r.id,99))).status,409);assert.equal((await f.voice(ref,{responseContextProtocol:undefined})).status,403);
 assert.equal((await f.voice(ref,{},'reader')).status,403);
 await f.student({action:'withdraw',id:r.id,version:2});const historical=await f.voice(ref);assert.equal(historical.status,200);assert.ok(f.configs.at(-1).instructions.includes('"availability":"historical"'));
 f.env.ORIGEN_REVIEW_RESPONSE_CONTEXT='false';assert.equal((await f.voice(ref)).status,403);
});

test('spoken linked acceptance requires loaded provenance, exact delivered readback and an immediately following explicit confirmation',enabled,async t=>{
 const f=await fixture(t),r=await f.make(),ref=source(r.id),other=await f.make();
 for(const language of ['en','es']){
  const started=await f.voice(ref,{language});assert.equal(started.status,200);
  let sequence=0;
  const turn=async transcript=>{const value={sessionId:started.liveMemorySession.id,sequence:++sequence,turnId:randomUUID(),transcript};await f.memory({...value,action:'turn',language});return value;};
  const change={kind:'next-step',category:'financial',content:language==='es'?'Preguntar qué comprobante de cobertura aceptan.':'Ask which proof of coverage is accepted.',responseSource:ref};
  const write=(value,proposal=change)=>f.memory({...value,action:'write',requestId:randomUUID(),change:validateLiveChange(proposal)});
  let current=await turn(language==='es'?'Sí.':'Yes.');assert.equal((await write(current)).status,'not_requested');
  current=await turn(language==='es'?'Guarda eso como mi próximo paso.':'Save that as my next step.');
  await assert.rejects(write(current,{...change,responseSource:source(other.id)}),{status:409});
  const proposal=await write(current);assert.equal(proposal.status,'clarification_required');assert.ok(proposal.readback.includes(change.content));
  assert.equal((await f.memory({...current,action:'present',change,presentation:proposal.readback.split('?')[0]})).status,'not_presented');
  current=await turn(language==='es'?'Sí.':'Yes.');assert.equal((await write(current)).status,'not_requested');
  current=await turn(language==='es'?'Guarda eso como mi próximo paso.':'Save that as my next step.');const retry=await write(current);
  assert.equal((await f.memory({...current,action:'present',change,presentation:retry.readback})).status,'presented');
  current=await turn(language==='es'?'Sí, guárdalo.':'Yes, save it.');const saved=await write(current);assert.equal(saved.status,'saved');
  const plan=(await f.plans()).plans.find(p=>p.id===saved.id);assert.equal(plan.steps[0].action,change.content);assert.deepEqual(plan.steps[0].responseSource.source,ref);assert.equal(plan.steps[0].status,'not-started');
 }
 // A response edit after a valid readback invalidates the proposed linked write.
 const started=await f.voice(ref),base={sessionId:started.liveMemorySession.id,sequence:1,turnId:randomUUID(),transcript:'Save that as my next step.'};
 const change={kind:'next-step',category:'financial',content:'Ask the office.',responseSource:ref};await f.memory({...base,action:'turn',language:'en'});
 const proposal=await f.memory({...base,action:'write',requestId:randomUUID(),change});await f.memory({...base,action:'present',change,presentation:proposal.readback});
 await f.reply(r,1);const yes={...base,sequence:2,turnId:randomUUID(),transcript:'Yes, save it.'};await f.memory({...yes,action:'turn',language:'en'});
 await assert.rejects(f.memory({...yes,action:'write',requestId:randomUUID(),change}),{status:404});assert.equal((await f.plans()).plans.length,2);
});
