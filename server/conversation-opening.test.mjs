import {Readable} from 'node:stream';
import {loadVoiceWorkspace} from './voice-workspace.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {studentFollowUpFixture} from './fixtures/student-follow-up.mjs';
import {createLiveMemoryRepository} from './live-memory.mjs';
import {selectConversationOpening,createOpeningEvidenceRepository,openingPolicy,validateOpeningEvidence} from './conversation-opening.mjs';
import {selectBinderOpening} from './binder-next-step.mjs';
import {createProfileVoiceHandler,voiceSession} from './profile-voice.mjs';
import {studentLiveSession} from './student-live-session.mjs';
import {replayDeletionManifest,exportDeletionManifest} from '../ops/privacy-recovery.mjs';
const enabled={skip:!process.env.DATABASE_TEST_URL,timeout:90000};
const base={role:'student',studentId:'alex',language:'en',mode:'finance',experience:{usedApp:true},targetConfirmed:true,workspace:{available:true,scope:{kind:'student',studentId:'alex'},actions:[],notes:[]}};
async function fixture(t){
 const f=await studentFollowUpFixture(t);f.env.ORIGEN_STUDENT_FOLLOW_UP='true';
 const memory=input=>f.as('other',()=>createLiveMemoryRepository(f.db,f.env)('other',input));
 const currentRevision=async()=>(await f.owner.query("SELECT revision FROM origen_memory_scopes WHERE account_id=$1 AND scope_key='alex'",[f.account])).rows[0]?.revision||0;
 const session=async()=>memory({action:'open',studentId:'alex',revision:await currentRevision()});
 const pick=async(extra={},options={})=>f.as('other',()=>selectConversationOpening(f.db,'other',{...base,...extra},{env:f.env,conversationId:randomUUID(),allowFollowUp:true,...options}));
 const evidence=(claim,input)=>f.httpCall('other','/api/conversation-opening',{studentId:'alex',conversationId:claim.conversationId,claimId:claim.claimId,...input});
 const turn=(claim,s,transcript='Not now',sequence=1)=>memory({action:'turn',sessionId:s.id,sequence,turnId:'turn-'+sequence,transcript,language:'en'});
 return {...f,memory,session,pick,evidence,turn};
}
const fallback=(f,id='sibling')=>({title:'A generic next step '+id,action:'A generic next step '+id,topic:'costs',status:'not-started',evidence:{record:{planId:f.plan.id,id,version:1},scope:base.workspace.scope}});

test('opening policy gives current questions, continuations and explicit scope priority; HTTP cannot select or forge playback authority',()=>{
 for(const extra of [{onboarding:true},{continuing:true},{scopeRestart:true},{workspaceRefreshOnly:true},{routeConversations:true,targetConfirmed:false},{continuity:[{role:'user',text:'A new question'}]},{experience:{}}])assert.equal(openingPolicy({...base,...extra}).eligible,false);
 const focused={...base,workspaceFocus:{kind:'action',planId:randomUUID(),stepId:'one'},workspace:{...base.workspace,selection:'action',topic:'costs'}};
 assert.equal(openingPolicy(focused).genericEligible,false);assert.equal(openingPolicy(focused).focus.stepId,'one');
 const evidence={action:'present',studentId:'alex',conversationId:randomUUID(),claimId:randomUUID(),presentation:'The exact question.'};assert.deepEqual(validateOpeningEvidence(evidence),evidence);
 for(const extra of [{action:'select'},{action:'bind'},{audible:true},{completed:true},{presentationHash:'a'.repeat(64)},{studentId:null}])assert.throws(()=>validateOpeningEvidence({...evidence,...extra}),{status:400});
 assert.throws(()=>validateOpeningEvidence({action:'defer',studentId:'alex',conversationId:randomUUID(),claimId:randomUUID(),sequence:1,turnId:'one',transcript:'I finished it'}),{status:400});
});

