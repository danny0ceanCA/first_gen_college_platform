import test from 'node:test';
import assert from 'node:assert/strict';
import {comparisonFindings,comparisonClue,comparisonLookup,selectComparisonFinding,comparisonResearchRequest,parseComparisonResearch} from './voice-comparison-update.mjs';

const now=Date.now(),checkedAt=new Date(now-1000).toISOString();
function report(aspect='deadline',subjects=['Eastview College','Pine Valley College','Harbor College']){
 const sources=subjects.map((_,i)=>({url:'https://campus'+i+'.edu/policy',title:'Synthetic official policy',checkedAt}));
 const findings=subjects.map((subject,i)=>({subject,aspect,status:'verified',answer:subject+' fall 2027 published requirement ['+(i+1)+'].',qualification:'For first-year applicants; program exceptions must be confirmed ['+(i+1)+'].'}));
 return {checkedAt,sources,text:findings.map(f=>f.answer+' '+f.qualification).join('\n'),voiceBrief:{status:'verified',answer:findings[0].answer,qualification:findings[0].qualification,nextStep:'',findings}};
}
for(const [aspect,en,es] of [
 ['deadline','Change Eastview College to spring 2028.','Cambia Eastview College a primavera de 2028.'],
 ['eligibility','What if Eastview College enrollment is part time?','¿Qué pasa si la matrícula de medio tiempo es en Eastview College?'],
 ['total_budget','What if Eastview College housing is with family?','¿Y si vive con familia en Eastview College?'],
 ['tuition_fees','Change Eastview College tuition to the summer term.','Cambia la matrícula de Eastview College al verano.'],
 ['other','Switch Eastview College orientation to online.','Cambia la orientación de Eastview College a en línea.'],
])for(const language of ['en','es'])test(`${language}: arbitrary subjects and ${aspect} reuse two unaffected entries`,async()=>{
 const entries=comparisonFindings(report(aspect),{now});assert.equal(entries.length,3);
 const clue=comparisonClue(language==='es'?es:en,[],entries);assert.equal(clue?.id,entries[0].id);
 const plan=comparisonLookup(entries,clue.id,language,{changeText:clue.changeText,mode:'planning'});
 assert.deepEqual(plan.retained,entries.slice(1));assert.equal(plan.invalidated.length,0);
 let sent;
 const client={evaluate:async r=>{sent=r;return {response:{answers:[{type:'choice',name:'comparison_update',choice:clue.id,probabilities:[{value:clue.id,probability:.91}]}]}};}};
 assert.equal(await selectComparisonFinding(client,entries,clue),clue.id);
 assert.doesNotMatch(sent.input,/published requirement|first-year|part time|medio tiempo/);
 assert.equal(sent.questions[0].choices.at(-1).value,'unclear');
 const input={language,mode:'planning',comparisonPlan:{version:2,...plan}},request=comparisonResearchRequest({instructions:'Original scope rules',model:'test'},input);
 assert.doesNotMatch(request.input,/Pine Valley|Harbor/);assert.equal(request.max_tool_calls,2);
 assert.deepEqual(request.tools[0].filters.allowed_domains,['campus0.edu']);
});

for(const phrase of ['What if we use that college for spring?','¿Y si cambiamos esa opción a tiempo parcial?','Change both Eastview College and Pine Valley College to spring.','Cambia ambos a primavera.','Change Eastview College.','Please explain that.','What about Eastview College?','What if Unknown University switches to spring?'])test('no invented selection: '+phrase,()=>{
 assert.equal(comparisonClue(phrase,[],comparisonFindings(report(),{now})),null);
});
test('a named subject does not authorize checking an unrelated facet',()=>{
 const entries=comparisonFindings(report('total_budget'),{now});
 assert.equal(comparisonClue('Change Eastview College application deadline to the spring term.',[],entries),null);
});
for(const phrase of ['What if Eastview College is for transfer applicants instead? Keep Pine Valley College the same.', 'What if Eastview College is for transfer applicants instead Keep Pine Valley College the same', '¿Y si cambia Eastview College a solicitantes de transferencia? Deja Pine Valley College igual.', 'Y si cambio Eastview College a estudiantes de medio tiempo Deja Pine Valley College igual'])test('explicit keep-other sentence preserves a single changed target: '+phrase,()=>{
 const entries=comparisonFindings(report(),{now}),clue=comparisonClue(phrase,[],entries);
 assert.equal(clue?.id,entries[0].id);assert.doesNotMatch(clue.changeText,/Pine Valley/);
 assert.equal(comparisonClue('Change Eastview College to spring and Pine Valley College to fall.',[],entries),null);
});
for(const phrase of ['Change Eastview College to transfer applicants. Keep Eastview College the same.', 'Cambia Eastview College a transferencia. Deja Eastview College igual.'])test('contradictory keep-same-target request requires clarification: '+phrase,()=>{
 assert.equal(comparisonClue(phrase,[],comparisonFindings(report(),{now})),null);
});

