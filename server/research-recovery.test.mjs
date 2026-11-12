import test from 'node:test';
import assert from 'node:assert/strict';
import {processResearchJob} from './voice-research-worker.mjs';
import {researchRecoveryPlan,researchRecoveryOutcome,recoveryResearchRequest,researchAttemptDiagnostics,mergeRecoveryResearch,parseUnverifiedResearch} from './research-recovery.mjs';
import {parseResearchBrief,researchBriefRequest} from './research-brief.mjs';
import {parseFinanceResearch} from './finance-research.mjs';
import {hasCoaBreakdown,requestsCoa} from './coa-evidence.mjs';

const berkeley='https://financialaid.berkeley.edu/costs',ucsc='https://registrar.ucsc.edu/fees';
function output({language='en',recovered=false,allUnknown=false}={}){
 const es=language==='es',known={subject:'UC Berkeley',aspect:'tuition_fees',status:'verified',answer:'UC Berkeley tuition is USD 18214 per year CITE.',qualification:'2026–27 undergraduate published estimate before aid CITE.'};
 const unknown={subject:'UC Santa Cruz',aspect:'tuition_fees',status:'unverified',answer:es?'No pude verificar las cuotas de UC Santa Cruz.':'UC Santa Cruz tuition could not be verified.',qualification:es?'No se pudo abrir la página oficial.':'The official cost page failed to open.'};
 const found={subject:'UC Santa Cruz',aspect:'tuition_fees',status:'verified',answer:'UC Santa Cruz tuition is USD 17000 per year CITE.',qualification:'2026–27 undergraduate published estimate before aid CITE.'};
 const findings=recovered?[found]:allUnknown?[unknown]:[known,unknown];
 const brief={status:recovered?'verified':allUnknown?'unverified':'partial',answer:recovered?found.answer:unknown.answer,qualification:recovered?found.qualification:allUnknown?unknown.qualification:unknown.qualification+' '+known.answer,nextStep:'',findings};
 const text=JSON.stringify({brief,report:recovered?'The Santa Cruz fee was verified CITE.':allUnknown?unknown.answer:known.answer+' '+unknown.answer});
 const url=recovered?ucsc:berkeley;
 const annotations=[...text.matchAll(/CITE/gu)].map(m=>({type:'url_citation',url,title:'Official fees',start_index:m.index,end_index:m.index+4}));
 return {status:'completed',model:'fixture',usage:{input_tokens:10,output_tokens:20},output:[{type:'web_search_call',status:'completed',action:{type:'search',sources:[{url}]}},{type:'message',content:[{type:'output_text',text,annotations}]}]};
}
const parse=data=>parseResearchBrief(parseFinanceResearch(data,'UC Berkeley and UC Santa Cruz')||parseUnverifiedResearch(data));
function fixture(language='en',extra={}){
 let claimed=false;const writes=[];
 return {writes,async query(sql,args){
  if(sql.includes('RETURNING id,input')){if(claimed)return {rows:[]};claimed=true;return {rows:[{id:'job',input:{mode:'finance',language,institution:'UC Berkeley and UC Santa Cruz',question:'Compare current 2026–27 undergraduate tuition at UC Berkeley and UC Santa Cruz.',...extra}}]};}
  writes.push({sql,args});return {rows:[{status:'running'}],rowCount:1};
 }};
}
const saved=db=>db.writes.find(w=>w.sql.includes("status='completed'"))?.args[1];

test('COA completeness distinguishes narrow tuition, cited breakdowns and unsupported totals',()=>{
 for(const question of ['Full cost of attendance','Costo de asistencia completo','What are the costs?','¿Cuánto cuesta?'])assert.equal(requestsCoa(question),true);
 for(const question of ['Annual tuition and fees only','Solo matrícula y cuotas anuales'])assert.equal(requestsCoa(question),false);
 const finding={aspect:'total_budget',status:'verified',sourceIds:[1],answer:'Annual budget $40,000. Published breakdown: Tuition and fees: $10,000; Housing and food: $28,000; Books: $2,000.'};
 assert.equal(hasCoaBreakdown(finding),true,'combined official categories need not be split');
 for(const changes of [{sourceIds:[]},{status:'unverified'},{aspect:'tuition_fees'},{answer:'Annual total $40,000.'},{answer:'Annual tuition $10,000. Published breakdown: Tuition: $10,000; Fees: $2,000.'}]){
  assert.equal(hasCoaBreakdown({...finding,...changes}),false);
 }
});