test('only due explicit consent can be selected; personal and coordinator dates never substitute; bounded source-linked fallback is excluded',enabled,async t=>{
 const f=await fixture(t),s=await f.session();
 const input={workspace:{...base.workspace,actions:[fallback(f,'accepted'),fallback(f)]}};
 let result=await f.pick(input,{memorySessionId:s.id});assert.equal(result.opening.kind,'action');assert.equal(result.opening.evidence.record.id,'sibling');
 const p=await f.prepare({schedule:{onOrAfter:'2099-01-02',timeZone:'America/Chicago'}});await f.call(f.confirmInput(p));
 result=await f.pick(input,{memorySessionId:s.id});assert.equal(result.opening.kind,'action');
 await f.enroll();const outbox=(await f.owner.query('SELECT count(*)::int n FROM origen_coordinator_outbox')).rows[0].n;
 result=await f.pick(input,{memorySessionId:s.id});assert.equal(result.opening.kind,'student-follow-up');assert.deepEqual(result.opening.target,f.target);assert.equal(result.opening.schedule.onOrAfter,null);assert.equal(result.opening.revision,(await f.load()).revision);
 assert.doesNotMatch(JSON.stringify(result),/PRIVATE_PLAN|PRIVATE_RESPONSE|actionHash|reported_outcome/);assert.equal((await f.load()).state,'scheduled');assert.deepEqual((await f.load()).presentations,[]);
 assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_coordinator_outbox')).rows[0].n,outbox);
 f.env.ORIGEN_STUDENT_FOLLOW_UP='false';const workspace=await f.as('other',()=>loadVoiceWorkspace(f.db,'other',{studentId:'alex',mode:'finance'}));assert.equal(workspace.actions.find(a=>a.evidence.record.id==='accepted').followUpControlled,true);assert.equal(selectBinderOpening({...base,workspace}).evidence.record.id,'sibling');f.env.ORIGEN_STUDENT_FOLLOW_UP='true';
 const withoutAdapter=await f.pick(input,{memorySessionId:s.id,allowFollowUp:false});assert.equal(withoutAdapter.opening.kind,'action');
});

test('one shared allowance survives reconnect, provider change, guide handoff, scope changes and generic competition',enabled,async t=>{
 const f=await fixture(t),s=await f.session(),conversationId=randomUUID(),options={memorySessionId:s.id,conversationId};
 const input={workspace:{...base.workspace,actions:[fallback(f)]}};
 const first=await f.pick(input,options);assert.equal(first.opening.kind,'action');
 await f.enroll();for(const extra of [{},{voiceProtocol:'live-v1'},{mode:'admissions',continuing:true},{scopeRestart:true},{workspaceRefreshOnly:true}])assert.equal((await f.pick({...input,...extra},options)).opening,null);
 const claim=(await f.pick({}, {memorySessionId:s.id})).claim;assert.ok(claim);
 assert.equal((await f.pick(input,{conversationId:claim.conversationId,memorySessionId:s.id})).opening,null);
 const suppressed=randomUUID();assert.equal((await f.pick({continuity:[{role:'user',text:'Answer this now'}]},{conversationId:suppressed,memorySessionId:s.id})).opening,null);
 assert.equal((await f.pick({}, {conversationId:suppressed,memorySessionId:s.id})).opening,null);
 const scoped=await f.as('other',()=>selectConversationOpening(f.db,'other',{...base,studentId:null,role:'parent',workspace:{...base.workspace,scope:{kind:'family',studentId:null},actions:[fallback(f)]}},{env:f.env,conversationId:claim.conversationId}));assert.equal(scoped.opening,null);
});

test('two devices cannot claim one enrollment; release and expiry never retry in the same conversation',enabled,async t=>{
 const f=await fixture(t);await f.enroll();const a=await f.session(),b=await f.session();
 const picks=await Promise.all([f.pick({}, {memorySessionId:a.id}),f.pick({}, {memorySessionId:b.id})]);assert.equal(picks.filter(x=>x.claim).length,1);
 const claim=picks.find(x=>x.claim).claim;assert.equal((await f.evidence(claim,{action:'release'})).status,'released');
 assert.equal((await f.pick({}, {conversationId:claim.conversationId,memorySessionId:a.id})).opening,null);
 const next=(await f.pick({}, {memorySessionId:b.id})).claim;assert.ok(next);
 await f.owner.query("UPDATE origen_conversation_openings SET expires_at=now()-interval '1 second' WHERE account_id=$1 AND claim_id=$2",[f.account,next.claimId]);
 assert.equal((await f.evidence(next,{action:'verify'})).status,'unavailable');assert.equal((await f.evidence(next,{action:'present',presentation:next.presentation})).status,'unavailable');
 assert.equal((await f.pick({}, {conversationId:next.conversationId,memorySessionId:b.id})).opening,null);
 assert.ok((await f.pick({}, {memorySessionId:a.id})).claim);assert.equal((await f.load()).state,'scheduled');
});