test('program comparisons use the same contract without campus-name assumptions',()=>{
 const entries=comparisonFindings(report('eligibility',['Federal Pell Grant','State Opportunity Grant']),{now});
 for(const text of ['What if Federal Pell Grant enrollment is part time?', '¿Y si cambia Federal Pell Grant a medio tiempo?']){
  const clue=comparisonClue(text,[],entries);assert.equal(clue?.id,entries[0].id);
  const plan=comparisonLookup(entries,clue.id,'en',{changeText:clue.changeText,mode:'finance'});
  assert.equal(plan.retained[0].subject,'State Opportunity Grant');
 }
});
test('explicit grounded relative clue survives without hardcoded campus names',()=>{
 const entries=comparisonFindings(report('total_budget',['Eastview College','Pine Valley College']),{now});
 const current='What if we lived at home at the campus closer to our family?';
 assert.equal(comparisonClue(current,[],entries),null);
 const clue=comparisonClue(current,['Eastview College is closer to our family.'],entries);
 assert.equal(clue?.id,entries[0].id);assert.match(clue.changeText,/Eastview College/);assert.doesNotMatch(clue.changeText,/closer/);
 assert.equal(comparisonClue(clue.changeText,[],entries).id,entries[0].id);
 assert.equal(comparisonClue(current,['Eastview College is closer to our family.','Pine Valley College is closer to our family.'],entries),null);
});
for(const kind of ['old','future','unofficial','duplicate','unverified','missing_caveat'])test('invalid saved evidence fails closed: '+kind,()=>{
 const value=report();
 if(kind==='old')value.sources[1].checkedAt=new Date(now-300001).toISOString();
 if(kind==='future')value.sources[1].checkedAt=new Date(now+1).toISOString();
 if(kind==='unofficial')value.sources[1].url='https://campus.edu.attacker.example/policy';
 if(kind==='duplicate')value.voiceBrief.findings[1]={...value.voiceBrief.findings[0]};
 if(kind==='unverified')value.voiceBrief.findings[1].status='unverified';
 if(kind==='missing_caveat')value.voiceBrief.findings[1].qualification='';
 assert.equal(comparisonFindings(value,{now}),null);
});
for(const choice of ['unclear','wrong',null])test('classifier disagreement/refusal cannot override a clue: '+choice,async()=>{
 const entries=comparisonFindings(report(),{now}),clue=comparisonClue('Change Eastview College to spring 2028.',[],entries);
 assert.equal(await selectComparisonFinding({evaluate:async()=>({response:{answers:[choice?{type:'choice',name:'comparison_update',choice,probabilities:[{value:choice,probability:1}]}:{type:'refusal'}]}})},entries,clue),null);
});

function provider(input,{source='https://campus0.edu/spring',status='verified'}={}){
 const {target,changeText}=input.comparisonPlan;
 const text=JSON.stringify({subject:target.subject,aspect:target.aspect,requestedChange:changeText,status,answer:'Spring 2028 applications close September 1. CITE',qualification:'For transfer applicants only; program-specific deadlines can differ.'});
 const start_index=text.indexOf('CITE');
 return {status:'completed',output:[{type:'web_search_call',status:'completed',action:{type:'open_page',url:source}},
  {type:'message',content:[{type:'output_text',text,annotations:[{type:'url_citation',url:source,start_index,end_index:start_index+4}]}]}]};
}
test('successive changes preserve original caveats, sources and age; identical change is already applied',()=>{
 const entries=comparisonFindings(report(),{now}),changeText='Change Eastview College to spring 2028.';
 const plan=comparisonLookup(entries,entries[0].id,'en',{changeText,mode:'admissions'}),input={mode:'admissions',language:'en',comparisonPlan:{version:2,...plan}};
 const result=parseComparisonResearch(provider(input),input,()=>now);assert.ok(result);
 const next=comparisonFindings(result,{now:now+1});assert.equal(next.length,3);
 assert.equal(next[0].id,entries[0].id);assert.equal(next[1].checkedAt,checkedAt);
 assert.equal(comparisonClue(changeText,[],next).alreadyApplied,true);
 const second=comparisonClue('Change Pine Valley College to transfer applicants.',[],next);
 assert.equal(second.id,entries[1].id);
 assert.match(comparisonLookup(next,second.id,'en',{changeText:second.changeText,mode:'admissions'}).retained[0].answer,/September 1/);
 assert.equal(comparisonFindings(result,{now:now+300000}),null,'a new update cannot refresh old retained evidence');
});
test('same-subject dependent facets are invalidated, never passed as unchanged',()=>{
 const value=report();value.voiceBrief.findings.push({...value.voiceBrief.findings[0],aspect:'eligibility'});
 const entries=comparisonFindings(value,{now}),clue=comparisonClue('Change Eastview College deadline to spring 2028.',[],entries);
 const plan=comparisonLookup(entries,clue.id,'en',{changeText:clue.changeText,mode:'admissions'});
 assert.equal(plan.retained.length,2);assert.equal(plan.invalidated.length,1);
 const input={mode:'admissions',language:'en',comparisonPlan:{version:2,...plan}};
 const result=parseComparisonResearch(provider(input),input,()=>now);
 assert.equal(result.voiceBrief.findings.at(-1).status,'unverified');assert.doesNotMatch(result.voiceBrief.findings.at(-1).answer,/published requirement/);
});

