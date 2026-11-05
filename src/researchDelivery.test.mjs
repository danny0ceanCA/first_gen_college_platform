import test from 'node:test';
import assert from 'node:assert/strict';
import {researchDelivery,researchAnswerOverlap} from './researchDelivery.mjs';
import {capturePayload} from './voiceCapture.mjs';
import {discussionExamples} from './researchDiscussion.fixture.mjs';

const examples={
 en:{answer:'The published annual tuition is 12345 dollars at Example University.',qualification:'Housing is separate, and this is not a personalized aid award.',reply:'We can take this one step at a time.',caller:'Can we talk about the essays while you check?',ack:'Mm-hmm.'},
 es:{answer:'La matrícula anual publicada es de 12345 dólares en la Universidad Ejemplo.',qualification:'La vivienda es aparte y no es una oferta de ayuda personal.',reply:'Podemos avanzar juntos un paso a la vez.',caller:'¿Podemos hablar de los ensayos mientras investigas?',ack:'Claro.'},
};
function fixture(){
 let time=0,sequence=0,quiet=true;const tasks=new Map(),sent=[],events=[];
 const delivery=researchDelivery({send:e=>sent.push(e),emit:e=>events.push(e),canAnnounce:()=>quiet,now:()=>time,
  schedule:(fn,ms)=>{const id=++sequence;tasks.set(id,{fn,at:time+ms});return id;},cancel:id=>tasks.delete(id),id:()=>`id-${++sequence}`});
 const advance=ms=>{const end=time+ms;while(true){const next=[...tasks].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;time=next[1].at;tasks.delete(next[0]);next[1].fn();}time=end;};
 return {delivery,sent,events,tasks,advance,quiet:value=>quiet=value,
  ready(language='en',overrides={},options){const x=examples[language];delivery.ready({jobId:'job',requestId:'request',revision:1,question:x.caller,result:{text:x.answer+'\n'+x.qualification,status:'source_check_completed'},...overrides},options);},
  ack(){for(const e of sent.filter(e=>e.type==='session.thinking.append'))delivery.receive({type:'session.thinking.appended',client_event_id:e.event_id});},
  announcements:()=>sent.filter(e=>e.type==='session.commentary.append'),
 };
}