test('a complete earlier-year COA avoids recovery for an unavailable future year but preserves its qualification',()=>{
 const finding={subject:'UC Berkeley — 2026–27 renting off campus',aspect:'total_budget',status:'partial',
  answer:'2026–27 rental budget $40,000. Published breakdown: Tuition and fees: $10,000; Housing and food: $28,000; Books: $2,000. [1]',
  qualification:'A published benchmark; not a verified 2027–28 price. [1]'};
 const initial={sources:[{url:berkeley}],voiceBrief:{status:'partial',answer:finding.answer,qualification:finding.qualification,nextStep:'',findings:[finding,
  {subject:'UC Berkeley — 2027–28',aspect:'total_budget',status:'unverified',answer:'The future-year price is unverified.',qualification:''}]}};
 assert.equal(researchRecoveryPlan(initial,{question:'2027–28 cost of attendance renting off campus',institution:'UC Berkeley'}),null);
 assert.match(initial.voiceBrief.findings[0].qualification,/not a verified 2027/);
});

test('COA recovery rejects the wrong campus or living arrangement and leads with the recovered budget',()=>{
 const initial={sources:[{url:berkeley}],voiceBrief:{status:'partial',answer:'Tuition $10,000 [1].',qualification:'Total missing.',nextStep:'',findings:[
  {subject:'UC Berkeley — 2027–28',aspect:'total_budget',status:'unverified',answer:'The total was not verified.',qualification:'The page could not be read.'},
  {subject:'UC Berkeley',aspect:'tuition_fees',status:'verified',answer:'Annual tuition and fees $10,000 [1].',qualification:'Published fee schedule [1].'},
  {subject:'UC Davis',aspect:'deadline',status:'unverified',answer:'The deadline is unverified.',qualification:''},
 ]}};
 const plan=researchRecoveryPlan(initial,{question:'Full cost of attendance renting off campus',institution:'UC Berkeley'});
 const recovered={sources:[{url:berkeley}],text:'Official budget evidence [1].',voiceBrief:{status:'partial',nextStep:'',findings:[{
  subject:'UC Berkeley — 2026–27 renting off campus',aspect:'total_budget',status:'partial',
  answer:'2026–27 rental budget $40,000. Published breakdown: Tuition and fees: $10,000; Housing and food: $28,000; Books: $2,000. [1]',
  qualification:'Earlier-year benchmark before aid. [1]',
 }]}};
 const merged=mergeRecoveryResearch(initial,recovered,'en',plan);
 assert.match(merged.voiceBrief.answer,/40,000/);
 assert.equal(merged.voiceBrief.findings.length,3);
 assert.equal(merged.voiceBrief.findings[0].subject,'UC Berkeley — 2026–27 renting off campus');
 assert.equal(merged.voiceBrief.findings[1].answer,initial.voiceBrief.findings[1].answer);
 for(const subject of ['UC Davis — 2026–27 renting off campus','UC Berkeley — 2026–27 living with family']){
  const wrong=structuredClone(recovered);wrong.voiceBrief.findings[0].subject=subject;
  wrong.voiceBrief.findings[0].answer=wrong.voiceBrief.findings[0].answer.replace('rental budget',subject.includes('family')?'living with family budget':'rental budget');
  assert.equal(mergeRecoveryResearch(initial,wrong,'en',plan),initial);
  assert.notEqual(researchRecoveryOutcome(wrong,plan),'recovered');
 }
 const request=recoveryResearchRequest(researchBriefRequest({input:'{}',instructions:'Rules.'}),initial,plan);
 assert.equal(request.text.format.schema.properties.brief.properties.findings.items.anyOf[0].properties.subject.enum,undefined);
 assert.match(request.instructions,/For ordinary gaps without needsBreakdown/);
 assert.match(request.instructions,/label the actual published year/);
});

