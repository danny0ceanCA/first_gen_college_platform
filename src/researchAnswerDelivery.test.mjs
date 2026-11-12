import test from 'node:test';
import assert from 'node:assert/strict';
import {researchSpokenFinding,researchCaveatObservation} from './researchAnswerDelivery.mjs';
import {budgetFinding} from './publishedBudget.mjs';
import {researchContextPackets} from './liveResearchContext.mjs';
import {researchDelivery} from './researchDelivery.mjs';
import {decodedResearchContext} from './researchContext.fixture.mjs';
import {studentLiveSession,studentLiveUpdate} from '../server/student-live-session.mjs';
import {voiceSession} from '../server/profile-voice.mjs';
import {researchAnswerLiveInstructions,researchAnswerBackendInstructions} from '../server/research-answer-policy.mjs';
import {researchBudgetTotalObserved} from './researchDiscussion.mjs';

function fixture(language='en'){
 const budget={year:'2026-27',population:language==='es'?'Residente de California, pregrado':'California-resident undergraduate',currency:'USD',period:'academic_year',housing:'renting',assumed:true,total:40000,sourceCitation:'[1]',complete:true,expectedCategories:['tuition_fees','housing','food'],components:[['tuition_fees',15000],['housing',20000],['food',5000]].map(([key,amount])=>({key,sourceLabel:key,amount,role:'component',qualification:''}))};
 const qualification=language==='es'?'Estimación, no una factura. El seguro se cobra aparte. No confirma el año 2027–28. [1]':'An estimate, not a bill. Insurance is additional. Does not confirm 2027–28. [1]';
 const finding={subject:'Eastview College',aspect:'total_budget',status:'verified',...budgetFinding(budget,qualification,language),budget};
 const question=language==='es'?'¿Cuál es el costo total de asistencia de Eastview College?':'What is Eastview College total cost of attendance?';
 const result={status:'source_check_completed',sources:[{url:'https://eastview.edu/budget'}],voiceBrief:{status:'verified',answer:finding.answer,qualification:finding.qualification,nextStep:'',findings:[finding]}};
 return {budget,finding,question,result};
}

for(const language of ['en','es'])test(`${language}: a completed headline without a campus echo retires the optional itemized repeat`,()=>{
 const f=fixture(language),es=language==='es';
 const answer=es?'No pude verificar la cifra exacta para su cohorte, pero para 2026 a 27 el presupuesto publicado fuera del campus es de 40 mil dólares. Es una cifra para planificar, no una factura.':"I couldn't verify a transfer-specific figure for the exact cohort, but for 2026 to 27, the published California resident off-campus renting estimate puts total expenses at about forty thousand dollars. That’s not the bill; it’s a planning figure.";
 assert.equal(researchBudgetTotalObserved(f.finding,answer,{implicitSubject:true}),true);
 assert.equal(researchCaveatObservation().observe(answer),true);
 const sent=[],events=[];let seq=0;const tasks=new Map();
 const d=researchDelivery({send:e=>sent.push(e),emit:e=>events.push(e),canAnnounce:()=>true,now:()=>100,
  id:()=>`id-${++seq}`,schedule:fn=>{const id=++seq;tasks.set(id,fn);return id;},cancel:id=>tasks.delete(id)});
 d.supersede('new_request',f.question);
 d.ready({jobId:'budget',requestId:'req',revision:1,question:f.question,language,result:f.result},{awaitingReply:true});
 for(const e of sent.filter(e=>e.type==='session.thinking.append'))d.receive({type:'session.thinking.appended',client_event_id:e.event_id});
 d.reply(answer,{audible:true,completedText:answer});
 assert.ok(events.some(e=>e.deliveryStage==='native_portion_observed'));
 assert.equal(tasks.size,0);assert.equal(sent.some(e=>e.type==='session.commentary.append'),false);
 assert.equal(f.result.voiceBrief.findings[0].budget.components.length,3);
 d.clear();
});