for(const language of ['en','es']){
 const x=examples[language];
 test(`${language}: caller speech and an unrelated reply postpone, then release one research contribution`,()=>{
  const f=fixture();f.ready(language);f.ack();f.delivery.caller();f.advance(5000);assert.equal(f.announcements().length,0);
  f.delivery.reply(x.ack,{audible:true});f.advance(1000);assert.equal(f.announcements().length,0);
  f.delivery.reply(x.reply,{audible:true});f.advance(500);assert.equal(f.announcements().length,1);
  f.advance(60000);assert.equal(f.announcements().length,1);assert.ok(f.events.some(e=>e.deliveryStage==='delivery_unconfirmed'));
  assert.ok(!f.sent.some(e=>['response.create','response.cancel','session.instructions.append','session.input_audio.mute'].includes(e.type)));
 });
 test(`${language}: findings arriving during caller speech wait for the actual reply`,()=>{
  const f=fixture();f.ready(language,{}, {awaitingReply:true});f.ack();f.advance(5000);assert.equal(f.announcements().length,0);
  f.delivery.reply(x.reply,{audible:true});f.advance(500);assert.equal(f.announcements().length,1);
 });
 test(`${language}: audible findings suppress a duplicate; an unrelated acknowledgment does not count as delivery`,()=>{
  const f=fixture();f.ready(language);f.ack();f.delivery.caller();
  f.delivery.reply(x.answer+' '+x.qualification,{audible:true});f.advance(4000);
  assert.equal(f.announcements().length,0);assert.ok(f.events.some(e=>e.deliveryStage==='evidence_overlap_observed'));
  assert.equal(f.tasks.size,0);
 });
 for(const condition of [{audible:false},{audible:true,forced:true},{audible:true,interrupted:true}])test(`${language}: incomplete playback is not counted as delivered ${JSON.stringify(condition)}`,()=>{
  const f=fixture();f.ready(language);f.ack();f.delivery.caller();f.delivery.reply(x.answer,condition);
  assert.ok(!f.events.some(e=>e.deliveryStage==='evidence_overlap_observed'));f.delivery.clear();assert.equal(f.tasks.size,0);
 });
 test(`${language}: a late completion cannot resurrect a cancelled or superseded result`,()=>{
  const f=fixture();f.ready(language);f.delivery.supersede();f.ack();f.advance(5000);assert.equal(f.announcements().length,0);
  f.ready(language);f.advance(5000);assert.equal(f.announcements().length,0,'duplicate completion remains retired');
  f.ready(language,{jobId:'new',requestId:'new',revision:2});f.ack();f.advance(500);assert.equal(f.announcements().length,1);f.delivery.clear();
 });
 test(`${language}: long briefs keep complete qualifications in quiet context and never exceed append bounds`,()=>{
  const f=fixture(),text=x.answer+'\n'+x.qualification.repeat(50);f.ready(language,{result:{text}});f.ack();f.advance(500);
  const packets=f.sent.filter(e=>e.type==='session.thinking.append').map(e=>JSON.parse(e.content));
  const evidence=JSON.parse(packets.map(p=>p.text).join(''));
  assert.equal(evidence.text,text);assert.equal(evidence.taskState,'completed');assert.equal(evidence.researchPending,false);
  assert.ok(f.sent.every(e=>Buffer.byteLength(e.content)<=480));assert.match(f.announcements()[0].content,/Completed research/);f.delivery.clear();
 });
}
test('a partial context acknowledgment cannot produce an announcement',()=>{
 const f=fixture();f.ready('en',{result:{text:examples.en.answer.repeat(20)}});const context=f.sent.filter(e=>e.type==='session.thinking.append');assert.ok(context.length>1);
 f.delivery.receive({type:'session.thinking.appended',client_event_id:context[0].event_id});f.advance(30000);f.ack();f.advance(1000);
 assert.equal(f.announcements().length,0);assert.ok(f.events.some(e=>e.deliveryReason==='context_timeout'));assert.equal(f.tasks.size,0);
});
test('commentary acknowledgment is not spoken delivery and does not trigger retries',()=>{
 const f=fixture();f.ready();f.ack();f.advance(500);const request=f.announcements()[0];
 f.delivery.receive({type:'session.commentary.appended',client_event_id:request.event_id});f.advance(30000);
 assert.ok(f.events.some(e=>e.deliveryStage==='commentary_acknowledged'));assert.ok(f.events.some(e=>e.deliveryReason==='speech_not_observed'));
 assert.equal(f.announcements().length,1);assert.ok(!f.events.some(e=>e.deliveryStage==='evidence_overlap_observed'));
});
for(const language of ['en','es'])test(`${language}: an acknowledgment alone cannot strand a finished result after the caller stops`,()=>{
 const f=fixture();f.ready(language);f.ack();f.delivery.caller();f.delivery.callerStopped();f.delivery.reply(examples[language].ack,{audible:true});
 f.advance(2750);assert.equal(f.announcements().length,0);f.advance(500);assert.equal(f.announcements().length,1);
 f.advance(10000);assert.equal(f.announcements().length,1);f.delivery.clear();
});
test('resumed caller speech revokes the pending result opportunity until that speech ends',()=>{
 const f=fixture();f.ready();f.ack();f.delivery.caller();f.delivery.callerStopped();f.advance(2000);f.delivery.caller();f.advance(5000);
 assert.equal(f.announcements().length,0);f.delivery.callerStopped();f.advance(3000);assert.equal(f.announcements().length,1);f.delivery.clear();
});
test('interrupting a requested update never queues a repeated announcement',()=>{
 const f=fixture();f.ready();f.ack();f.advance(500);f.delivery.caller();f.delivery.reply(examples.en.reply,{audible:true});f.advance(10000);
 assert.equal(f.announcements().length,1);assert.ok(f.events.some(e=>e.deliveryStage==='interrupted'));assert.equal(f.tasks.size,0);
});
for(const kind of ['context','commentary'])test(`${kind} provider errors retire delivery without replay`,()=>{
 const f=fixture();f.ready();if(kind==='commentary'){f.ack();f.advance(500);}
 const event=kind==='context'?f.sent[0]:f.announcements()[0];
 f.delivery.receive({type:'error',error:{client_event_id:event.event_id}});f.ack();f.advance(60000);
 assert.equal(f.announcements().length,kind==='context'?0:1);assert.ok(f.events.some(e=>e.deliveryReason===kind+'_error'));assert.equal(f.tasks.size,0);
});
test('failure speaks no fabricated findings and never restarts research',()=>{
 const f=fixture();f.ready('en',{result:{status:'research_failed'}});f.ack();f.advance(500);
 assert.match(f.announcements()[0].content,/failed.*No verified findings/);assert.equal(f.sent.filter(e=>e.type==='response.create').length,0);f.delivery.clear();
});
test('long ongoing conversation explicitly defers unsolicited delivery without a silence prompt',()=>{
 const f=fixture();f.ready();f.ack();f.delivery.caller();f.advance(120000);
 assert.equal(f.announcements().length,0);assert.ok(f.events.some(e=>e.deliveryReason==='opportunity_expired'));assert.equal(f.tasks.size,0);
});
test('overlap does not infer success from topic words, progress promises, or a different figure',()=>{
 const answer=examples.en.answer;
 assert.equal(researchAnswerOverlap(answer,'Mm-hmm. I am still checking tuition at Example University.'),false);
 assert.equal(researchAnswerOverlap(answer,answer.replace('12345','99999')),false);
 assert.equal(researchAnswerOverlap(answer,answer),true);
 assert.equal(researchAnswerOverlap(answer,examples.en.qualification),false);
});
test('private delivery diagnostics retain correlation and stage without copied content',()=>{
 const payload=capturePayload({type:'origen.research.delivery',jobId:'job',revision:1,deliveryStage:'deferred',deliveryReason:'caller_turn',durationMs:123,question:'PRIVATE',text:'PRIVATE'});
 assert.equal(payload.jobId,'job');assert.equal(payload.deliveryStage,'deferred');assert.doesNotMatch(JSON.stringify(payload),/PRIVATE/);
});

