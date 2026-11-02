import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {studentFollowUpFixture} from './fixtures/student-follow-up.mjs';
import {createLiveMemoryRepository} from './live-memory.mjs';
import {validateOutcomeRecording,outcomeRecordingIntent,outcomeShareWording} from '../src/outcomeRecording.mjs';
import {voiceSession} from './profile-voice.mjs';
import {studentLiveSession} from './student-live-session.mjs';
const db={skip:!process.env.DATABASE_TEST_URL,timeout:90000};
const episode=()=>({definitionId:'document_submitted',definitionVersion:1,scope:{institution:'Example University',term:'2026–2027',cycle:'Insurance documents'},window:{start:'2026-01-01',end:'2026-12-31',timeZone:'America/Chicago'}});
const payload=id=>({link:{episode:episode(),report:{id,version:1},responseState:'answered',claimStatus:'occurred',decision:null},correction:null,replaces:null});
async function fixture(t){
 const f=await studentFollowUpFixture(t);Object.assign(f.env,{ORIGEN_STUDENT_FOLLOW_UP:'true',ORIGEN_OUTCOME_EVIDENCE:'true'});const prepared=(await f.httpCall('other','/api/student-follow-up-report',{action:'prepare',studentId:'alex',target:f.target,operationId:randomUUID(),planVersion:f.plan.version,language:'en',payload:{report:{responseState:'answered',reportedAction:'completed',reportedOutcome:'pending',detail:'PRIVATE_REPORT_SENTINEL',helpfulness:null,occurredOn:null,timeZone:'America/Chicago'},planStatus:null}})).preview;
 const report=(await f.httpCall('other','/api/student-follow-up-report',{action:'confirm',studentId:'alex',previewId:prepared.id,digest:prepared.digest,confirmed:true})).reportId;
 const call=(body,actor='other')=>f.httpCall(actor,'/api/outcome-evidence',{studentId:'alex',...body});
 const prepare=async(extra={})=>(await call({action:'prepare',operationId:randomUUID(),target:f.target,planVersion:(await f.plans()).plans[0].version,payload:payload(report),language:'en',...extra})).preview;
 const confirm=p=>call({action:'confirm',previewId:p.id,digest:p.digest,confirmed:true});
 const load=()=>call({action:'load',target:f.target});
 const memory=input=>f.as('other',()=>createLiveMemoryRepository(f.db,f.env)('other',input));
 const session=async()=>memory({action:'open',studentId:'alex',revision:(await f.owner.query("SELECT revision FROM origen_memory_scopes WHERE account_id=$1 AND scope_key='alex'",[f.account])).rows[0]?.revision||0});
 const turn=async(s,sequence,transcript,language='en')=>{const e={sessionId:s.id,sequence,turnId:randomUUID(),transcript};await memory({action:'turn',...e,language});return e;};
 const voice=(e,body)=>f.httpCall('other','/api/student-follow-up-voice',{...e,...body});
 return {...f,outcome:call,outcomePrepare:prepare,outcomeConfirm:confirm,outcomes:load,report,memory,session,turn,voice};
}
test('outcome requests require deliberate intent and reject invented authority',()=>{
 for(const words of ['Save an outcome for Ask the office.','Please record evidence for Ask the office.','Registra un resultado para Ask the office.','Corrige la evidencia para Ask the office.'])assert.equal(outcomeRecordingIntent(words),true,words);
 for(const words of ['I submitted it.','The waiver was approved.','Do not save this outcome.','No registres el resultado.','yes'])assert.equal(outcomeRecordingIntent(words),false,words);
 const p=payload(randomUUID());assert.deepEqual(validateOutcomeRecording(p),p);
 for(const extra of [{verified:true},{assessment:'supports'},{planStatus:'complete'},{share:true}])assert.throws(()=>validateOutcomeRecording({...p,...extra}),{status:400});
 assert.throws(()=>validateOutcomeRecording({...p,correction:{detail:'Correction',occurredOn:'2026-02-30',timeZone:'UTC'}}),{status:400});
});
test('both providers expose outcome tools only when server capability is enabled',()=>{
 const input={language:'en',role:'student',mode:'finance',studentId:'alex',studentFollowUpVoice:true,studentOutcomeVoice:true,liveMemoryEnabled:true};
 const config=voiceSession(input,{});assert.ok(config.tools.some(t=>t.name==='prepare_student_outcome_evidence'));assert.match(config.instructions,/Student-selected outcome evidence/);assert.match(JSON.stringify(studentLiveSession(config,input)),/Student-selected outcome evidence/);
 for(const change of [{studentOutcomeVoice:false},{studentFollowUpVoice:false},{role:'parent'},{onboarding:true},{liveMemoryWriteEnabled:false}])assert.ok(!voiceSession({...input,...change},{}).tools.some(t=>t.name==='prepare_student_outcome_evidence'));
});
test('exact preview saves a version-bound link only once, with no action, check-in, sharing or evaluation effects',db,async t=>{
 const f=await fixture(t),plan=(await f.plans()).plans[0],before=await f.staff({action:'read',id:f.request.id});
 assert.equal((await f.outcomes()).canRecord,true);const p=await f.outcomePrepare();assert.equal(p.payload.snapshot.statement,'PRIVATE_REPORT_SENTINEL');assert.equal((await f.outcomes()).evidence.length,0);
 const saved=await f.outcomeConfirm(p);assert.equal(saved.status,'saved');assert.equal((await f.outcomeConfirm(p)).evidenceId,saved.evidenceId);
 const data=await f.outcomes(),e=data.episodes[0],r=data.evidence[0];assert.equal(e.definition_id,'document_submitted');assert.equal(e.definition_version,1);assert.equal(e.accepted_plan_version,plan.version);assert.equal(r.report_id,f.report);assert.equal(r.report_version,1);assert.equal(r.statement,'PRIVATE_REPORT_SENTINEL');assert.equal(r.event_on,null);assert.equal(r.date_precision,'unknown');assert.equal(r.institution_verified,false);assert.equal(r.evaluation_allowed,false);assert.equal(r.assessment,'not_assessed');assert.equal(data.evidence.length,1);
 assert.equal((await f.load()).state,'off');assert.deepEqual((await f.plans()).plans[0],plan);assert.deepEqual(await f.staff({action:'read',id:f.request.id}),before);
 assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_follow_up_proposals WHERE payload IS NOT NULL')).rows[0].n,0);
});
test('canonical correction, replacement and episode renewal are atomic; stale approvals and deletion never resurrect evidence',db,async t=>{
 const f=await fixture(t),first=await f.outcomeConfirm(await f.outcomePrepare()),old=(await f.outcomes()).episodes[0];
 const input=payload(f.report);input.replaces={id:first.evidenceId,version:1};input.correction={detail:'I submitted my employer letter.',occurredOn:'2026-10-01',timeZone:'America/Chicago'};input.link.claimStatus='pending';
 const a=await f.outcomePrepare({payload:input}),b=await f.outcomePrepare({payload:{...input,correction:{...input.correction,detail:'Correction wins.'}}});assert.equal(a.payload.renew,true);
 const saved=await f.outcomeConfirm(b);assert.equal(saved.version,2);assert.equal(saved.reportVersion,2);await assert.rejects(f.outcomeConfirm(a),{status:409});
 const data=await f.outcomes();assert.equal(data.evidence.length,1);assert.equal(data.evidence[0].statement,'Correction wins.');assert.equal(data.evidence[0].report_version,2);assert.equal(data.episodes[0].version,old.version+1);assert.equal(data.episodes[0].state,'current');assert.equal((await f.load()).reports[0].detail,'Correction wins.');
 await f.outcome({action:'delete-episode',target:f.target,id:data.episodes[0].id,version:data.episodes[0].version});assert.equal((await f.outcomeConfirm(b)).status,'superseded');assert.equal((await f.outcomes()).evidence.length,0);
});
test('changes to exact report, action, source, permission, restore or flag reject a pending approval',db,async t=>{
 for(const change of ['report','action','source','permission','restore','flag'])await t.test(change,async t=>{
  const f=await fixture(t),p=await f.outcomePrepare();
  if(change==='report'){await f.owner.query("UPDATE origen_student_follow_up_reports SET version=version+1,detail='New wording' WHERE id=$1",[f.report]);assert.equal((await f.owner.query("SELECT count(*)::int n FROM origen_follow_up_proposals WHERE kind='outcome' AND payload IS NOT NULL")).rows[0].n,0);}
  if(change==='action')await f.edit(p=>{p.steps[0].action='Changed action';return p;});
  if(change==='source')await f.reply(1);
  if(change==='permission'){await f.owner.query("UPDATE origen_accounts SET role='parent' WHERE id=$1",[f.account]);await f.owner.query("UPDATE origen_accounts SET role='student' WHERE id=$1",[f.account]);}
  if(change==='restore')await f.owner.query('SELECT origen_follow_up_conversations_after_restore()');
  if(change==='flag')f.env.ORIGEN_OUTCOME_EVIDENCE='false';
  await assert.rejects(f.outcomeConfirm(p));assert.equal((await f.outcomes()).evidence.length,0);assert.equal((await f.plans()).plans[0].steps[0].status,'not-started');
 });
});
test('ownership, endpoint kind and correction field boundaries cannot be bypassed',db,async t=>{
 const f=await fixture(t),p=await f.outcomePrepare();
 await assert.rejects(f.outcome({action:'confirm',previewId:p.id,digest:p.digest,confirmed:true},'reader'));
 await assert.rejects(f.httpCall('other','/api/student-follow-up-report',{action:'confirm',studentId:'alex',previewId:p.id,digest:p.digest,confirmed:true}),{status:409});
 await assert.rejects(f.outcomePrepare({payload:{...payload(f.report),correction:{detail:'I won',occurredOn:null,timeZone:'America/Chicago',helpfulness:'helpful'}}}),{status:400});
 await assert.rejects(f.as('other',()=>f.db.query("SELECT origen_outcome_recording_commit(null,null,null,null,'{}')")),{code:'42501'});
 assert.equal((await f.outcomes()).evidence.length,0);
});
test('declined/unknown responses preserve missing facts and a denied decision never becomes waiver approval',db,async t=>{
 const f=await fixture(t);
 for(const state of ['declined','unknown']){
  const report=await f.seedReport();await f.owner.query("UPDATE origen_student_follow_up_reports SET response_state=$2,reported_action=NULL,reported_outcome=NULL,detail='',helpfulness=NULL WHERE id=$1",[report,state]);
  const input=payload(report);input.link.responseState=state;input.link.claimStatus=null;await f.outcomeConfirm(await f.outcomePrepare({payload:input}));
 }
 const input=payload(f.report);input.link.episode.definitionId='decision_received';input.link.decision='denied';await f.outcomeConfirm(await f.outcomePrepare({payload:input}));
 const data=await f.outcomes();assert.equal(data.evidence.filter(e=>e.claim_status===null&&e.event_on===null).length,2);assert.equal(data.evidence.find(e=>e.decision).decision,'denied');assert.ok(!data.episodes.some(e=>e.definition_id==='waiver_approved'));
});
test('coordinator disclosure is a separate exact snapshot; private corrections cannot rewrite it or leak hidden fields',db,async t=>{
 const f=await fixture(t),p=await f.outcomePrepare();await f.outcomeConfirm(p);f.env.ORIGEN_STUDENT_UPDATES='true';
 const text=outcomeShareWording(p.payload.snapshot,'en');assert.match(text,/Submitted the document/);assert.doesNotMatch(text,new RegExp(f.report+'|helpfulness|PRIVATE_PLAN'));
 const d=(await f.student({action:'create',requestKey:randomUUID(),connectionId:f.connection,origin:'notebook',language:'en',kind:'student-update',originalQuestion:text,entries:[],relatedResponse:f.source})).request;
 const preview=(await f.student({action:'preview',id:d.id,version:d.version,wording:'original'})).preview;assert.match(JSON.stringify(preview.selection),/review the evidence/);
 const shared=(await f.student({action:'submit',id:d.id,version:d.version,previewId:preview.id,digest:preview.digest,confirmed:true})).request;await f.sweep();const before=await f.staff({action:'read',id:shared.id});
 await f.owner.query("UPDATE origen_student_follow_up_reports SET version=version+1,detail='LATER_PRIVATE_CORRECTION' WHERE id=$1",[f.report]);
 assert.equal((await f.outcomes()).evidence.length,0);assert.deepEqual(await f.staff({action:'read',id:shared.id}),before);assert.doesNotMatch(JSON.stringify(before),new RegExp(f.report+'|LATER_PRIVATE_CORRECTION|helpfulness|PRIVATE_PLAN'));
});
test('voice request must be independently captured; ordinary answers, wrong action and incomplete playback never save',db,async t=>{
 const f=await fixture(t),s=await f.session(),e=await f.turn(s,1,'I submitted it.');const prep={action:'prepare',kind:'outcome',target:f.target,payload:payload(f.report),operationId:randomUUID(),timeZone:'America/Chicago'};
 assert.equal((await f.voice(e,prep)).status,'not_requested');assert.equal((await f.voice(e,{action:'outcome-reports',target:f.target})).status,'not_requested');await assert.rejects(f.voice({...e,transcript:'Save an outcome for Ask the office.'},prep),{status:409});
 const e2=await f.turn(s,2,'Save an outcome for Ask the office.');const reports=await f.voice(e2,{action:'outcome-reports',target:f.target});assert.equal(reports.reports[0].id,f.report);assert.ok(!('helpfulness'in reports.reports[0]));
 assert.equal((await f.voice(e2,{...prep,target:{...f.target,stepId:'sibling'}})).status,'clarification_required');
 const prepared=await f.voice(e2,prep);assert.equal(prepared.status,'readback_required');await f.voice(e2,{action:'present',presentation:'Only a partial readback'});
 const next=await f.turn(s,3,'Yes, save it.');assert.equal((await f.voice(next,{action:'confirm'})).status,'approval_required');assert.equal((await f.outcomes()).evidence.length,0);
});
test('Live and Realtime independently capture, play and approve outcome saves in English and Spanish',db,async t=>{
 const {voiceMemoryTools}=await import('../src/voiceMemoryTools.mjs'),{followUpVoiceTools}=await import('../src/followUpVoiceTools.mjs'),{studentLiveChannel}=await import('../src/studentLiveChannel.mjs');
 for(const provider of ['realtime','live'])for(const language of ['en','es'])await t.test(provider+' '+language,async t=>{
  const f=await fixture(t),session=await f.session();let follow,readback,saved=0;
  const memory=voiceMemoryTools({beforeRegister:()=>follow?.settled()||Promise.resolve(),post:body=>f.memory(body)});memory.configure(session);
  follow=followUpVoiceTools({evidence:()=>memory.evidence(),sequence:()=>memory.sequence(),canHear:()=>true,onResponseContext:async guard=>!!guard.source,onSaved:()=>saved++,post:async body=>{const r=await f.voice({},body);if(r.readback)readback=r.readback;return r;}});follow.configure(true,true);
  memory.transcript('request',language==='es'?'Registra un resultado para Ask the office: entregué el documento.':'Save an outcome for Ask the office: I submitted the document.',language);await memory.evidence();
  await follow.invoke({name:'prepare_student_outcome_evidence',call_id:'prepare',arguments:JSON.stringify({target:f.target,payload:payload(f.report)})});assert.ok(readback);assert.match(readback,language==='es'?/No se comparte/:/not shared/);
  const scheduled=new Map();let timer=0;const raw={readyState:'open',send(){},close(){}},channel=studentLiveChannel(raw,{isPlaybackIdle:()=>true,getPlaybackVersion:()=>1,schedule:(fn,ms)=>{scheduled.set(++timer,{fn,ms});return timer;},cancel:id=>scheduled.delete(id)});
  channel.configure({voiceProvider:provider,voiceSession:{tools:[]}});channel.onmessage=({data})=>follow.event(JSON.parse(data));
  if(provider==='live'){raw.onmessage({data:JSON.stringify({type:'session.output_transcript.delta',delta:readback})});await new Promise(r=>setImmediate(r));await [...scheduled.values()].find(v=>v.ms===1800).fn();await new Promise(r=>setImmediate(r));}
  else for(const event of [{type:'response.created',response:{id:'heard'}},{type:'output_audio_buffer.started',response_id:'heard'},{type:'response.output_audio_transcript.done',response_id:'heard',transcript:readback},{type:'response.done',response:{id:'heard',status:'completed'}},{type:'output_audio_buffer.stopped',response_id:'heard'}])raw.onmessage({data:JSON.stringify(event)});
  await follow.settled();assert.equal((await f.outcomes()).evidence.length,0);follow.begin();memory.transcript('approval',language==='es'?'Sí, guárdalo.':'Yes, save it.',language);await memory.evidence();await follow.invoke({name:'confirm_student_follow_up',call_id:'confirm',arguments:'{}'});
  assert.equal(saved,1);assert.equal((await f.outcomes()).evidence.length,1);assert.equal((await f.load()).state,'off');channel.close();follow.stop();memory.stop();
 });
});

