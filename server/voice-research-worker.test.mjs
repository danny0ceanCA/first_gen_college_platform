import test from 'node:test';
import assert from 'node:assert/strict';
import {processResearchJob} from './voice-research-worker.mjs';
import {comparisonFindings} from './voice-comparison-update.mjs';
const evidence=url=>({output:[{type:'web_search_call',status:'completed'},{type:'message',content:[{type:'output_text',text:'Verified explanation.',annotations:[{type:'url_citation',url,title:'Official source',start_index:0,end_index:8}]}]}]});
function fixture(input){let available=true;const writes=[];return {writes,async query(sql,args){if(sql.includes('RETURNING id,input')){if(!available)return {rows:[]};available=false;return {rows:[{id:'job',input}]};}writes.push({sql,args});return {rows:[{status:'running'}]};}};}
for(const language of ['en','es'])test(`worker verifies official citations and minimizes provider input (${language})`,async()=>{
 const db=fixture({question:'Cost of attendance',institution:'UC Davis',language,mode:'finance'});
 await processResearchJob(db,{OPENAI_API_KEY:'fake'},{request:async(url,options)=>{const b=JSON.parse(options.body);assert.equal(b.max_tool_calls,2);assert.equal(b.store,false);assert.ok(!options.body.includes('auth0'));return new Response(JSON.stringify(evidence('https://financialaid.ucdavis.edu/cost')));}});
 assert.ok(db.writes.some(w=>w.sql.includes("status='completed'")&&w.args[1].sources.length));
 assert.equal(await processResearchJob(db,{}, {request:()=>assert.fail('empty queue must not incur cost')}),false);
});
test('unofficial evidence fails closed and is not retried',async()=>{
 const db=fixture({question:'Cost',institution:'UC Davis',language:'en',mode:'finance'});
 await processResearchJob(db,{}, {request:async()=>new Response(JSON.stringify(evidence('https://fake.example/fees')))});
 assert.ok(!db.writes.some(w=>w.sql.includes("status='completed'")));assert.ok(db.writes.some(w=>w.sql.includes("status='failed'")));
});
test('shutdown signal propagates to the provider; completed writes guard cancellation',async()=>{
 const db=fixture({question:'Cost',institution:'UC Davis',language:'en',mode:'finance'}),controller=new AbortController();
 await processResearchJob(db,{}, {signal:controller.signal,request:async(url,options)=>{controller.abort();assert.equal(options.signal.aborted,true);throw Error('aborted');}});
 assert.ok(db.writes.at(-1).sql.includes("AND status='running'"));
});

