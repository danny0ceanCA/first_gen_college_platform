import {processResearchJob} from './voice-research-worker.mjs';
import test from 'node:test';import assert from 'node:assert/strict';
import {validatedBudget,budgetAudit} from '../src/publishedBudget.mjs';
import {parseResearchBrief,researchBriefRequest} from './research-brief.mjs';
import {comparisonAddition,mergeComparisonAddition,selectResearchReuse,cachedResearchForCoverage} from './research-reuse.mjs';
import {voiceVisualCards} from './voice-visual-cards.mjs';import {researchCostRows} from '../src/researchCostRows.ts';
import {hasCoaBreakdown} from './coa-evidence.mjs';
const now=Date.parse('2026-11-11T08:00:00Z'),checkedAt=new Date(now-1000).toISOString();
function fixture(language='en',name='Eastview College',housing=20000){
 const budget={year:'2026-27',population:'California-resident undergraduate',currency:'USD',period:'academic_year',housing:'renting',assumed:true,total:20000+housing,sourceCitation:'[1]',complete:true,expectedCategories:['tuition_fees','housing','food','books','transportation'],components:[['tuition_fees',10000],['housing',housing],['food',8000],['books',1000],['transportation',1000]].map(([key,amount])=>({key,sourceLabel:key,amount,role:'component',qualification:''}))};
 const finding={subject:name,aspect:'total_budget',status:'verified',answer:'Wrong total $999 [1].',qualification:language==='es'?'Referencia publicada antes de la ayuda; no confirma el plan del estudiante. [1]':'Published before-aid benchmark, not a confirmed student plan. [1]',budget};
 const data={brief:{status:'verified',answer:finding.answer,qualification:finding.qualification,nextStep:'',findings:[finding]},report:'Wrong total $999 [1].'};
 const result=parseResearchBrief({checkedAt,sources:[{url:name.startsWith('East')?'https://eastview.edu/budget':'https://pinevalley.edu/budget',checkedAt}],text:JSON.stringify(data)},language);
 return {budget,finding,data,result};
}
for(const language of ['en','es']){
 test(`${language}: numeric budget fields drive the same total and line items for voice and table`,()=>{
  const {result}=fixture(language);assert.equal(result.voiceBrief.status,'verified');assert.ok(!result.text.includes('$999'));assert.match(result.voiceBrief.answer,/40,000/);
  const finding=result.voiceBrief.findings[0];assert.ok(hasCoaBreakdown(finding));assert.equal(finding.budget.total,40000);
  const events=[],visual=voiceVisualCards({now:()=>now,emit:e=>events.push(e)}),question='Cost of attendance off campus';visual.trackResearch('cost',question);
  visual.receiveResearch({id:'cost',status:'completed',question,query:{requestKey:'cost',language},result});
  const report=events[0].report,rows=researchCostRows(report.table.rows,1,report.housingScenario);
  assert.equal(report.housingBenchmark,true);assert.equal(rows.at(-1).cells[0].value,'$40,000');assert.equal(rows.find(r=>r.id==='housing').cells[0].value,'$20,000');
 });
 test(`${language}: undated comparison reuses the published benchmark and checks only the added campus`,()=>{
  const {result}=fixture(language),input={mode:'finance',language,institution:'Pine Valley College',question:language==='es'?'¿Y Pine Valley College?':'What about Pine Valley College?'};
  const base={status:'completed',finished_at:checkedAt,input:{mode:'finance',institution:'Eastview College',question:'Latest cost of attendance off campus, arrangement unspecified'},result};
  const plan=comparisonAddition(input,base,{now});assert.ok(plan);assert.deepEqual(plan.lookupInstitutions,['Pine Valley College']);
  assert.equal(plan.reusedEvidence[0].findings[0].budget.assumed,true);assert.equal(plan.reusedEvidence[0].findings[0].budget.sourceCitation,'[R1]');
  const merged=mergeComparisonAddition(fixture(language,'Pine Valley College',30000).result,plan);
  assert.equal(merged.voiceBrief.findings.length,2);const retained=merged.voiceBrief.findings.find(f=>f.subject==='Eastview College');assert.equal(retained.budget.total,40000);assert.equal(retained.budget.sourceCitation,'[2]');
  assert.equal(merged.sources[1].checkedAt,checkedAt);
  for(const question of ['2027-28 cost of attendance','Cost living with family','Cost living with family off campus','Cost of attendance in residence halls','Graduate school costs','Nonresident undergraduate budget'])assert.equal(comparisonAddition({...input,question},base,{now}),null);
 });
 test(`${language}: missing categories and mismatches remain partial, with the original total preserved`,()=>{
  const {data}=fixture(language);data.brief.findings[0].budget.components.find(c=>c.key==='books').amount=null;
  let result=parseResearchBrief({sources:[{url:'https://eastview.edu/budget'}],text:JSON.stringify(data)},language);assert.equal(result.voiceBrief.findings[0].status,'partial');assert.equal(hasCoaBreakdown(result.voiceBrief.findings[0]),false);
  data.brief.findings[0].budget.components.find(c=>c.key==='books').amount=1500;
  result=parseResearchBrief({sources:[{url:'https://eastview.edu/budget'}],text:JSON.stringify(data)},language);
  assert.equal(result.voiceBrief.findings[0].budget.total,40000);assert.equal(result.voiceBrief.findings[0].status,'partial');assert.match(result.voiceBrief.findings[0].qualification,language==='es'?/Diferencia/:/Published total minus/);
 });
}
test('budget validation rejects forged citations, duplicate categories, nonfinite values and double-counted room/board',()=>{
 const {budget}=fixture();for(const mutate of [b=>b.sourceCitation='[99]',b=>b.components.push({...b.components[0]}),b=>b.total=Infinity,b=>b.components[0].amount=-1,b=>b.components.push({key:'housing_and_food',sourceLabel:'Room and board',amount:20000,role:'component',qualification:''})]){const b=structuredClone(budget);mutate(b);assert.equal(validatedBudget(b,new Set([1])),null);}
 const invalid=fixture().data;invalid.brief.findings[0].budget.sourceCitation='[99]';const rejected=parseResearchBrief({sources:[{url:'https://eastview.edu'}],text:JSON.stringify(invalid)});assert.equal(rejected.voiceBrief.status,'unverified');assert.ok(!rejected.text.includes('$999'));
 const schema=researchBriefRequest({input:'{}',instructions:'Rules'}).text.format.schema.properties.brief.properties.findings.items;
 assert.ok(schema.required.includes('budget'));assert.deepEqual(schema.properties.budget.type,['object','null']);
 const b=structuredClone(budget);b.components.push({key:'document_fee',sourceLabel:'Document fee outside total',amount:100,role:'excluded',qualification:'Not included.'});assert.equal(budgetAudit(b).complete,true);
});
for(const language of ['en','es'])test(`${language}: a rephrased undated COA question uses the saved source scope without a lookup`,()=>{
 const {result}=fixture(language),record={status:'completed',finished_at:checkedAt,input:{mode:'finance',institution:'Eastview College',question:'Published cost, year and housing unspecified'},result};
 const query={mode:'finance',language,institution:'Eastview College',question:language==='es'?'¿Cuál es el costo de asistencia?':'What is the cost of attendance?'};
 const reuse=selectResearchReuse(query,[record],{now});assert.deepEqual(reuse.lookupInstitutions,[]);
 const cached=cachedResearchForCoverage(reuse);assert.ok(cached);assert.equal(cached.voiceBrief.findings[0].budget.total,40000);assert.equal(cached.voiceBrief.findings[0].budget.assumed,true);
 assert.equal(cached.sources[0].checkedAt,checkedAt);
 for(const change of [{forceRefresh:true},{question:'2027-28 cost of attendance'},{question:'Graduate cost of attendance'},{question:'Cost of attendance living with family'}])assert.equal(cachedResearchForCoverage(selectResearchReuse({...query,...change},[record],{now})),null);
 assert.equal(cachedResearchForCoverage(selectResearchReuse(query,[record],{now:now+300001})),null);
});
for(const language of ['en','es'])test(`${language}: the worker checks only the new campus and persists numeric evidence with remapped citations`,async()=>{
 const base=fixture(language).result,plan=comparisonAddition({mode:'finance',language,institution:'Pine Valley College',question:'What about Pine Valley College?'},{status:'completed',input:{mode:'finance',institution:'Eastview College',question:'Latest cost off campus, arrangement unspecified'},finished_at:checkedAt,result:base},{now});
 const writes=[];let claimed=false,calls=0;
 const db={async query(sql,args){if(sql.includes('RETURNING id,input')){if(claimed)return {rows:[]};claimed=true;return {rows:[{id:'test-job',input:{...plan,mode:'finance',language}}]};}writes.push({sql,args});return {rows:[{status:'running'}],rowCount:1};}};
 await processResearchJob(db,{}, {now:()=>now,log:()=>{},request:async(url,options)=>{
  calls++;const request=JSON.parse(options.body);assert.equal(JSON.parse(request.input).institution,'Pine Valley College');assert.ok(!request.input.includes('Eastview'));
  assert.ok(request.text.format.schema.properties.brief.properties.findings.items.required.includes('budget'));
  const data=fixture(language,'Pine Valley College',30000).data;data.brief.findings[0].budget.sourceCitation='CITE';
  const text=JSON.stringify(data),start=text.indexOf('CITE');return new Response(JSON.stringify({status:'completed',output:[{type:'web_search_call',status:'completed'},{type:'message',content:[{type:'output_text',text,annotations:[{type:'url_citation',url:'https://pinevalley.edu/budget',start_index:start,end_index:start+4}]}]}]}));
 }});
 assert.equal(calls,1);const result=writes.find(w=>w.sql.includes("status='completed'"))?.args[1];assert.ok(result);
 assert.equal(result.retainedFindingCount,1);assert.equal(result.researchDiagnostics.recoveryStatus,'not_needed');
 assert.equal(result.voiceBrief.findings.find(f=>f.subject==='Eastview College').budget.total,40000);
 assert.equal(result.voiceBrief.findings.find(f=>f.subject==='Pine Valley College').budget.total,50000);
});