for(const [language,example]of Object.entries({
 en:{subject:'North Campus',answer:'For 2026–27 entering transfers, the admission application serves as the campus-scholarship application; the published minimum GPA is 3.25. Current awards range from USD 100–17,000 per academic year. [1]',spoken:'North Campus scholarships use the admission application, and they say the published minimum GPA is three point two five.',thanks:'Yeah, that is all helpful.'},
 es:{subject:'Campus Norte',answer:'Para los estudiantes de transferencia de 2026–27, la solicitud de admisión sirve como solicitud de becas; el promedio mínimo publicado es 3.25. Los premios actuales varían entre USD 100–17,000 por año académico. [1]',spoken:'Las becas de Campus Norte usan la solicitud de admisión y el promedio mínimo publicado es tres punto veinticinco.',thanks:'Sí, todo eso me ayuda.'},
}))test(`${language}: a native scholarship explanation retires an optional award-range addendum`,()=>{
 const f=fixture(),finding={subject:example.subject,aspect:'eligibility',status:'verified',answer:example.answer,qualification:'Published program rules do not establish an individual award. [1]'};
 const result={sources:[{url:'https://example.edu/scholarships'}],voiceBrief:{status:'verified',answer:finding.answer,qualification:finding.qualification,nextStep:'',findings:[finding]}};
 f.ready(language,{question:'Scholarship requirements',result},{awaitingReply:true});f.ack();
 f.delivery.reply(example.spoken,{audible:true});
 assert.ok(f.events.some(e=>e.deliveryStage==='native_portion_observed'));
 f.delivery.caller();f.delivery.callerStopped(example.thanks);f.delivery.reply(examples[language].reply,{audible:true});f.advance(10000);
 assert.equal(f.announcements().length,0,'unused award figures do not create an unsolicited second turn');
 f.ready(language,{question:'Scholarship requirements',evidenceVersion:2,researchPending:false,result});f.ack();f.advance(10000);
 assert.equal(f.announcements().length,0,'a final revision with the same findings cannot revive the addendum');
 f.delivery.clear();
});
test('ordinary conversation without completed research creates no model work or timed speech',()=>{
 const f=fixture();f.delivery.caller();f.delivery.callerStopped();f.advance(60000);f.delivery.reply(examples.en.reply,{audible:true});f.advance(60000);
 assert.equal(f.sent.length,0);assert.equal(f.tasks.size,0);
});