test('verified presentation consumes one check-in exactly once without completing the task or saving a report',enabled,async t=>{
 const f=await fixture(t);await f.enroll();const s=await f.session(),selected=await f.pick({language:'es'},{memorySessionId:s.id}),claim=selected.claim;
 assert.match(claim.presentation,/Me pediste/);assert.equal((await f.evidence(claim,{action:'verify'})).status,'current');
 assert.equal((await f.evidence(claim,{action:'present',presentation:'An incomplete sentence.'})).status,'not_presented');assert.equal((await f.load()).state,'scheduled');
 const evidence={action:'present',presentation:claim.presentation};const results=await Promise.all([f.evidence(claim,evidence),f.evidence(claim,evidence)]);assert.ok(results.every(x=>x.status==='presented'));
 const loaded=await f.load();assert.equal(loaded.state,'closed');assert.equal(loaded.presentations.length,1);assert.equal(loaded.presentations[0].evidence,'application_playback');assert.deepEqual(loaded.reports,[]);assert.equal((await f.plans()).plans[0].steps[0].status,'not-started');
 assert.equal((await f.pick({}, {memorySessionId:s.id})).opening,null);
 await f.turn(claim,s,'Ahora no');const decline={action:'defer',sequence:1,turnId:'turn-1',transcript:'Ahora no'};assert.equal((await f.evidence(claim,decline)).status,'paused');assert.equal((await f.load()).state,'paused');
 await f.enroll();assert.equal((await f.evidence(claim,decline)).status,'superseded');const fresh=await f.session();assert.ok((await f.pick({}, {memorySessionId:fresh.id})).claim);
});

test('a current question interrupts the offer; independently captured not-now pauses without inventing an outcome',enabled,async t=>{
 const f=await fixture(t);await f.enroll();let s=await f.session(),claim=(await f.pick({}, {memorySessionId:s.id})).claim;
 await f.turn(claim,s,'Not now');await f.evidence(claim,{action:'release'});
 assert.equal((await f.evidence(claim,{action:'present',presentation:claim.presentation})).status,'unavailable');
 const defer={action:'defer',sequence:1,turnId:'turn-1',transcript:'Not now'};
 assert.equal((await f.evidence(claim,{...defer,turnId:'invented'})).status,'unavailable');assert.equal((await f.evidence(claim,defer)).status,'paused');assert.equal((await f.evidence(claim,defer)).status,'paused');
 assert.equal((await f.load()).state,'paused');assert.deepEqual((await f.load()).reports,[]);assert.deepEqual((await f.load()).presentations,[]);
 await f.enroll();assert.equal((await f.evidence(claim,defer)).status,'superseded');assert.equal((await f.load()).state,'scheduled','An old decline cannot pause freshly approved consent.');
 s=await f.session();await f.turn(claim,s,'What is my deadline?');assert.equal((await f.pick({workspace:{...base.workspace,actions:[fallback(f)]}},{memorySessionId:s.id})).opening,null);
});

