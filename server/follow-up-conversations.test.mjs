import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {studentFollowUpFixture} from './fixtures/student-follow-up.mjs';
import {createLiveMemoryRepository} from './live-memory.mjs';
import {validateFollowUpConversation} from './follow-up-conversations.mjs';
import {followUpIntent,followUpSchedule,approvesFollowUp} from '../src/followUpConversation.mjs';
import {voiceSession} from './profile-voice.mjs';
import {studentLiveSession} from './student-live-session.mjs';
import {followUpVoiceInstructions} from './follow-up-voice-tools.mjs';
const db={skip:!process.env.DATABASE_TEST_URL,timeout:90000};
const report={responseState:'answered',reportedAction:'completed',reportedOutcome:'pending',detail:'I called, and they still need my employer letter.',helpfulness:null,occurredOn:null,timeZone:'America/Chicago'};
const payload={report,planStatus:null};
async function fixture(t){
 const f=await studentFollowUpFixture(t);f.env.ORIGEN_STUDENT_FOLLOW_UP='true';
 const call=input=>f.httpCall('other','/api/student-follow-up-report',{studentId:'alex',...input});
 const prepare=async(extra={})=>(await call({action:'prepare',target:f.target,operationId:randomUUID(),planVersion:(await f.plans()).plans[0].version,payload,language:'en',...extra})).preview;
 const confirm=p=>call({action:'confirm',previewId:p.id,digest:p.digest,confirmed:true});
 const memory=input=>f.as('other',()=>createLiveMemoryRepository(f.db,f.env)('other',input));
 const session=async()=>memory({action:'open',studentId:'alex',revision:(await f.owner.query("SELECT revision FROM origen_memory_scopes WHERE account_id=$1 AND scope_key='alex'",[f.account])).rows[0]?.revision||0});
 const turn=async(s,sequence,transcript,language='en')=>{const e={sessionId:s.id,sequence,turnId:randomUUID(),transcript};await memory({action:'turn',...e,language});return e;};
 const voice=(e,body)=>f.httpCall('other','/api/student-follow-up-voice',{...e,...body});
 return {...f,reportCall:call,reportPrepare:prepare,reportConfirm:confirm,memory,session,turn,voice};
}
test('independent intent, explicit approval, calendar dates and closed HTTP evidence contracts',()=>{
 for(const [text,kind] of [['Check in with me next time about Ask the office.','check-in'],['Recuérdame la próxima vez sobre Ask the office.','check-in'],['Save a private update about Ask the office: I called.','report'],['Guarda una actualización privada: llamé.','report'],['Stop all my check-ins.','stop-all'],['Cancela todos mis seguimientos.','stop-all'],['Stop this check-in.','stop'],['No me recuerdes esto.','stop'],['Stop checking in about Ask the office.','stop'],["Don't remind me about this.",'stop'],['Deja de recordarme esto.','stop']])assert.equal(followUpIntent(text),kind,text);
 for(const text of ['I called the office.','Yes.','I am waiting.','The waiver was approved.','Do not save this update.','No guardes esta actualización.'])assert.equal(followUpIntent(text),'none');
 for(const text of ['yes','sí','yes save it but change the result','no','not now'])assert.equal(approvesFollowUp(text),false);
 assert.ok(approvesFollowUp('Yes, save it.'));assert.ok(approvesFollowUp('Sí, guárdalo.'));
 const now=new Date('2026-11-02T01:00:00Z');assert.equal(followUpSchedule('Remind me tomorrow','America/Los_Angeles',now).onOrAfter,'2026-11-02');assert.equal(followUpSchedule('Retoma el 3 de noviembre de 2026','America/Chicago',now).onOrAfter,'2026-11-03');assert.equal(followUpSchedule('Check in November 3, 2026','America/Chicago',now).onOrAfter,'2026-11-03');
 for(const text of ['next week','next Tuesday','2026-02-30','tomorrow or next time','2026-11-03 or 2026-11-04'])assert.equal(followUpSchedule(text,'America/Chicago',now),null,text);
 const value={action:'confirm',sessionId:randomUUID(),sequence:2,turnId:'second',transcript:'Yes, save it.'};assert.deepEqual(validateFollowUpConversation(value,true),value);
 for(const extra of [{accepted:true},{studentId:'someone'},{previewId:randomUUID()},{audible:true},{presentationHash:'a'.repeat(64)}])assert.throws(()=>validateFollowUpConversation({...value,...extra},true),{status:400});
});
test('Live and Realtime advertise the same guarded private tools only with server permission',()=>{
 const input={language:'en',role:'student',mode:'finance',studentId:'alex',studentFollowUpVoice:true,liveMemoryEnabled:true};
 const real=voiceSession(input,{});assert.ok(real.instructions.includes(followUpVoiceInstructions));assert.ok(real.tools.some(t=>t.name==='confirm_student_follow_up'));
 const live=studentLiveSession(real,input);assert.match(JSON.stringify(live),/Speaking private check-ins/);
 for(const extra of [{studentFollowUpVoice:false},{role:'parent'},{mode:'profile'},{onboarding:true},{liveMemoryWriteEnabled:false},{liveMemoryEnabled:false}])assert.ok(!voiceSession({...input,...extra},{}).tools.some(t=>t.name==='prepare_student_check_in'));
});
test('private exact preview commits report and explicitly chosen canonical status atomically, idempotently and without sharing',db,async t=>{
 const f=await fixture(t),before=(await f.owner.query('SELECT count(*)::int n FROM origen_coordinator_outbox')).rows[0].n;
 const p=await f.reportPrepare({payload:{...payload,planStatus:'complete'}});assert.equal((await f.load()).reports.length,0);assert.equal((await f.plans()).plans[0].steps[0].status,'not-started');
 const saved=await f.reportConfirm(p);assert.equal(saved.status,'saved');assert.equal((await f.reportConfirm(p)).reportId,saved.reportId);
 const state=await f.load();assert.equal(state.reports.length,1);assert.equal(state.reports[0].reported_outcome,'pending');assert.equal(state.reports[0].provenance,'student_reported');assert.equal(state.reports[0].occurred_on,null);assert.equal(state.state,'off');assert.equal((await f.plans()).plans[0].steps[0].status,'complete');
 assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_coordinator_outbox')).rows[0].n,before);
 assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_follow_up_proposals WHERE payload IS NOT NULL')).rows[0].n,0);
 const coordinator=await f.staff({action:'list'});assert.doesNotMatch(JSON.stringify(coordinator),/employer letter|reported_outcome|helpfulness|follow_up/);
});
test('private corrections replace the current report; deletion and stale retries never recreate it; off still allows deletion',db,async t=>{
 const f=await fixture(t),a=await f.reportPrepare(),saved=await f.reportConfirm(a);
 const b=await f.reportPrepare({payload:{...payload,report:{...report,detail:'Actually I emailed, and am still waiting.',reportedAction:'attempted'},reportId:saved.reportId,reportVersion:1}});
 const corrected=await f.reportConfirm(b);assert.equal(corrected.version,2);assert.equal((await f.reportConfirm(a)).status,'superseded');assert.equal((await f.load()).reports[0].detail,'Actually I emailed, and am still waiting.');
 f.env.ORIGEN_STUDENT_FOLLOW_UP='false';await f.call({action:'delete-report',operationId:randomUUID(),reportId:saved.reportId,revision:2});assert.equal((await f.load()).reports.length,0);
 f.env.ORIGEN_STUDENT_FOLLOW_UP='true';assert.equal((await f.reportConfirm(b)).status,'superseded');assert.equal((await f.load()).reports.length,0);
});
test('source, plan, permission and capability changes reject a prepared report without partial task changes',db,async t=>{
 for(const change of ['source','plan','permission','flag'])await t.test(change,async t=>{
  const f=await fixture(t),p=await f.reportPrepare({payload:{...payload,planStatus:'complete'}});
  if(change==='source')await f.reply(1);if(change==='plan')await f.edit(p=>({...p,title:'Changed title'}));if(change==='permission')await f.owner.query("UPDATE origen_accounts SET role='parent' WHERE id=$1",[f.account]);if(change==='flag')f.env.ORIGEN_STUDENT_FOLLOW_UP='false';
  await assert.rejects(()=>f.reportConfirm(p));assert.equal((await f.load()).reports.length,0);assert.equal((await f.plans()).plans[0].steps[0].status,'not-started');
 });
});
test('both languages require independently registered request, complete readback and immediately subsequent explicit approval',db,async t=>{
 for(const language of ['en','es'])await t.test(language,async t=>{
  const f=await fixture(t),s=await f.session(),e=await f.turn(s,1,language==='es'?'Guarda una actualización privada sobre Ask the office: llamé y espero respuesta.':'Save a private update about Ask the office: I called and am waiting.',language);
  const prepared=await f.voice(e,{action:'prepare',kind:'report',target:f.target,payload,operationId:randomUUID(),timeZone:'America/Chicago'});assert.equal(prepared.status,'readback_required');assert.match(prepared.readback,language==='es'?/No se comparte/:/not shared/);
  assert.equal((await f.load()).reports.length,0);
  const next=await f.turn(s,2,language==='es'?'Sí, guárdalo.':'Yes, save it.',language);assert.equal((await f.voice(next,{action:'confirm'})).status,'approval_required');
  const s2=await f.session(),e2=await f.turn(s2,1,e.transcript,language),p2=await f.voice(e2,{action:'prepare',kind:'report',target:f.target,payload,operationId:randomUUID(),timeZone:'America/Chicago'});
  await f.voice(e2,{action:'present',presentation:p2.readback});const approval=await f.turn(s2,2,next.transcript,language);
  const saved=await f.voice(approval,{action:'confirm'});assert.equal(saved.status,'saved');assert.equal((await f.voice(approval,{action:'confirm'})).reportId,saved.reportId);assert.equal((await f.load()).reports.length,1);assert.equal((await f.plans()).plans[0].steps[0].status,'not-started');
 });
});
test('spoken enrollment derives timing from speech; ambiguity, wrong action, extra turns and vague yes cannot enroll',db,async t=>{
 const f=await fixture(t),s=await f.session();let e=await f.turn(s,1,'Remind me next week about Ask the office.');
 const prep=e=>f.voice(e,{action:'prepare',kind:'check-in',target:f.target,payload:{},operationId:randomUUID(),timeZone:'America/Chicago'});
 assert.equal((await prep(e)).status,'clarification_required');e=await f.turn(s,2,'Remind me next time about Ask the office.');
 const p=await prep(e);assert.equal(p.status,'readback_required');await f.voice(e,{action:'present',presentation:p.readback});e=await f.turn(s,3,'yes');assert.equal((await f.voice(e,{action:'confirm'})).status,'approval_required');assert.equal((await f.load()).state,'off');
 e=await f.turn(s,4,'Yes, save it.');await assert.rejects(()=>f.voice(e,{action:'confirm'}),{status:409});
 e=await f.turn(s,5,'Remind me next time about Ask the office.');const p2=await prep(e);await f.voice(e,{action:'present',presentation:p2.readback});e=await f.turn(s,6,'Yes, save it.');assert.equal((await f.voice(e,{action:'confirm'})).status,'saved');assert.equal((await f.load()).state,'scheduled');assert.equal((await f.load()).schedule.onOrAfter,null);
 f.env.ORIGEN_STUDENT_FOLLOW_UP='false';e=await f.turn(s,7,'Stop all my check-ins.');const stop={action:'stop',operationId:randomUUID()};assert.equal((await f.voice(e,stop)).status,'stopped');assert.equal((await f.load()).state,'off');
 f.env.ORIGEN_STUDENT_FOLLOW_UP='true';await f.enroll();assert.equal((await f.voice(e,stop)).status,'stopped');assert.equal((await f.load()).state,'scheduled','old cancellation does not stop fresh consent');
});
test('private reports and proposal helpers are owner scoped; forged capture and direct table access are denied',db,async t=>{
 const f=await fixture(t),p=await f.reportPrepare();await assert.rejects(()=>f.httpCall('intruder','/api/student-follow-up-report',{action:'confirm',studentId:'alex',previewId:p.id,digest:p.digest,confirmed:true}));
 const s=await f.session(),e=await f.turn(s,1,'I called.');await assert.rejects(()=>f.voice({...e,transcript:'Save an update about Ask the office.'},{action:'prepare',kind:'report',target:f.target,payload,operationId:randomUUID(),timeZone:'America/Chicago'}),{status:409});
 assert.equal((await f.voice(e,{action:'choices'})).status,'not_requested');
 await assert.rejects(()=>f.as('other',()=>f.db.query('SELECT * FROM origen_follow_up_proposals')),{code:'42501'});
 await assert.rejects(()=>f.as('other',()=>f.db.query('SELECT origen_follow_up_conversations_after_restore()')),{code:'42501'});
 assert.equal((await f.load()).reports.length,0);
});