const previousCheck='2026-11-08T10:00:00.000Z',nextCheck='2026-11-08T10:01:00.000Z';
const comparisonCases=[
 {topic:'annual budget',mode:'finance',aspect:'total_budget',en:'Change Eastview College to living with family.',es:'Cambia Eastview College a vivir con la familia.'},
 {topic:'application deadline',mode:'admissions',aspect:'deadline',en:'Change Eastview College to transfer applicants.',es:'Cambia Eastview College a solicitantes de transferencia.'},
 {topic:'orientation attendance',mode:'planning',aspect:'other',en:'Change Eastview College to online orientation.',es:'Cambia Eastview College a orientacion en linea.'},
 {topic:'scholarship eligibility',mode:'finance',aspect:'eligibility',en:'Change Eastview College to part-time enrollment.',es:'Cambia Eastview College a matricula de medio tiempo.'},
 {topic:'family advising',mode:'planning',aspect:'other',en:'Change Eastview College to Spanish-language advising.',es:'Cambia Eastview College a asesoria en espanol.'},
];
function comparisonInput(language='en',item=comparisonCases[0]){
 const sources=[{title:'Eastview official policy',url:'https://eastview.edu/policy',checkedAt:previousCheck},{title:'Pine Valley official policy',url:'https://pinevalley.edu/policy',checkedAt:previousCheck}];
 const findings=[
  {subject:'Eastview College',aspect:item.aspect,status:'verified',answer:`Eastview ${item.topic}: original requirement [1].`,qualification:'Published for 2026–27; individual eligibility is not guaranteed [1].'},
  {subject:'Pine Valley College',aspect:item.aspect,status:'verified',answer:`Pine Valley ${item.topic}: UNTOUCHED_MARKER [2].`,qualification:'Published for 2026–27; this is general guidance, not a personal award [2].'},
 ];
 const result={checkedAt:previousCheck,sources,text:findings.map(f=>f.answer+' '+f.qualification).join('\n'),voiceBrief:{status:'verified',answer:findings[0].answer,qualification:findings[0].qualification,nextStep:'',findings}};
 const entries=comparisonFindings(result,{now:Date.parse(nextCheck)});assert.equal(entries?.length,2);
 return {question:item[language],institution:'Eastview College',language,mode:item.mode,comparisonPlan:{version:2,target:entries[0],retained:[entries[1]],invalidated:[],changeText:item[language]}};
}
function comparisonEvidence(input,{status='verified',source='https://eastview.edu/policy',providerStatus='completed',searchStatus='completed',subject=input.comparisonPlan.target.subject,aspect=input.comparisonPlan.target.aspect,requestedChange=input.comparisonPlan.changeText,refusal=false,citation=true,qualification}={}){
 const es=input.language==='es';
 const text=JSON.stringify({status,subject,aspect,requestedChange,
  answer:es?'Requisito actualizado para la opcion solicitada CITE.':'Updated requirement for the requested option CITE.',
  qualification:qualification??(es?'La publicacion es para 2026–27; no garantiza elegibilidad individual.':'Published for 2026–27; individual eligibility is not guaranteed.')});
 const start_index=text.indexOf('CITE');
 return {status:providerStatus,output:[{type:'web_search_call',status:searchStatus,action:{type:'open_page',url:source}},
  {type:'message',content:refusal?[{type:'refusal',refusal:'Unable to answer'}]:[{type:'output_text',text,annotations:citation?[{type:'url_citation',url:source,title:'Official update',start_index,end_index:start_index+4}]:[]}]}]};
}
for(const language of ['en','es'])for(const item of comparisonCases)test(`comparison worker checks only changed ${item.topic}, preserving evidence (${language})`,async()=>{
 const input=comparisonInput(language,item),db=fixture(input),events=[];let count=0;
 await processResearchJob(db,{}, {log:event=>events.push(event),now:()=>Date.parse(nextCheck),request:async(url,options)=>{
  count++;const body=JSON.parse(options.body);
  assert.equal(body.store,false);assert.equal(body.max_tool_calls,2);
  assert.deepEqual(body.tools[0].filters.allowed_domains,['eastview.edu']);
  assert.doesNotMatch(body.input,/Pine Valley|UNTOUCHED_MARKER/);
  return new Response(JSON.stringify(comparisonEvidence(input)));
 }});
 assert.equal(count,1,'one bounded request; no broad recovery');
 const reuse=events.find(e=>e.researchStage==='reuse_selected');assert.equal(reuse.lookupCount,1);assert.equal(reuse.reusedCount,1);assert.equal(reuse.retainedFindingCount,1);
 const result=db.writes.find(w=>w.sql.includes("status='completed'"))?.args[1];assert.ok(result);
 assert.equal(result.researchDiagnostics.recoveryStatus,'not_needed');
 const retained=result.voiceBrief.findings.find(f=>f.subject==='Pine Valley College');assert.ok(retained);
 assert.match(retained.answer,/UNTOUCHED_MARKER/);assert.match(retained.qualification,/not a personal award/);
 assert.equal(result.sources.find(s=>s.url==='https://pinevalley.edu/policy').checkedAt,previousCheck);
 assert.equal(result.sources.find(s=>s.url==='https://eastview.edu/policy').checkedAt,nextCheck);
 assert.equal(result.voiceBrief.findings.find(f=>f.subject==='Eastview College').status,'verified');
});
for(const language of ['en','es'])for(const status of ['partial','unverified'])test(`comparison worker preserves unchanged evidence without upgrading ${status} (${language})`,async()=>{
 const input=comparisonInput(language),db=fixture(input);let count=0;
 await processResearchJob(db,{}, {log:()=>{},request:async()=>{count++;return new Response(JSON.stringify(comparisonEvidence(input,{status})));}});
 assert.equal(count,1);
 const result=db.writes.find(w=>w.sql.includes("status='completed'"))?.args[1];assert.ok(result);
 assert.equal(result.voiceBrief.findings.find(f=>f.subject==='Eastview College').status,status);
 assert.equal(result.voiceBrief.findings.find(f=>f.subject==='Pine Valley College').status,'verified');
 assert.equal(result.sources.find(s=>s.url==='https://pinevalley.edu/policy').checkedAt,previousCheck);
});
for(const invalid of [
 {name:'wrong source',source:'https://unrelated.edu/policy'},
 {name:'incomplete provider output',providerStatus:'incomplete'},
 {name:'incomplete hosted search',searchStatus:'in_progress'},
 {name:'wrong target',subject:'Pine Valley College'},
 {name:'wrong aspect',aspect:'housing'},
 {name:'wrong requested change',requestedChange:'Change Eastview College to a different year.'},
 {name:'missing material qualification',qualification:''},
 {name:'verified answer without hosted citation',citation:false},
 {name:'refusal',refusal:true},
])test(`comparison worker rejects ${invalid.name} without publishing or retrying`,async()=>{
 const input=comparisonInput(),db=fixture(input);let count=0;
 await processResearchJob(db,{}, {log:()=>{},request:async()=>{count++;return new Response(JSON.stringify(comparisonEvidence(input,invalid)));}});
 assert.equal(count,1);assert.ok(!db.writes.some(w=>w.sql.includes("status='completed'")));assert.ok(db.writes.some(w=>w.sql.includes("status='failed'")));
});
test('legacy campus comparison jobs fail closed without provider spending',async()=>{
 const db=fixture({question:'Cost',institution:'UC Davis',language:'en',mode:'finance',comparisonOfficialUrl:'https://financialaid.ucdavis.edu/undergraduate/cost/2627-entering'});
 await processResearchJob(db,{}, {log:()=>{},request:()=>assert.fail('legacy job must not reach provider')});
 assert.ok(db.writes.some(w=>w.sql.includes("status='failed'")));
});
test('comparison updates cannot be short-circuited by a prior fully covered cache entry',async()=>{
 const input=comparisonInput(),db=fixture({...input,lookupInstitutions:[],reusedEvidence:[{coverage:'verified',institution:'Eastview College',checkedAt:previousCheck,
  findings:[{subject:'Eastview College',aspect:'total_budget',status:'verified',answer:'Outdated scenario [R1]',qualification:'Old caveat [R1]'}],sources:[{ref:'R1',title:'Old source',url:'https://eastview.edu/policy',checkedAt:previousCheck}]}]});let count=0;
 await processResearchJob(db,{}, {log:()=>{},request:async()=>{count++;return new Response(JSON.stringify(comparisonEvidence(input)));}});
 assert.equal(count,1);
 const result=db.writes.find(w=>w.sql.includes("status='completed'"))?.args[1];assert.ok(result);assert.doesNotMatch(result.text,/Outdated scenario/);
});