for(const language of ['en','es'])test(`${language}: new course research does not inherit an earlier tuition focus`,()=>{
 const f=fixture();f.delivery.caller();f.delivery.callerStopped(language==='en'?'What is Berkeley tuition?':'¿Cuál es la matrícula de Berkeley?');
 f.delivery.supersede('new_request',language==='en'?'Does my statistics class transfer to UCSC?':'¿Se transfiere mi clase de estadística a UCSC?');
 const finding={subject:'UC Santa Cruz',aspect:'other',status:'verified',answer:'The statistics course requires an official articulation review [1].',qualification:'Transfer credit is not guaranteed [1].'};
 f.ready(language,{jobId:'course',question:'Statistics transfer credit',result:{sources:[{url:'https://example.edu/transfer'}],voiceBrief:{status:'verified',answer:finding.answer,qualification:finding.qualification,nextStep:'',findings:[finding]}}});
 f.ack();f.delivery.reply(examples[language].reply,{audible:true});f.advance(500);
 assert.equal(f.announcements().length,1);assert.ok(!f.events.some(e=>e.deliveryReason==='different_requested_portion'));f.delivery.clear();
});
for(const [language,{answer,spoken}] of Object.entries(discussionExamples))test(`${language}: a paraphrased native answer before context ack retires the opportunity without a redundant caveat`,()=>{
 const f=fixture();f.ready(language,{result:{text:answer}}, {awaitingReply:true});
 // Live can use context before its final acknowledgment. Recognition must work
 // on that actual reply, not depend on the order of the context ACK.
 f.delivery.reply(spoken,{audible:true});f.ack();f.advance(4000);
 f.delivery.caller();f.delivery.callerStopped();f.delivery.reply(examples[language].ack,{audible:true});f.advance(10000);
 assert.equal(f.announcements().length,0);assert.equal(f.events.filter(e=>e.deliveryStage==='evidence_overlap_observed').length,1);
 assert.equal(f.tasks.size,0);assert.ok(f.sent.every(e=>e.type==='session.thinking.append'));
});
for(const reason of ['cancelled','scope_changed','call_ended'])test(`${reason} clears a pending delivery and rejects its late acknowledgment`,()=>{
 const f=fixture();f.ready();f.delivery.clear(reason);f.ack();f.advance(60000);
 assert.equal(f.announcements().length,0);assert.equal(f.tasks.size,0);assert.ok(f.events.some(e=>e.deliveryReason===reason));
});

for(const language of ['en','es'])test(`${language}: initial findings are usable during recovery; final context cannot repeat a native partial answer`,()=>{
 const f=fixture(),finding={subject:'UC Santa Cruz — entering undergraduates, 2026–27',aspect:'tuition_fees',status:'partial',answer:'Annual tuition $17,490; additional nonresident tuition $39,270. [1]',qualification:'The fee subtotal remains unresolved. [1]'};
 const result={sources:[{url:'https://example.edu/costs'}],voiceBrief:{status:'partial',answer:finding.answer,qualification:finding.qualification,nextStep:'',findings:[finding]}};
 f.ready(language,{question:'UC Santa Cruz tuition',evidenceVersion:1,researchPending:true,result});f.ack();
 let packets=f.sent.filter(e=>e.type==='session.thinking.append').map(e=>JSON.parse(e.content));
 let context=JSON.parse(packets.map(p=>p.text).join(''));assert.equal(context.researchPending,true);assert.equal(context.taskState,'running');
 f.delivery.reply(language==='en'?'UC Santa Cruz tuition is about seventeen thousand four hundred dollars annually.':'La matrícula de UC Santa Cruz es de unos diecisiete mil cuatrocientos dólares al año.',{audible:true});
 f.advance(1000);assert.equal(f.announcements().length,0);assert.ok(f.events.some(e=>e.deliveryStage==='native_portion_observed'));
 const count=f.sent.length;
 f.ready(language,{question:'UC Santa Cruz tuition',evidenceVersion:2,researchPending:false,result});f.ack();f.advance(10000);
 assert.equal(f.announcements().length,0);packets=f.sent.slice(count).filter(e=>e.type==='session.thinking.append').map(e=>JSON.parse(e.content));
 context=JSON.parse(packets.map(p=>p.text).join(''));assert.equal(context.researchPending,false);assert.equal(context.evidenceVersion,2);
 f.ready(language,{evidenceVersion:1,researchPending:true,result});assert.equal(f.sent.length,count+packets.length,'late initial revision cannot replace final facts');f.delivery.clear();
});

test('initial evidence can announce before recovery and final revision only refreshes context',()=>{
 const f=fixture();f.ready('en',{evidenceVersion:1,researchPending:true});f.ack();f.advance(500);
 assert.equal(f.announcements().length,1);assert.match(f.announcements()[0].content,/Initial sourced findings/);
 f.ready('en',{evidenceVersion:2,researchPending:false});f.ack();f.advance(5000);assert.equal(f.announcements().length,1);f.delivery.clear();
});