for(const language of ['en','es'])test(`${language}: tuition-only COA output recovers the full most-recent published benchmark`,async()=>{
 const db=fixture(language,{institution:'UC Berkeley',question:language==='es'?'Costo de asistencia completo 2027–28 fuera del campus':'Full 2027–28 cost of attendance off campus'});
 let calls=0;
 await processResearchJob(db,{}, {log:()=>{},request:async(_,options)=>{
  const request=JSON.parse(options.body),input=JSON.parse(request.input);
  if(++calls===2){
   assert.equal(input.recovery.gaps[0].aspect,'total_budget');
   assert.equal(input.recovery.gaps[0].needsBreakdown,true);
   assert.match(request.instructions,/most recent available complete published budget/);
  }
  const finding=calls===1
   ?{subject:'UC Berkeley — 2026–27',aspect:'tuition_fees',status:'partial',answer:'Annual tuition and fees: $10,000 CITE.',qualification:'The requested 2027–28 price is unverified.'}
   :{subject:'UC Berkeley — 2026–27 renting off campus',aspect:'total_budget',status:'partial',
    answer:language==='es'?'US$40,000 antes de la ayuda en 2026–27, alquiler fuera del campus. Desglose publicado: Matrícula y cuotas: $10,000; Vivienda: $20,000; Alimentación: $4,000; Libros: $1,000; Transporte: $1,000; Gastos personales: $1,000; Seguro médico: $3,000 CITE.':
     'US$40,000 before aid in 2026–27, renting off campus. Published breakdown: Tuition and fees: $10,000; Housing: $20,000; Food: $4,000; Books: $1,000; Transportation: $1,000; Personal: $1,000; Insurance: $3,000 CITE.',
    qualification:'Published 2026–27 benchmark, not a 2027–28 price. Assumed rental benchmark; housing choice unconfirmed. CITE.'};
  const text=JSON.stringify({report:'Protocol fixture budget evidence CITE.',brief:{status:'partial',answer:finding.answer,qualification:finding.qualification,nextStep:'',findings:[finding]}});
  const annotations=[...text.matchAll(/CITE/gu)].map(match=>({type:'url_citation',url:berkeley,start_index:match.index,end_index:match.index+4}));
  return new Response(JSON.stringify({status:'completed',output:[{type:'web_search_call',status:'completed',action:{type:'open_page',url:berkeley}},
   {type:'message',content:[{type:'output_text',text,annotations}]}]}));
 }});
 assert.equal(calls,2);
 const result=saved(db);assert.ok(result);
 assert.equal(result.voiceBrief.findings.length,2,'the source-backed tuition remains beside the recovered budget');
 const budget=result.voiceBrief.findings.find(finding=>finding.aspect==='total_budget');
 assert.match(budget.subject,/2026–27/);assert.match(budget.answer,/40,000/);assert.match(budget.answer,/Transportation|Transporte/);
 assert.equal(result.researchDiagnostics.recoveryStatus,'partial','benchmark retrieval does not verify a future-year price');
});

test('recovery logging requires the requested gap to become verified',async()=>{
 const db=fixture();let calls=0;
 await processResearchJob(db,{}, {request:async()=>{
  const data=output({recovered:++calls===2});
  if(calls===2){
   const block=data.output.find(item=>item.type==='message').content[0];
   const parsed=JSON.parse(block.text);
   parsed.brief.status='partial';parsed.brief.findings[0].status='partial';
   block.text=JSON.stringify(parsed);
   // Citation offsets change when status text grows. Rebuild the CITE offsets.
   block.annotations=[...block.text.matchAll(/CITE/gu)].map(match=>({type:'url_citation',url:ucsc,title:'Official fees',start_index:match.index,end_index:match.index+4}));
  }
  return new Response(JSON.stringify(data));
 }});
 assert.equal(calls,2);
 assert.equal(saved(db).researchDiagnostics.recoveryStatus,'partial');
 const initial={voiceBrief:{findings:[{subject:'UC Berkeley',aspect:'total_budget',status:'unverified',answer:'Unconfirmed.',qualification:''}]},sources:[]};
 assert.equal(researchRecoveryOutcome(initial,{gaps:[{subject:'UC Berkeley',aspect:'total_budget'}]}),'unresolved');
});