test('an approved event-date correction can follow the original report date without replacing creation history',db,async t=>{
 const f=await fixture(t);await f.owner.query("UPDATE origen_student_follow_up_reports SET recorded_at='2026-01-01T12:00:00Z',updated_at='2026-01-01T12:00:00Z' WHERE id=$1",[f.report]);
 const input=payload(f.report);input.correction={detail:'The office accepted it in October.',occurredOn:'2026-10-01',timeZone:'America/Chicago'};input.link.episode.definitionId='document_accepted';
 const saved=await f.outcomeConfirm(await f.outcomePrepare({payload:input}));assert.equal(saved.reportVersion,2);const report=(await f.load()).reports[0];assert.equal(report.occurred_on,'2026-10-01');assert.match(report.recorded_at,/^2026-01-01/);assert.equal((await f.outcomes()).evidence[0].event_on,'2026-10-01');
});

test('spoken correction discovers exact existing outcome versions before a fresh heard approval',db,async t=>{
 const f=await fixture(t),first=await f.outcomeConfirm(await f.outcomePrepare()),s=await f.session(),e=await f.turn(s,1,'Correct my outcome for Ask the office.');
 const choices=await f.voice(e,{action:'outcome-reports',target:f.target}),old=choices.outcomes[0];assert.equal(old.id,first.evidenceId);assert.equal(old.version,1);assert.equal(old.reportVersion,1);assert.ok(!('helpfulness'in old));
 const input=payload(f.report);input.link.episode=old.episode;input.replaces={id:old.id,version:old.version};input.link.claimStatus='pending';
 const p=await f.voice(e,{action:'prepare',kind:'outcome',target:f.target,payload:input,operationId:randomUUID(),timeZone:'America/Chicago'});await f.voice(e,{action:'present',presentation:p.readback});
 const next=await f.turn(s,2,'Yes, save it.');const corrected=await f.voice(next,{action:'confirm'});assert.equal(corrected.version,2);assert.equal(corrected.reportVersion,1);assert.equal((await f.outcomes()).evidence[0].claim_status,'pending');
});

test('removing an outcome invalidates voice context even after cascading evidence deletion',db,async t=>{
 const f=await fixture(t);await f.outcomeConfirm(await f.outcomePrepare());const e=(await f.outcomes()).episodes[0];
 const revision=async()=>(await f.owner.query("SELECT revision FROM origen_memory_scopes WHERE account_id=$1 AND scope_key='alex'",[f.account])).rows[0].revision;
 const before=await revision();await f.outcome({action:'delete-episode',target:f.target,id:e.id,version:e.version});assert.ok(await revision()>before);
});