test('quiet recovery updates still report failed context delivery without replaying speech',()=>{
 const f=fixture();f.ready('en',{evidenceVersion:1,researchPending:true});f.ack();f.advance(500);
 f.ready('en',{evidenceVersion:2,researchPending:false});
 const packet=f.sent.filter(e=>e.type==='session.thinking.append').at(-1);
 f.delivery.receive({type:'error',client_event_id:packet.event_id});f.advance(5000);
 assert.equal(f.announcements().length,1);assert.ok(f.events.some(e=>e.evidenceVersion===2&&e.deliveryReason==='context_error'));f.delivery.clear();
});

const budgetScripts={
 en:{question:'What is Berkeley’s total cost of attendance?',scenario:'He will be living off campus.',housingOnly:'Just the housing cost, please.',
  answer:'UC Berkeley’s 2026–27 off-campus total is $49,692. [1]',qualification:'Published undergraduate budget before aid; not a personal bill. [1]',
  unknown:'I could not verify UC Berkeley’s off-campus total budget.',ack:'Thanks. We can talk about the essay while that runs.'},
 es:{question:'¿Cuál es el presupuesto total de Berkeley?',scenario:'Estaría viviendo fuera del campus.',housingOnly:'Solo el costo de la vivienda, por favor.',
  answer:'El total de UC Berkeley fuera del campus en 2026–27 es $49,692. [1]',qualification:'Presupuesto publicado antes de ayuda; no una factura personal. [1]',
  unknown:'No pude verificar el presupuesto total de UC Berkeley fuera del campus.',ack:'Gracias. Podemos hablar del ensayo mientras se revisa eso.'},
};
function budgetResult(script,{unknown=false,extra=[]}={}){
 const finding={subject:'UC Berkeley',aspect:'total_budget',status:unknown?'unverified':'verified',answer:unknown?script.unknown:script.answer,qualification:unknown?'The source did not establish this requested figure.':script.qualification};
 return {sources:[{url:'https://example.edu/budget'}],voiceBrief:{status:unknown?'partial':'verified',answer:finding.answer,qualification:finding.qualification,nextStep:'',findings:[finding,...extra]}};
}
for(const [language,s] of Object.entries(budgetScripts)){
 test(`${language}: housing scenario preserves the requested total and commentary includes its complete qualified finding`,()=>{
  const f=fixture();f.delivery.supersede('new_request',s.question);f.delivery.caller();f.delivery.callerStopped(s.scenario);
  f.ready(language,{question:s.question,result:budgetResult(s)});f.ack();f.delivery.reply(s.ack,{audible:true});f.advance(500);
  assert.equal(f.announcements().length,1);const content=f.announcements()[0].content;
  assert.ok(content.includes(s.answer));assert.ok(content.includes(s.qualification));assert.match(content,/UC Berkeley/);
  assert.match(content,/check has ended/);assert.match(content,/Do not say still checking/);
  assert.ok(Buffer.byteLength(content)<=480);assert.ok(!f.events.some(e=>e.deliveryReason==='different_requested_portion'));f.delivery.clear();
 });
 test(`${language}: explicit housing-only follow-up is not satisfied by a total-budget finding`,()=>{
  const f=fixture();f.delivery.supersede('new_request',s.question);f.delivery.caller();f.delivery.callerStopped(s.housingOnly);
  f.ready(language,{question:s.question,result:budgetResult(s)});f.ack();f.delivery.reply(s.ack,{audible:true});f.advance(500);
  assert.equal(f.announcements().length,0);assert.ok(f.events.some(e=>e.deliveryReason==='different_requested_portion'));f.delivery.clear();
 });
 for(const initial of ['native','commentary'])test(`${language}: ${initial} partial answer does not suppress newly verified requested total`,()=>{
  const f=fixture();f.delivery.supersede('new_request',s.question);
  f.ready(language,{question:s.question,evidenceVersion:1,researchPending:true,result:budgetResult(s,{unknown:true})});f.ack();
  if(initial==='native')f.delivery.reply(s.unknown,{audible:true});
  else f.advance(500);
  const before=f.announcements().length;
  f.ready(language,{question:s.question,evidenceVersion:2,researchPending:false,result:budgetResult(s)});f.ack();f.advance(500);
  assert.equal(f.announcements().length,before+1);const content=f.announcements().at(-1).content;
  assert.ok(content.includes(s.answer));assert.ok(content.includes(s.qualification));assert.doesNotMatch(content,/recovery is running/);
  f.delivery.reply(s.answer+' '+s.qualification,{audible:true});f.advance(60000);
  assert.equal(f.announcements().length,before+1);assert.ok(!f.sent.some(e=>['response.create','response.cancel','session.instructions.append'].includes(e.type)));f.delivery.clear();
 });
 test(`${language}: an unchanged completed finding remains quiet after its initial contribution`,()=>{
  const f=fixture();f.delivery.supersede('new_request',s.question);
  f.ready(language,{question:s.question,evidenceVersion:1,researchPending:true,result:budgetResult(s)});f.ack();f.advance(500);
  f.ready(language,{question:s.question,evidenceVersion:2,researchPending:false,result:budgetResult(s)});f.ack();f.advance(5000);
  assert.equal(f.announcements().length,1);assert.ok(f.events.some(e=>e.deliveryReason==='recovery_context_only'));f.delivery.clear();
 });
 test(`${language}: unrelated recovery finding does not repeat the already supplied total`,()=>{
  const f=fixture();f.delivery.supersede('new_request',s.question);
  f.ready(language,{question:s.question,evidenceVersion:1,researchPending:true,result:budgetResult(s)});f.ack();f.advance(500);
  const housing={subject:'UC Berkeley',aspect:'housing',status:'verified',answer:'Housing allowance is $15000. [1]',qualification:'Estimated allowance, not billed tuition. [1]'};
  f.ready(language,{question:s.question,evidenceVersion:2,researchPending:false,result:budgetResult(s,{extra:[housing]})});f.ack();f.advance(5000);
  assert.equal(f.announcements().length,1);f.delivery.clear();
 });
 test(`${language}: pending new evidence stays eligible across a terminal status-only refresh`,()=>{
  const f=fixture();f.delivery.supersede('new_request',s.question);
  f.ready(language,{question:s.question,evidenceVersion:1,researchPending:true,result:budgetResult(s,{unknown:true})});f.ack();f.advance(500);
  f.quiet(false);
  f.ready(language,{question:s.question,evidenceVersion:2,researchPending:true,result:budgetResult(s)});f.ack();f.advance(1000);
  f.ready(language,{question:s.question,evidenceVersion:3,researchPending:false,result:budgetResult(s)});f.ack();f.quiet(true);f.advance(500);
  assert.equal(f.announcements().length,2);assert.ok(f.announcements().at(-1).content.includes(s.answer));f.delivery.clear();
 });
}