test('explicit focus wins; topic and student-selected date rank candidates; equivalent actions request clarification',enabled,async t=>{
 const f=await fixture(t);await f.enroll();
 const plan=(await f.plans({action:'create',requestId:randomUUID(),fromResponse:{source:f.source,stepId:'second',confirmed:true},plan:{studentId:'alex',title:'Second action',goal:'',category:'applications',status:'active',summaryIds:[],steps:[{...f.plan.steps[0],id:'second',title:'Contact admissions'}]}})).plans.find(p=>p.id!==f.plan.id);
 const target={planId:plan.id,stepId:'second'};
 const p=(await f.call({action:'prepare',target,operationId:randomUUID(),revision:0,planVersion:1,schedule:{onOrAfter:null,timeZone:'America/Chicago'},language:'en'})).preview;await f.call({...f.confirmInput(p),target});
 const s=await f.session();let result=await f.pick({}, {memorySessionId:s.id});assert.deepEqual(result.opening.target,f.target);await f.evidence(result.claim,{action:'release'});
 result=await f.pick({workspaceFocus:{kind:'action',...target},workspace:{...base.workspace,selection:'action'}},{memorySessionId:s.id});assert.deepEqual(result.opening.target,target);await f.evidence(result.claim,{action:'release'});
 await f.owner.query("UPDATE origen_plans SET category='financial' WHERE account_id=$1 AND id=$2",[f.account,plan.id]);
 const changed=(await f.call({action:'load',target}));const approval=(await f.call({action:'prepare',target,operationId:randomUUID(),revision:changed.revision,planVersion:1,schedule:{onOrAfter:null,timeZone:'America/Chicago'},language:'en'})).preview;await f.call({...f.confirmInput(approval),target});
 const ambiguous=await f.pick({}, {memorySessionId:s.id});assert.equal(ambiguous.reason,'clarification_required');assert.equal(ambiguous.opening,null);
 // Use the previous local calendar date: subtracting 24 hours can still land
 // on the same local date during the autumn 25-hour daylight-saving day.
 await f.owner.query("UPDATE origen_student_follow_ups SET consented_at=(((clock_timestamp() AT TIME ZONE time_zone)::date-1)::timestamp AT TIME ZONE time_zone) WHERE account_id=$1 AND plan_id=$2",[f.account,plan.id]);
 result=await f.pick({}, {memorySessionId:s.id});assert.deepEqual(result.opening.target,target);
});

test('time zones use saved local dates rather than UTC or personal deadlines, across the date line',enabled,async t=>{
 const f=await fixture(t);await f.enroll();const s=await f.session();
 // Both extreme offsets ensure the test remains deterministic at any UTC hour.
 const now=(await f.owner.query("SELECT clock_timestamp() AS now, (clock_timestamp() AT TIME ZONE 'Pacific/Kiritimati')::date::text AS east, (clock_timestamp() AT TIME ZONE 'Etc/GMT+12')::date::text AS west")).rows[0];assert.notEqual(now.east,now.west);
 await f.owner.query("UPDATE origen_student_follow_ups SET time_zone='Etc/GMT+12',on_or_after=$2 WHERE account_id=$1",[f.account,now.east]);assert.equal((await f.pick({}, {memorySessionId:s.id})).opening,null);
 await f.owner.query("UPDATE origen_student_follow_ups SET time_zone='Pacific/Kiritimati' WHERE account_id=$1",[f.account]);const selected=await f.pick({}, {memorySessionId:s.id});assert.ok(selected.claim);
});

test('source/action/permission changes and stop-all invalidate prepared context; restored and deleted claims cannot revive consent',enabled,async t=>{
 const f=await fixture(t);await f.enroll();const s=await f.session();let claim=(await f.pick({}, {memorySessionId:s.id})).claim;
 await f.edit(p=>({...p,steps:p.steps.map(x=>x.id==='accepted'?{...x,notes:'Changed private wording'}:x)}));assert.equal((await f.evidence(claim,{action:'verify'})).status,'unavailable');
 await f.enroll();claim=(await f.pick({}, {memorySessionId:s.id})).claim;await f.httpCall('other','/api/student-follow-up',{action:'stop-all',studentId:'alex',operationId:randomUUID()});assert.equal((await f.evidence(claim,{action:'verify'})).status,'unavailable');
 await f.enroll();claim=(await f.pick({}, {memorySessionId:s.id})).claim;f.env.ORIGEN_STUDENT_FOLLOW_UP='false';await assert.rejects(f.evidence(claim,{action:'present',presentation:claim.presentation}),{status:503});assert.equal((await f.evidence(claim,{action:'release'})).status,'released');f.env.ORIGEN_STUDENT_FOLLOW_UP='true';
 claim=(await f.pick({}, {memorySessionId:s.id})).claim;await f.reply(1);assert.equal((await f.evidence(claim,{action:'verify'})).status,'unavailable');
 const manifest=await exportDeletionManifest(f.owner);await replayDeletionManifest(f.owner,manifest);
 assert.equal((await f.evidence(claim,{action:'verify'})).status,'unavailable');assert.equal((await f.pick({}, {conversationId:claim.conversationId,memorySessionId:s.id})).opening,null);
 await assert.rejects(f.as('other',()=>f.db.query('SELECT * FROM origen_conversation_openings')),{code:'42501'});
 await assert.rejects(f.as('other',()=>f.db.query('SELECT origen_conversation_opening_after_restore()')),{code:'42501'});
 await assert.rejects(f.as('other',()=>f.db.query('SELECT origen_conversation_opening_retry_limit($1)',[f.account])),{code:'42501'});
 const raw=await f.runtime.query('SELECT origen_conversation_opening_command($1::jsonb) AS value',[JSON.stringify({action:'select',conversationId:randomUUID()})]);assert.equal(raw.rows[0].value.status,'unavailable');
 await f.family('other',{action:'delete-student',id:'alex'});const rows=(await f.owner.query('SELECT student_id,plan_id,step_id FROM origen_conversation_openings WHERE account_id=$1',[f.account])).rows;assert.ok(rows.length);assert.ok(rows.every(r=>r.student_id===null&&r.plan_id===null&&r.step_id===null));
});