test('a completed cited response can include an ignored trailing tool attempt',()=>{
 const entries=comparisonFindings(report(),{now});
 const plan=comparisonLookup(entries,entries[0].id,'en',{changeText:'Change Eastview College to spring 2028.',mode:'admissions'});
 const input={mode:'admissions',language:'en',comparisonPlan:{version:2,...plan}},data=provider(input,{status:'partial'});
 data.output.unshift({type:'web_search_call',status:'completed',action:{type:'search',sources:[{url:'https://campus0.edu/search'}]}});
 data.output.splice(2,0,{type:'web_search_call',status:'searching',action:{type:'search'}});
 const result=parseComparisonResearch(data,input,()=>now);
 assert.equal(result?.voiceBrief.status,'partial');assert.equal(result.retainedFindingCount,2);
});

test('a citation must come from a completed action, not an ignored attempt or a matching domain alone',()=>{
 const entries=comparisonFindings(report(),{now});
 const plan=comparisonLookup(entries,entries[0].id,'en',{changeText:'Change Eastview College to spring 2028.',mode:'admissions'});
 const input={mode:'admissions',language:'en',comparisonPlan:{version:2,...plan}},data=provider(input);
 data.output[0].action.url='https://campus0.edu/different';
 data.output.unshift({type:'web_search_call',status:'searching',action:{type:'open_page',url:'https://campus0.edu/spring'}});
 assert.equal(parseComparisonResearch(data,input,()=>now),null);
 data.output[1].action.url='https://campus0.edu/spring?year=2027';
 assert.equal(parseComparisonResearch(data,input,()=>now),null,'meaningful URL parameters remain part of source identity');
 data.output[1].action.url='https://campus0.edu/spring?utm_source=test#deadline';
 assert.ok(parseComparisonResearch(data,input,()=>now),'tracking parameters and fragment do not create different evidence');
});

test('scope present only in a subject label survives matching, research input and unchanged reuse',()=>{
 const value=report('total_budget',['Eastview College — graduate students','Pine Valley College (online programs)']);
 const entries=comparisonFindings(value,{now}),changeText='Change Eastview College to spring 2028.';
 const plan=comparisonLookup(entries,entries[0].id,'en',{changeText,mode:'finance'}),input={mode:'finance',language:'en',comparisonPlan:{version:2,...plan}};
 assert.equal(entries[0].sourceSubject,'Eastview College — graduate students');
 const request=comparisonResearchRequest({instructions:'Research',model:'test'},input);
 assert.equal(JSON.parse(request.input).prior.subject,'Eastview College — graduate students');
 const result=parseComparisonResearch(provider(input),input,()=>now);
 assert.equal(result.voiceBrief.findings[1].subject,'Pine Valley College (online programs)');
 assert.match(plan.retained[0].sourceSubject,/online programs/);
});

test('an A then B update retains A’s completed change for a later no-op',()=>{
 const entries=comparisonFindings(report(),{now}),changeA='Change Eastview College to spring 2028.';
 const planA=comparisonLookup(entries,entries[0].id,'en',{changeText:changeA,mode:'admissions'}),inputA={mode:'admissions',language:'en',comparisonPlan:{version:2,...planA}};
 const resultA=parseComparisonResearch(provider(inputA),inputA,()=>now),afterA=comparisonFindings(resultA,{now});
 const planB=comparisonLookup(afterA,entries[1].id,'en',{changeText:'Change Pine Valley College to spring 2028.',mode:'admissions'}),inputB={mode:'admissions',language:'en',comparisonPlan:{version:2,...planB}};
 const resultB=parseComparisonResearch(provider(inputB,{source:'https://campus1.edu/spring'}),inputB,()=>now),afterB=comparisonFindings(resultB,{now});
 assert.equal(comparisonClue(changeA,[],afterB).alreadyApplied,true);
 assert.equal(Object.keys(resultB.comparisonUpdate.appliedChanges).length,2);
});