for(const language of ['en','es'])test(`${language}: one gap-only recovery merges citations, retains Berkeley and shares the original deadline`,async()=>{
 const db=fixture(language),requests=[];
 await processResearchJob(db,{OPENAI_API_KEY:'fixture'},{request:async(url,options)=>{
  requests.push(options);return new Response(JSON.stringify(output({language,recovered:requests.length===2})));
 }});
 assert.equal(requests.length,2);assert.equal(requests[0].signal,requests[1].signal);
 const body=JSON.parse(requests[1].body),input=JSON.parse(body.input);
 assert.equal(body.max_tool_calls,2);assert.equal(input.recovery.gaps.length,1);assert.equal(input.recovery.gaps[0].subject,'UC Santa Cruz');
 assert.equal(input.recovery.verifiedFindings[0].subject,'UC Berkeley');assert.match(body.instructions,/Research ONLY/);
 const result=saved(db);assert.equal(result.voiceBrief.findings.length,2);assert.equal(result.voiceBrief.findings[0].answer,'UC Berkeley tuition is USD 18214 per year [1].');
 assert.match(result.voiceBrief.findings[1].answer,/17000.*\[2\]/);assert.equal(result.sources[1].url,ucsc);
 assert.equal(result.researchDiagnostics.recoveryStatus,'recovered');assert.equal(result.researchDiagnostics.attempts.length,2);
 assert.equal(db.writes.filter(w=>w.sql.includes("status='completed'")).length,1);
});

test('recovery provider failure keeps the partial verified answer and never attempts a third call',async()=>{
 const db=fixture();let calls=0;
 await processResearchJob(db,{}, {request:async()=>++calls===1?new Response(JSON.stringify(output())):new Response('unavailable',{status:503})});
 assert.equal(calls,2);const result=saved(db);assert.equal(result.voiceBrief.status,'partial');assert.match(result.text,/Berkeley/);
 assert.equal(result.researchDiagnostics.recoveryStatus,'failed');assert.equal(result.researchDiagnostics.attempts[1].httpStatus,503);
});

test('a completed but unresolved second pass keeps the honest limitation without looping',async()=>{
 const db=fixture();let calls=0;
 await processResearchJob(db,{}, {request:async()=>{calls++;return new Response(JSON.stringify(output()));}});
 assert.equal(calls,2);assert.equal(saved(db).researchDiagnostics.recoveryStatus,'unresolved');
 assert.equal(saved(db).voiceBrief.findings[1].status,'unverified');
});

test('a verified result needs no additional request',async()=>{
 const db=fixture('en',{institution:'UC Santa Cruz',question:'Current undergraduate tuition at UC Santa Cruz'});let calls=0;
 await processResearchJob(db,{}, {request:async()=>{calls++;return new Response(JSON.stringify(output({recovered:true})));}});
 assert.equal(calls,1);assert.equal(saved(db).researchDiagnostics.recoveryStatus,'not_needed');
});

for(const language of ['en','es'])test(`${language}: a tuition-only contrast does not spend another call recovering an unsolicited budget`,async()=>{
 const question=language==='en'?'Compare current 2026–27 undergraduate tuition at UC Berkeley and UC Santa Cruz. Separate tuition from total cost of attendance.':'Compara matrícula de pregrado 2026–27 de UC Berkeley y UC Santa Cruz. Separa la matrícula del costo total.';
  const db=fixture(language,{question,institution:'UC Berkeley'});let calls=0;
 const response=output({language}),value=JSON.parse(response.output[1].content[0].text);
 value.brief.findings[1]={...value.brief.findings[1],aspect:'total_budget'};
 const text=JSON.stringify(value);response.output[1].content[0].text=text;
 response.output[1].content[0].annotations=[...text.matchAll(/CITE/gu)].map(m=>({type:'url_citation',url:berkeley,title:'Official fees',start_index:m.index,end_index:m.index+4}));
 await processResearchJob(db,{}, {request:async()=>{calls++;return new Response(JSON.stringify(response));}});
 assert.equal(calls,1);assert.equal(saved(db).researchDiagnostics.recoveryStatus,'not_needed');
 assert.equal(saved(db).voiceBrief.findings[1].status,'unverified');
 assert.ok(researchRecoveryPlan(saved(db),{question:question+(language==='en'?' Also verify total budget.':' También verifica el presupuesto total.')}));
});

test('near the deadline the first useful result is returned without resetting the timeout',async()=>{
 const db=fixture();let clock=0,calls=0;
 await processResearchJob(db,{}, {now:()=>clock,request:async()=>{calls++;clock=76000;return new Response(JSON.stringify(output()));}});
 assert.equal(calls,1);assert.equal(saved(db).researchDiagnostics.recoveryStatus,'deadline');
});