test('server-reserved openings override both prompt paths and null never falls back to another candidate',()=>{
 for(const language of ['en','es']){
  const opening={kind:'student-follow-up',title:'An accepted action',presentation:'The verified question.'};const input={...base,language,openingDecision:{opening,reason:'reserved'}};
  assert.equal(selectBinderOpening(input),opening);const realtime=voiceSession(input,{}),live=studentLiveSession(realtime,input);assert.equal(live.delegation.responses.instructions,realtime.instructions);assert.match(realtime.instructions,/STUDENT-CONTROLLED CHECK-IN/);assert.match(realtime.instructions,/SERVER OPENING ALLOWANCE/);
  assert.equal(selectBinderOpening({...input,openingDecision:{opening:null,reason:'conversation_already_considered'},workspace:{...base.workspace,actions:[{title:'Competing',action:'Competing',status:'not-started'}]}}),null);
 }
});

test('candidate lookup is bounded and does not guess beyond a truncated set of stale entries',enabled,async t=>{
 const f=await fixture(t);await f.enroll();
 await f.owner.query("INSERT INTO origen_plan_steps(account_id,plan_id,id,position,title,action,status) SELECT $1,$2,'bulk-'||lpad(n::text,4,'0'),n+1,'Bounded action','Ask the office','not-started' FROM generate_series(1,34) n",[f.account,f.plan.id]);
 await f.owner.query("INSERT INTO origen_review_response_plan_links(account_id,student_id,plan_id,step_id,request_id,response_version,source_detached) SELECT $1,'alex',$2,'bulk-'||lpad(n::text,4,'0'),$3,1,n<=32 FROM generate_series(1,34) n",[f.account,f.plan.id,f.request.id]);
 await f.owner.query("INSERT INTO origen_student_follow_ups(account_id,student_id,plan_id,step_id,request_id,response_version,state,accepted_plan_version,action_hash,on_or_after,time_zone,valid_until,consented_at) SELECT f.account_id,f.student_id,f.plan_id,l.step_id,f.request_id,f.response_version,'scheduled',f.accepted_plan_version,origen_student_follow_up_target(f.account_id,f.plan_id,l.step_id)->>'actionHash',f.on_or_after,f.time_zone,f.valid_until,f.consented_at FROM origen_student_follow_ups f JOIN origen_review_response_plan_links l ON l.account_id=f.account_id AND l.plan_id=f.plan_id AND l.step_id LIKE 'bulk-%' WHERE f.account_id=$1 AND f.step_id='accepted'",[f.account]);
 await f.owner.query("UPDATE origen_student_follow_ups SET state='off',revision=revision+1 WHERE account_id=$1 AND step_id='accepted'",[f.account]);
 const s=await f.session(),result=await f.pick({}, {memorySessionId:s.id});assert.equal(result.opening,null);assert.equal(result.reason,'candidate_limit');
 const rows=(await f.owner.query('SELECT state,count(*)::int n FROM origen_student_follow_ups WHERE account_id=$1 GROUP BY state',[f.account])).rows;
 assert.equal(rows.find(x=>x.state==='paused').n,32);assert.equal(rows.find(x=>x.state==='scheduled').n,2);
});

test('three abandoned attempts pause the enrollment; only fresh student approval resets the allowance',enabled,async t=>{
 const f=await fixture(t);await f.enroll();const s=await f.session();
 for(let i=0;i<3;i++){const {claim}=await f.pick({}, {memorySessionId:s.id});assert.ok(claim);await f.evidence(claim,{action:'release'});}
 const current=await f.load();assert.equal(current.state,'paused');assert.equal(current.pauseReason,'attempt_limit');assert.equal(current.presentations.length,0);assert.equal(current.reports.length,0);
 assert.equal((await f.pick({}, {memorySessionId:s.id})).opening,null);await f.enroll();assert.ok((await f.pick({}, {memorySessionId:s.id})).claim);
});