test('declined and unknown are explicit saved choices, never inferred from silence; private exports and restore preserve only current approved reports',db,async t=>{
 const f=await fixture(t);
 const p=await f.reportPrepare({payload:{report:{...report,responseState:'declined',reportedAction:null,reportedOutcome:null,detail:'',helpfulness:null,occurredOn:null},planStatus:null}});
 const first=await f.reportConfirm(p);assert.equal((await f.load()).reports[0].response_state,'declined');
 const next=await f.reportPrepare({payload:{...payload,reportId:first.reportId,reportVersion:1,report:{...report,reportedAction:'unknown',reportedOutcome:'unknown',detail:'I am unsure.'}}});
 await f.reportConfirm(next);const current=(await f.load()).reports[0];assert.equal(current.version,2);assert.equal(current.reported_outcome,'unknown');assert.equal((await f.plans()).plans[0].steps[0].status,'not-started');
 const exported=await f.as('other',async()=>{const c=await f.db.connect();try{return (await c.query("SELECT origen_student_follow_up_command('{\"action\":\"export\"}'::jsonb) AS result")).rows[0].result;}finally{c.release();}});
 assert.equal(exported.reports.length,1);assert.equal(exported.reports[0].detail,'I am unsure.');assert.equal(exported.reports[0].version,2);
 const pending=await f.reportPrepare();await f.owner.query('SELECT origen_follow_up_conversations_after_restore()');await assert.rejects(()=>f.reportConfirm(pending),{status:409});assert.equal((await f.load()).reports.length,1);
});
test('restored permissions and concurrent revisions cannot revive a prepared report or partially apply a task status',db,async t=>{
 const f=await fixture(t),p=await f.reportPrepare();await f.owner.query("UPDATE origen_accounts SET role='parent' WHERE id=$1",[f.account]);await f.owner.query("UPDATE origen_accounts SET role='student' WHERE id=$1",[f.account]);await assert.rejects(()=>f.reportConfirm(p),{status:409});
 assert.equal((await f.load()).reports.length,0);
});
test('competing corrections cannot partially apply a stale task-status change',db,async t=>{
 const f=await fixture(t),first=await f.reportConfirm(await f.reportPrepare()),a=await f.reportPrepare({payload:{...payload,reportId:first.reportId,reportVersion:1,planStatus:'complete'}}),b=await f.reportPrepare({payload:{...payload,reportId:first.reportId,reportVersion:1,report:{...report,detail:'Correction wins.'}}});
 await f.reportConfirm(b);await assert.rejects(()=>f.reportConfirm(a),{status:409});assert.equal((await f.plans()).plans[0].steps[0].status,'not-started');assert.equal((await f.load()).reports[0].detail,'Correction wins.');
});
test('spoken writes honor the live-write kill switch while cancellation remains available',db,async t=>{
 const f=await fixture(t);await f.enroll();const s=await f.session(),e=await f.turn(s,1,'Remind me next time about Ask the office.');f.env.ORIGEN_PERSONALIZATION_LIVE_WRITES='false';
 await assert.rejects(()=>f.voice(e,{action:'prepare',kind:'check-in',target:f.target,payload:{},operationId:randomUUID(),timeZone:'America/Chicago'}),{status:503});
 const stop=await f.turn(s,2,'Stop all my check-ins.');assert.equal((await f.voice(stop,{action:'stop',operationId:randomUUID()})).status,'stopped');assert.equal((await f.load()).state,'off');
});