test('shutdown during recovery prevents a completed write even when an earlier result exists',async()=>{
 const db=fixture(),controller=new AbortController();let calls=0;
 await processResearchJob(db,{}, {signal:controller.signal,request:async()=>{calls++;if(calls===2){controller.abort();throw Error('shutdown');}return new Response(JSON.stringify(output()));}});
 assert.equal(calls,2);assert.equal(saved(db),undefined);assert.ok(db.writes.at(-1).sql.includes("status='failed'"));
});

test('a durable cancellation after the first search prevents any recovery provider call',async()=>{
 const db=fixture(),query=db.query.bind(db);let calls=0;
 db.query=async(sql,args)=>sql.startsWith('SELECT status')?{rows:[{status:'cancelled'}]}:query(sql,args);
 await processResearchJob(db,{}, {request:async()=>{calls++;return new Response(JSON.stringify(output()));}});
 assert.equal(calls,1);assert.equal(saved(db),undefined);
});

test('citation-free structured source failure can recover, but uncited facts and refusals cannot',async()=>{
 const unknown=output({allUnknown:true});assert.equal(parse(unknown).voiceBrief.status,'unverified');
 const db=fixture();let calls=0;
 await processResearchJob(db,{}, {request:async()=>new Response(JSON.stringify(++calls===1?unknown:output({recovered:true})))});
 assert.equal(calls,2);assert.equal(saved(db).voiceBrief.status,'verified');
 for(const invalid of [
  {...unknown,status:'incomplete'},
  {...unknown,output:unknown.output.filter(i=>i.type!=='web_search_call')},
  {...unknown,output:[unknown.output[0],{type:'message',content:[{type:'refusal',refusal:'No'}]}]},
 ])assert.equal(parseUnverifiedResearch(invalid),null);
 const unsupported=structuredClone(unknown),body=JSON.parse(unsupported.output[1].content[0].text);body.brief.findings[0].status='verified';unsupported.output[1].content[0].text=JSON.stringify(body);
 assert.equal(parseUnverifiedResearch(unsupported),null);
});

test('a partial caveat without an unverified requested finding or retrieval failure does not trigger recovery',()=>{
 const result=parse(output({recovered:true}));result.voiceBrief.status='partial';result.voiceBrief.qualification='Your personal aid award is unknown [1].';
 assert.equal(researchRecoveryPlan(result),null);
});

test('recovery cannot overwrite verified evidence or resolve another campus by mistake',()=>{
 const initial=parse(output()),wrong=parse(output({recovered:true}));wrong.voiceBrief.findings[0].subject='UC Davis';
 assert.equal(mergeRecoveryResearch(initial,wrong),initial);
 const body=recoveryResearchRequest({input:'{"question":"public question"}',instructions:'Existing rules.',tools:[{type:'web_search'}]},initial,researchRecoveryPlan(initial));
 assert.match(body.instructions,/A failed retrieval does not establish/);assert.equal(body.max_tool_calls,2);
});

test('the common UCSC abbreviation resolves only its matching missing campus',()=>{
 const initial=parse(output()),recovered=parse(output({recovered:true}));recovered.voiceBrief.findings[0].subject='UCSC';
 const merged=mergeRecoveryResearch(initial,recovered);assert.notEqual(merged,initial);assert.equal(merged.voiceBrief.findings[1].status,'verified');
});