test('role and permission revocation block prepared offers, while cancellation remains available',enabled,async t=>{
 for(const kind of ['role','permission'])await t.test(kind,async t=>{
  const f=await fixture(t);await f.enroll();const s=await f.session(),{claim}=await f.pick({}, {memorySessionId:s.id});
  if(kind==='role')await f.owner.query("UPDATE origen_accounts SET role='parent' WHERE id=$1",[f.account]);
  else await f.owner.query("UPDATE origen_eligibility SET status='revoked',revision=revision+1 WHERE subject_hash=$1",[createHash('sha256').update('other').digest('hex')]);
  assert.equal((await f.evidence(claim,{action:'verify'})).status,'unavailable');assert.equal((await f.evidence(claim,{action:'release'})).status,'released');assert.equal((await f.load()).presentations.length,0);
 });
});

test('profile negotiation reserves only after preparation, strips forged choices, and shares the budget across Live/Realtime',enabled,async t=>{
 const f=await fixture(t);await f.enroll();const providerInputs=[];let providerFailure=false;f.env.ORIGEN_VOICE_PREPARATION='true';
 const handler=createProfileVoiceHandler({...f.env,OPENAI_API_KEY:'synthetic-local-test-key'},async(url,options)=>{
  if(providerFailure)return new Response('{}',{status:503,headers:{'Content-Type':'application/json'}});
  if(url.endsWith('/live/sessions')){const body=JSON.parse(options.body);providerInputs.push(body.session.delegation.responses.instructions);return new Response(JSON.stringify({transport:{sdp:'v=0\r\n'},session:{id:'synthetic-provider'}}),{headers:{'Content-Type':'application/json'}});}
  providerInputs.push(JSON.parse(options.body.get('session')).instructions);return new Response('v=0\r\n');
 },()=>{},f.db);
 const conversationId=randomUUID();
 const negotiate=(body,id=conversationId,expected=200)=>f.as('other',async()=>{
  let status,output;const req=Object.assign(Readable.from([JSON.stringify({sdp:'v=0\r\n',studentId:'alex',language:'en',mode:'finance',role:'student',enableLiveMemory:true,followUpProtocol:'student-follow-up-v1',openingDecision:{opening:{title:'FORGED_OPENING_SENTINEL'}},...body})]),{url:'/api/profile-voice',method:'POST',origenAuthorized:true,origenIdentity:{sub:'other'},headers:{host:'127.0.0.1:5173',origin:'http://127.0.0.1:5173','content-type':'application/json','x-origen-session':id}});
  await handler(req,{writeHead(value){status=value;},end(value){output=JSON.parse(value);}},()=>assert.fail('wrong route'));assert.equal(status,expected,JSON.stringify(output));return output;
 });
 await negotiate({action:'prepare'});assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_conversation_openings WHERE account_id=$1',[f.account])).rows[0].n,0);
 const first=await negotiate({});assert.ok(first.openingClaim);assert.match(providerInputs[0],/STUDENT-CONTROLLED CHECK-IN/);assert.doesNotMatch(providerInputs[0],/FORGED_OPENING_SENTINEL/);
 const second=await negotiate({voiceProtocol:'live-v1',memorySessionId:first.liveMemorySession.id});assert.equal(second.voiceProvider,'live');assert.equal(second.openingClaim,undefined);assert.match(providerInputs[1],/conversation_already_considered/);assert.doesNotMatch(providerInputs[1],/STUDENT-CONTROLLED CHECK-IN|FORGED_OPENING_SENTINEL/);
 assert.equal((await f.load()).state,'scheduled');assert.equal((await f.load()).presentations.length,0);
 await f.evidence(first.openingClaim,{action:'release'});providerFailure=true;const failed=randomUUID();await negotiate({},failed,502);
 assert.equal((await f.owner.query('SELECT state FROM origen_conversation_openings WHERE account_id=$1 AND conversation_id=$2',[f.account,failed])).rows[0].state,'released');
 assert.equal((await f.pick({}, {conversationId:failed,memorySessionId:first.liveMemorySession.id})).opening,null);
});