test('application controller and independent capture save only after a heard readback for both provider paths and languages',db,async t=>{
 const {voiceMemoryTools}=await import('../src/voiceMemoryTools.mjs'),{followUpVoiceTools}=await import('../src/followUpVoiceTools.mjs'),{studentLiveChannel}=await import('../src/studentLiveChannel.mjs');
 for(const provider of ['realtime','live'])for(const language of ['en','es'])await t.test(provider+' '+language,async t=>{
  const f=await fixture(t),session=await f.session();let follow,proposal,saved=0;
  const memory=voiceMemoryTools({beforeRegister:()=>follow?.settled()||Promise.resolve(),post:body=>f.memory(body)});memory.configure(session);
  follow=followUpVoiceTools({evidence:()=>memory.evidence(),sequence:()=>memory.sequence(),canHear:()=>true,onResponseContext:async guard=>!!guard.source,onSaved:()=>saved++,post:async body=>{const result=await f.voice({},body);if(result.readback)proposal=result.readback;return result;}});follow.configure(true);
  memory.transcript('request',language==='es'?'Guarda una actualización privada sobre Ask the office: llamé y sigo esperando.':'Save a private update about Ask the office: I called and am waiting.',language);await memory.evidence();
  await follow.invoke({name:'prepare_private_follow_up_update',call_id:'prepare',arguments:JSON.stringify({target:f.target,payload})});assert.ok(proposal);
  const scheduled=new Map();let timer=0;
  const raw={readyState:'open',send(){},close(){}},channel=studentLiveChannel(raw,{isPlaybackIdle:()=>true,getPlaybackVersion:()=>1,schedule:(fn,ms)=>{scheduled.set(++timer,{fn,ms});return timer;},cancel:id=>scheduled.delete(id)});
  channel.configure({voiceProvider:provider,voiceSession:{tools:[]}});channel.onmessage=({data})=>follow.event(JSON.parse(data));
  if(provider==='live'){
   raw.onmessage({data:JSON.stringify({type:'session.output_transcript.delta',delta:proposal})});await new Promise(r=>setImmediate(r));const idle=[...scheduled.values()].find(v=>v.ms===1800);assert.ok(idle);await idle.fn();await new Promise(r=>setImmediate(r));
  }else{
   for(const event of [{type:'response.created',response:{id:'heard'}},{type:'output_audio_buffer.started',response_id:'heard'},{type:'response.output_audio_transcript.done',response_id:'heard',transcript:proposal},{type:'response.done',response:{id:'heard',status:'completed'}},{type:'output_audio_buffer.stopped',response_id:'heard'}])raw.onmessage({data:JSON.stringify(event)});
  }
  await follow.settled();assert.equal((await f.load()).reports.length,0);follow.begin();memory.transcript('approval',language==='es'?'Sí, guárdalo.':'Yes, save it.',language);await memory.evidence();
  await follow.invoke({name:'confirm_student_follow_up',call_id:'confirm',arguments:'{}'});assert.equal(saved,1);assert.equal((await f.load()).reports.length,1);assert.equal((await f.load()).reports[0].reported_outcome,'pending');channel.close();follow.stop();memory.stop();
 });
});

test('spoken tomorrow uses the saved calendar date through spring and fall DST transitions',()=>{
 for(const [instant,expected] of [['2026-03-08T07:59:00Z','2026-03-09'],['2026-03-08T08:01:00Z','2026-03-09'],['2026-11-01T06:30:00Z','2026-11-02'],['2026-11-01T07:30:00Z','2026-11-02'],['2026-11-02T05:59:00Z','2026-11-02'],['2026-11-02T06:01:00Z','2026-11-03']]){
  for(const words of ['Remind me tomorrow','Recuérdame mañana'])assert.deepEqual(followUpSchedule(words,'America/Chicago',new Date(instant)),{onOrAfter:expected,timeZone:'America/Chicago'},`${instant}: ${words}`);
 }
});