for(const language of ['en','es'])test(`${language}: implicit budget suppression requires exact supported completed evidence`,()=>{
 const f=fixture(language),es=language==='es';
 const valid=es?'El presupuesto publicado para 2026–27 fuera del campus es de $40,000.':'The published 2026–27 off-campus budget is $40,000.';
 assert.equal(researchBudgetTotalObserved(f.finding,valid),false,'no implicit campus without caller scope');
 for(const text of [valid.replace('40,000','39,999'),valid.replace('2026–27','2027–28'),valid.replace(es?'fuera del campus':'off-campus',es?'con familiares':'with family'),valid.slice(0,-1),valid.replace('$40,000.',es?'quizás $40,000.':'maybe $40,000.'),'Davis: '+valid]){
  assert.equal(researchBudgetTotalObserved(f.finding,text,{implicitSubject:true}),false,text);
 }
});
for(const language of ['en','es']){
 const es=language==='es';
 test(`${language}: total-only voice context keeps scope, total, every caveat and source, while the retained table keeps its line items`,()=>{
  const f=fixture(language),original=structuredClone(f.result);
  const view=researchSpokenFinding(f.finding,{question:f.question,language});
  assert.match(view.answer,/40,000/);assert.match(view.answer,/2026-27/);assert.match(view.answer,/campus/);assert.match(view.answer,/\[1\]/);
  assert.doesNotMatch(view.answer,/15,000|20,000|5,000/);assert.equal(view.qualification,f.finding.qualification);
  const context=decodedResearchContext(researchContextPackets({question:f.question,language,result:f.result},'ref').map(JSON.parse));
  assert.equal(context.findings[0].answer,view.answer);assert.equal(context.findings[0].qualification,f.finding.qualification);
  assert.deepEqual(f.result,original);assert.equal(f.result.voiceBrief.findings[0].budget.components.length,3);
  assert.ok(view.answer.length<f.finding.answer.length);
 });
 test(`${language}: requested breakdown, tuition and components remain available instead of being silently shortened`,()=>{
  const f=fixture(language);
  for(const question of [f.question+(es?' Dame el desglose.':' Give the breakdown.'),es?'Explícame cada partida.':'Explain each line item.']){
   assert.equal(researchSpokenFinding(f.finding,{question,language}).answer,f.finding.answer);
  }
  const unknown={...f.finding,budget:{...f.budget,total:null}};assert.doesNotMatch(researchSpokenFinding(unknown,{question:f.question,language}).answer,/40,000/);
  const unverified={...f.finding,status:'unverified',answer:'Requested total remains unverified.'};assert.equal(researchSpokenFinding(unverified,{question:f.question,language}),unverified);
  const other={subject:'Eastview College',aspect:'eligibility',status:'partial',answer:'Contact verified; Spanish availability unconfirmed. [1]',qualification:'No hours established. [1]'};
  assert.equal(researchSpokenFinding(other,{question:'What help is available?',language}),other,'non-budget rules and unknowns are unchanged');
 });
 test(`${language}: a total plus tuition request does not turn into an unrequested full breakdown`,()=>{
  const f=fixture(language),original=structuredClone(f.finding);
  const question=es?'¿Cuál es el costo total y la matrícula?':'What is the total cost and tuition?';
  const view=researchSpokenFinding(f.finding,{question,language});
  assert.match(view.answer,/40,000/);assert.match(view.answer,/15,000/);
  assert.doesNotMatch(view.answer,/\$20,000|\$5,000/);
  assert.match(view.answer,/2026-27/);assert.match(view.answer,/campus/);
  assert.equal(view.qualification,original.qualification);assert.deepEqual(f.finding,original);
  const optional=researchSpokenFinding(f.finding,{question:question+(es?' si están disponibles.':' if available.'),language});
  assert.equal(optional.answer,view.answer,'template qualifier must not request the full itemization');
  const actualAvailability=question+(es?' ¿Hay vivienda disponible?':' Is housing available?');
  assert.equal(researchSpokenFinding(f.finding,{question:actualAvailability,language}).answer,f.finding.answer,'a real additional question remains complete');
 });
 test(`${language}: a total plus one requested component keeps that exact value and its condition`,()=>{
  const f=fixture(language),budget=structuredClone(f.budget);budget.total+=1565;budget.expectedCategories.push('transportation');
  budget.components.push({key:'transportation',sourceLabel:'Transportation',amount:1565,role:'component',qualification:'Published allowance, not a bus pass price.'});
  const finding={...f.finding,...budgetFinding(budget,f.finding.qualification,language),budget};
  const question=f.question+(es?' Incluye el presupuesto de transporte.':' Include the budget transportation estimate.');
  const view=researchSpokenFinding(finding,{question,language});
  assert.match(view.answer,/41,565/);assert.match(view.answer,/1,565/);assert.match(view.answer,/not a bus pass price/);assert.doesNotMatch(view.answer,/15,000|20,000/);
  budget.components.at(-1).amount=null;assert.equal(researchSpokenFinding(finding,{question,language}),finding);
 });
 test(`${language}: the generic caveat is reusable only after an actual complete assertion, and never claims comprehension`,()=>{
  const observation=researchCaveatObservation();
  for(const text of [es?'¿Es una estimación, no una factura?':'Is it an estimate, not a bill?',es?'Tal vez es una estimación, no una factura.':'Maybe it is an estimate, not a bill.',es?'No es una estimación; es una factura.':'It is not an estimate; it is a bill.',es?'Es una estimación, no una factura':'It is an estimate, not a bill',es?'Ella dijo «estimación, no una factura».':'She said "an estimate, not a bill".'])assert.equal(observation.observe(text),false,text);
  assert.deepEqual(observation.hints(),{});
  assert.equal(observation.observe(es?'Es una estimación, no una factura.':'It is an estimate, not her bill.'),true);
  assert.deepEqual(observation.hints(),{previouslyExplained:['estimate_not_bill']});
  observation.clear();assert.deepEqual(observation.hints(),{});
 });
 test(`${language}: transcript-only, forced and interrupted unfinished speech cannot authorize a prior-explanation hint`,()=>{
  const f=fixture(language),sent=[],events=[];
  const d=researchDelivery({send:e=>sent.push(e),emit:e=>events.push(e),canAnnounce:()=>false});
  const text=es?'Es una estimación, no una factura.':'It is an estimate, not her bill.';
  d.reply(text,{audible:false});d.reply(text,{audible:true,forced:true});d.reply(text,{audible:true,interrupted:true,completedText:''});
  d.ready({jobId:'first',requestId:'first',revision:1,question:f.question,language,result:f.result});
  assert.ok(!JSON.stringify(sent).includes('previousExplanation'));
  d.reply(text,{audible:true,completedText:text});
  d.supersede('new_request',f.question);sent.length=0;
  d.ready({jobId:'second',requestId:'second',revision:1,question:f.question,language,result:f.result});
  const context=decodedResearchContext(sent.map(e=>JSON.parse(e.content)));
  assert.deepEqual(context.spokenDelivery,{previousExplanation:['estimate_not_bill']});
  assert.match(context.findings[0].qualification,/2027/,'new source-specific limitations are preserved');
  assert.equal(events.filter(e=>e.deliveryStage==='caveat_observed').length,1);
  d.clear('scope_changed');sent.length=0;d.ready({jobId:'third',requestId:'third',revision:1,question:f.question,language,result:f.result});
  assert.ok(!JSON.stringify(sent).includes('previousExplanation'));d.clear('call_ended');
 });
 test(`${language}: adjacent completed sentences recognize the caveat without joining unrelated or uncertain claims`,()=>{
  for(const text of es?['Es una estimación. No es su factura.','Este presupuesto es una estimación. Esto no es una factura.']:
   ['It is an estimate. It is not her bill.','This is the published budget. That is not your actual bill.']){
   const o=researchCaveatObservation();assert.equal(o.observe(text),true,text);
  }
  for(const text of es?['No es una estimación. No es su factura.','Quizás es una estimación. No es su factura.','¿Es una estimación? No es su factura.','Es una estimación. Hablemos de préstamos. No es su factura.','Es una estimación. No es su factura','Es una estimación. La universidad no es una factura.']:
   ['It is not an estimate. It is not her bill.','Maybe it is an estimate. It is not her bill.','Is it an estimate? It is not her bill.','It is an estimate. We can discuss loans. It is not her bill.','It is an estimate. It is not her bill','It is an estimate. The hospital is not a bill.']){
   assert.equal(researchCaveatObservation().observe(text),false,text);
  }
  const separate=researchCaveatObservation();separate.observe(es?'Es una estimación.':'It is an estimate.');
  assert.equal(separate.observe(es?'No es su factura.':'It is not her bill.'),false,'separate observation windows cannot be stitched');
 });
 for(const path of ['ack','comparison','requested'])test(`${language}: ${path} delivery uses the same total-only presentation as quiet context`,()=>{
  const f=fixture(language);f.budget.population='Resident UG';
  Object.assign(f.finding,budgetFinding(f.budget,es?'Estimación, no una factura. [1]':'Estimate, not a bill. [1]',language));
  Object.assign(f.result.voiceBrief,{answer:f.finding.answer,qualification:f.finding.qualification});
  let now=0,seq=0;const tasks=new Map(),sent=[];
  const d=researchDelivery({send:e=>sent.push(e),emit:()=>{},canAnnounce:()=>true,now:()=>now,id:()=>`id-${++seq}`,
   schedule:(fn,ms)=>{const id=++seq;tasks.set(id,{fn,at:now+ms});return id;},cancel:id=>tasks.delete(id)});
  d.supersede('new_request',f.question);
  if(path==='ack')d.callerStopped(es?'Ajá.':'Mm-hmm.');
  d.ready({jobId:'job',requestId:'request',revision:1,question:f.question,language,result:f.result,
   ...(path==='comparison'?{comparisonSubject:f.finding.subject}:{})},path==='requested'?{pendingCallerText:es?'¿Ya tienes el resultado?':'Did you find it?'}:{});
  while([...tasks.values()].some(t=>t.at<=1000)){
   const [id,t]=[...tasks].filter(([,t])=>t.at<=1000).sort((a,b)=>a[1].at-b[1].at)[0];now=t.at;tasks.delete(id);t.fn();
  }
  const spoken=sent.find(e=>e.type==='session.commentary.append');assert.ok(spoken,path);
  assert.match(spoken.content,/40,000/);assert.doesNotMatch(spoken.content,/15,000|20,000|5,000/);
  assert.match(spoken.content,es?/no una factura/:/not a bill/);assert.ok(Buffer.byteLength(spoken.content)<=480);
  assert.equal(f.result.voiceBrief.findings[0].budget.components.length,3);d.clear();
 });
 test(`${language}: research brevity is seeded once without changing voice, opening input or scope-update instructions`,()=>{
  const input={language,role:'parent',mode:'planning',targetConfirmed:true,studentId:'fictional'};
  const config=voiceSession(input,{}),session=studentLiveSession(config,input);
  assert.ok(session.instructions.includes(researchAnswerLiveInstructions));assert.ok(session.delegation.responses.instructions.endsWith(researchAnswerBackendInstructions));
  assert.equal(session.audio.output.voice,'marin');assert.match(session.instructions,/half your usual speaking pace/);
  assert.match(session.input[0].content[0].text,/When the application requests the opening/);
  assert.equal(studentLiveUpdate(input,[],config.tools).liveInstructions,'');
  assert.ok(!studentLiveSession(config,{...input,onboarding:true}).instructions.includes(researchAnswerLiveInstructions));
  assert.equal(studentLiveSession(config,{...input,onboarding:true}).delegation.responses.instructions,config.instructions);
  const nativeInput={...input,voiceProtocol:'live-v1',experience:{usedVoice:true},profile:{id:'fictional',name:'Fictional Student'}};
  const readOnly=voiceSession(nativeInput,{OPENAI_MODEL_VOICE:'gpt-live-1'});readOnly.tools=readOnly.tools.filter(t=>['lookup_financial_aid','lookup_college_applications','lookup_education_planning','read_research_details','cancel_background_research'].includes(t.name));
  assert.ok(Buffer.byteLength(JSON.stringify(studentLiveSession(readOnly,nativeInput)))+900<70000,'isolated voice runner retains its session-size guard, including setup text');
 });
}