test('source-index and confidence-label changes alone do not repeat the same qualified facts',()=>{
 const f=fixture(),s=budgetScripts.en,initial=budgetResult(s);initial.voiceBrief.findings[0].status='partial';
 f.delivery.supersede('new_request',s.question);f.ready('en',{question:s.question,evidenceVersion:1,researchPending:true,result:initial});f.ack();f.advance(500);
 const final=budgetResult(s);final.sources.unshift({url:'https://example.edu/other'});final.voiceBrief.findings[0].answer=final.voiceBrief.findings[0].answer.replace('[1]','[2]');final.voiceBrief.findings[0].qualification=final.voiceBrief.findings[0].qualification.replace('[1]','[2]');
 f.ready('en',{question:s.question,evidenceVersion:2,researchPending:false,result:final});f.ack();f.advance(1000);
 assert.equal(f.announcements().length,1);assert.ok(f.events.some(e=>e.deliveryReason==='recovery_context_only'));f.delivery.clear();
});

test('the reviewed off-campus result fits inline with its entire population, year, amount and qualification',()=>{
 // Public historical research fixture; these figures are not current-cost advice.
 const f=fixture(),finding={subject:'UC Berkeley — new California-resident undergraduate, off-campus apartment',aspect:'total_budget',status:'verified',
  answer:'2026–27 published academic-year cost of attendance: USD $49,692 before aid. [1]',
  qualification:'An estimated attendance budget, not an individual amount owed. [1]'};
 const question='UC Berkeley off-campus total cost of attendance';
 f.delivery.supersede('new_request',question);
 f.ready('en',{question,result:{sources:[{url:'https://financialaid.berkeley.edu/how-aid-works/student-budgets-cost-of-attendance/'}],voiceBrief:{status:'verified',answer:finding.answer,qualification:finding.qualification,nextStep:'',findings:[finding]}}});
 f.ack();f.advance(500);const content=f.announcements()[0].content;
 assert.ok(content.includes(finding.subject));assert.ok(content.includes(finding.answer));assert.ok(content.includes(finding.qualification));
 assert.ok(Buffer.byteLength(content)<=480);assert.doesNotMatch(content,/Use only the relevant/,'the actual figure must not fall back to an opaque reference');f.delivery.clear();
});