test('structured recovery keeps exact gap identity while leaving factual limitations explicit',()=>{
 const initial=parse(output()),subject='UC Santa Cruz — 2026–27 California-resident undergraduate off-campus apartment';
 initial.voiceBrief.findings[1].subject=subject;
 const plan=researchRecoveryPlan(initial),base=researchBriefRequest({input:'{"question":"Annual tuition 2026–27"}',instructions:'Rules.'});
 const snapshot=JSON.stringify(base),body=recoveryResearchRequest(base,initial,plan);
 const items=body.text.format.schema.properties.brief.properties.findings;
 assert.equal(items.maxItems,1);assert.equal(items.items.anyOf.length,1);
 assert.deepEqual(items.items.anyOf[0].properties.subject.enum,[subject]);
 assert.deepEqual(items.items.anyOf[0].properties.aspect.enum,[plan.gaps[0].aspect]);
 assert.match(body.instructions,/Copy the attempted gap's subject and aspect exactly/);
 assert.match(body.instructions,/scope mismatch or limitation in the answer and qualification/);
 assert.equal(JSON.stringify(base),snapshot,'recovery schema does not mutate the initial request');
 const recovered=parse(output({recovered:true}));
 recovered.voiceBrief.findings[0].subject='UC Santa Cruz — 2027–28 living with family';
 assert.equal(mergeRecoveryResearch(initial,recovered),initial,'a different scenario label is never silently treated as the requested gap');
 recovered.voiceBrief.findings[0].subject=subject;
 assert.equal(mergeRecoveryResearch(initial,recovered).voiceBrief.findings[1].status,'verified');
});

const retained={institution:'UC Berkeley',question:'2026–27 undergraduate tuition',checkedAt:'2026-11-05',coverage:'verified',
 findings:[{subject:'UC Berkeley',aspect:'tuition_fees',status:'verified',answer:'UC Berkeley tuition is USD 18214 per year [R1].',qualification:'2026–27 undergraduate published estimate before aid [R1].'}],
 sources:[{ref:'R1',url:berkeley,title:'Berkeley costs',checkedAt:'2026-11-05'}]};

test('UCSC failure with only retained Berkeley citations still reaches bounded recovery',async()=>{
 const db=fixture('en',{reusedEvidence:[retained],lookupInstitutions:['UC Santa Cruz']});let calls=0;
 const first=output();first.output[1].content[0].text=first.output[1].content[0].text.replaceAll('CITE','[R1]');first.output[1].content[0].annotations=[];first.output[0].action.sources=[];
 await processResearchJob(db,{}, {request:async()=>new Response(JSON.stringify(++calls===1?first:output({recovered:true})))});
 assert.equal(calls,2);assert.deepEqual(saved(db).sources.map(s=>s.url),[berkeley,ucsc]);assert.equal(saved(db).voiceBrief.status,'verified');
});

test('a queued request fully covered by retained evidence makes no provider request',async()=>{
 const db=fixture('en',{institution:'UC Berkeley',question:'2026–27 undergraduate tuition',reusedEvidence:[retained],lookupInstitutions:[]});
 await processResearchJob(db,{}, {request:()=>assert.fail('reused facts must not be researched again')});
 assert.equal(saved(db).sources[0].url,berkeley);assert.equal(saved(db).researchDiagnostics.attempts.length,0);
});

for(const language of ['en','es'])test(`${language}: worker keeps covered Irvine tuition when a new-campus check repeats a failed Irvine lookup`,async()=>{
 const es=language==='es',checkedAt='2026-11-05T17:00:00.000Z';
 const previous={institution:'UC Irvine',coverage:'verified',checkedAt,
  findings:[{subject:'UC Irvine — California-resident undergraduate transfer, fall 2026 cohort',aspect:'tuition_fees',status:'verified',
   answer:es?'UC Irvine: matrícula y cuotas anuales 2026–27 de $18,214 [R1].':'UC Irvine annual 2026–27 tuition and fees are $18,214 [R1].',
   qualification:es?'El subtotal incluye eTech, que el total publicado parece omitir [R1].':'The subtotal includes required eTech that the displayed total appears to omit [R1].'}],
  sources:[{ref:'R1',url:'https://reg.uci.edu/fees',title:'UCI official fees',checkedAt}]};
 const question=es?'Compara matrícula y cuotas de pregrado para transferencia y residentes de California 2026–27 de UC Riverside y UC Irvine. Separa la matrícula del costo total.':'Compare 2026–27 undergraduate transfer tuition and mandatory fees for California residents at UC Riverside and UC Irvine. Separate tuition from total cost of attendance.';
 const db=fixture(language,{institution:'UC Riverside and UC Irvine',question,reusedEvidence:[previous],lookupInstitutions:['UC Riverside']});
 const findings=[{subject:'UC Riverside',aspect:'tuition_fees',status:'verified',answer:'UC Riverside 2026–27 annual tuition is $18,100 CITE.',qualification:'California-resident undergraduate transfer estimate before aid CITE.'},
  {subject:'UC Irvine',aspect:'tuition_fees',status:'unverified',answer:es?'No se pudo verificar la matrícula de UC Irvine.':'UC Irvine tuition could not be verified.',qualification:es?'No se pudo abrir la página.':'The source page could not be opened.'}];
 const text=JSON.stringify({brief:{status:'partial',answer:findings[0].answer,qualification:findings[0].qualification,nextStep:'',findings},report:findings.map(f=>f.answer+' '+f.qualification).join(' ')});
 const annotations=[...text.matchAll(/CITE/gu)].map(m=>({type:'url_citation',url:'https://registrar.ucr.edu/fees',title:'UCR official fees',start_index:m.index,end_index:m.index+4}));
 const response={status:'completed',output:[{type:'web_search_call',status:'completed'},{type:'message',content:[{type:'output_text',text,annotations}]}]};
 let calls=0;await processResearchJob(db,{}, {request:async()=>{calls++;return new Response(JSON.stringify(response));}});
 assert.equal(calls,1);const final=saved(db);assert.ok(final);
 assert.equal(final.researchDiagnostics.recoveryStatus,'not_needed');assert.equal(final.retainedFindingCount,1);
 assert.equal(final.voiceBrief.findings[0].subject,'UC Riverside');assert.equal(final.voiceBrief.findings[1].status,'verified');
 assert.match(final.voiceBrief.findings[1].answer,/18,214/);assert.match(final.voiceBrief.findings[1].qualification,/eTech/);
 assert.equal(final.sources.find(s=>s.url==='https://reg.uci.edu/fees').checkedAt,checkedAt);
});

test('attempt diagnostics retain observed actions and official URLs without search queries or arbitrary errors',()=>{
 const data={output:[{type:'web_search_call',status:'completed',action:{type:'open_page',url:'https://registrar.ucsc.edu/fees?secret=omit',query:'omit this',sources:[{url:'https://registrar.ucsc.edu/fees?secret=omit'},{url:'https://unofficial.example/private'}]}}]};
 const detail=researchAttemptDiagnostics(data,{pass:'recovery',durationMs:8,outcome:'completed'});
 assert.equal(detail.toolCalls,1);assert.deepEqual(detail.consultedSources,['https://registrar.ucsc.edu/fees']);
 assert.equal(detail.actions[0].url,'https://registrar.ucsc.edu/fees');assert.ok(!JSON.stringify(detail).includes('secret'));assert.ok(!JSON.stringify(detail).includes('query'));
});

for(const language of ['en','es'])test(`${language}: initial cited findings are durable before recovery is allowed to finish`,async()=>{
 const db=fixture(language);let finishRecovery,calls=0;
 const processing=processResearchJob(db,{}, {request:async()=>{
  if(++calls===1)return new Response(JSON.stringify(output({language})));
  return new Promise(resolve=>{finishRecovery=()=>resolve(new Response(JSON.stringify(output({language,recovered:true}))));});
 }});
 while(!finishRecovery)await new Promise(resolve=>setImmediate(resolve));
 const early=db.writes.find(w=>w.sql.includes('SET result=$2'));
 assert.ok(early);assert.match(early.sql,/status='running'.*expires_at>now\(\)/);
 assert.equal(early.args[1].evidenceVersion,1);assert.equal(early.args[1].researchPending,true);
 assert.equal(early.args[1].voiceBrief.findings[0].status,'verified');assert.equal(saved(db),undefined);
 finishRecovery();await processing;
 assert.equal(saved(db).evidenceVersion,2);assert.equal(saved(db).researchPending,false);
 assert.equal(early.args[1].researchDiagnostics.attempts.length,1);
});

test('an entirely unverified initial pass is not published as useful findings',async()=>{
 const db=fixture();let calls=0;
 await processResearchJob(db,{}, {request:async()=>new Response(JSON.stringify(output({allUnknown:++calls===1,recovered:calls===2})))});
 assert.equal(db.writes.filter(w=>w.sql.includes('SET result=$2')).length,0);
 assert.equal(saved(db).evidenceVersion,1);assert.equal(saved(db).researchPending,false);
});

test('a cancellation winning the provisional write prevents recovery and further evidence publication',async()=>{
 const db=fixture(),query=db.query.bind(db);let calls=0;
 db.query=(sql,args)=>sql.includes('SET result=$2')?Promise.resolve({rows:[],rowCount:0}):query(sql,args);
 await processResearchJob(db,{}, {request:async()=>{calls++;return new Response(JSON.stringify(output()));}});
 assert.equal(calls,1);assert.equal(saved(db),undefined);
});
