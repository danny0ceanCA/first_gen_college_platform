import test from 'node:test';
import assert from 'node:assert/strict';
import {selectResearchReuse,reuseResearchRequest,mergeReusedResearchSources,cachedResearchForCoverage,parseReusedOnlyResearch} from './research-reuse.mjs';
import {voiceResearchCache} from '../src/voiceResearchCache.mjs';
const now=Date.parse('2026-11-05T17:00:00Z');
const question='2026–27 undergraduate tuition and mandatory fees for California residents at UC Berkeley';
const finding={subject:'UC Berkeley',aspect:'tuition_fees',status:'verified',answer:'UC Berkeley 2026–27 undergraduate tuition and mandatory fees are $18,214. [1]',qualification:'California-resident published academic-year estimate before aid, not a personal bill. [1]'};
const result={text:finding.answer+' '+finding.qualification,sources:[{url:'https://financialaid.berkeley.edu/costs',title:'Official costs',checkedAt:new Date(now-1000).toISOString()}],checkedAt:new Date(now-1000).toISOString(),voiceBrief:{status:'verified',answer:finding.answer,qualification:finding.qualification,nextStep:'',findings:[finding]}};
const row={status:'completed',finished_at:new Date(now-1000).toISOString(),input:{mode:'finance',institution:'UC Berkeley',question},result};
const query={mode:'finance',institution:'UC Berkeley and UC Santa Cruz',question:'Compare 2026–27 undergraduate tuition and mandatory fees for California residents at UC Berkeley and UC Santa Cruz'};

test('comparison reuses supported Berkeley findings and searches only the missing campus',()=>{
 const reuse=selectResearchReuse(query,[row],{now});
 assert.deepEqual(reuse.lookupInstitutions,['UC Santa Cruz']);
 assert.equal(reuse.reusedEvidence[0].coverage,'verified');assert.match(reuse.reusedEvidence[0].findings[0].answer,/\[R1\]/);
 assert.equal(reuse.reusedEvidence[0].sources[0].url,result.sources[0].url);
 const request=reuseResearchRequest({input:JSON.stringify(query),instructions:'Official research'},reuse),input=JSON.parse(request.input);
 assert.deepEqual(input.lookupInstitutions,['UC Santa Cruz']);assert.match(request.instructions,/Do not re-search a covered institution/);
});

for(const language of ['en','es'])test(`${language}: a new-campus comparison retains a qualified prior finding whose original question omitted the year`,()=>{
 const previous=structuredClone(row);
 previous.input.question=language==='en'?'Current undergraduate tuition and mandatory fees for California residents at UC Berkeley':'Matrícula y cuotas de pregrado para residentes de California en UC Berkeley';
 previous.result.voiceBrief.findings[0].subject='UC Berkeley — new undergraduate transfers, 2026–27';
 const question=language==='en'?'Compare 2026–27 undergraduate tuition and mandatory fees for California residents at UC Santa Cruz with the verified UC Berkeley figures':'Compara matrícula y cuotas de pregrado 2026–27 para residentes de California de UC Santa Cruz con UC Berkeley';
 const reuse=selectResearchReuse({mode:'finance',institution:'UC Santa Cruz',question},[previous],{now});
 assert.equal(reuse.reusedEvidence.length,1);assert.equal(reuse.reusedEvidence[0].findings[0].status,'verified');
 assert.deepEqual(reuse.lookupInstitutions,['UC Santa Cruz']);assert.match(reuse.reusedEvidence[0].findings[0].qualification,/California-resident/);
 const request=reuseResearchRequest({input:'{}',instructions:''},reuse);assert.match(request.instructions,/check the newly requested campus first/);
 const wrongYear=structuredClone(previous);wrongYear.result.voiceBrief.findings[0].subject='UC Berkeley — 2025–26';wrongYear.result.voiceBrief.findings[0].answer=wrongYear.result.voiceBrief.findings[0].answer.replace('2026–27','2025–26');
 assert.deepEqual(selectResearchReuse({mode:'finance',institution:'UC Santa Cruz',question},[wrongYear],{now}),{});
 const missingYear=structuredClone(previous);missingYear.result.voiceBrief.findings[0].subject='UC Berkeley';missingYear.result.voiceBrief.findings[0].answer=missingYear.result.voiceBrief.findings[0].answer.replace('2026–27','');
 assert.deepEqual(selectResearchReuse({mode:'finance',institution:'UC Santa Cruz',question},[missingYear],{now}),{});
});

test('qualified campus subjects and both residency categories preserve evidence without confusing another campus',()=>{
 const previous=structuredClone(row);previous.input.question=question+' and nonresidents';previous.result.voiceBrief.findings[0].subject='University of California, Berkeley — entering undergraduates, 2026–27';
 const reuse=selectResearchReuse({...query,question:query.question+' and nonresidents'},[previous],{now});assert.equal(reuse.reusedEvidence[0].findings[0].status,'verified');
 previous.result.voiceBrief.findings[0].subject='UC Santa Cruz — entering undergraduates, 2026–27';
 assert.deepEqual(selectResearchReuse({...query,question:query.question+' and nonresidents'},[previous],{now}),{});
});

test('retained source IDs survive a filtered source list',()=>{
 const previous=structuredClone(row);previous.result.sources[0].id=7;
 previous.result.voiceBrief.answer=previous.result.voiceBrief.answer.replace('[1]','[7]');previous.result.voiceBrief.qualification=previous.result.voiceBrief.qualification.replace('[1]','[7]');
 previous.result.voiceBrief.findings[0].answer=previous.result.voiceBrief.findings[0].answer.replace('[1]','[7]');previous.result.voiceBrief.findings[0].qualification=previous.result.voiceBrief.findings[0].qualification.replace('[1]','[7]');
 assert.equal(selectResearchReuse(query,[previous],{now}).reusedEvidence[0].sources[0].url,result.sources[0].url);
});

test('refresh, changed year, population, age of evidence and unmatched institution prevent reuse',()=>{
 for(const changed of [{forceRefresh:true},{question:query.question.replaceAll('2026–27','2027–28')},{question:'Compare current undergraduate tuition for California residents at UC Berkeley and UC Santa Cruz'},{question:query.question.replace('California residents','international students')},{question:query.question.replace('undergraduate','graduate')},{institution:'UC Davis'}])assert.deepEqual(selectResearchReuse({...query,...changed},[row],{now}),{});
 assert.deepEqual(selectResearchReuse(query,[{...row,finished_at:new Date(now-300000).toISOString()}],{now}),{});
 assert.deepEqual(selectResearchReuse(query,[{...row,status:'failed'}],{now}),{});
});

test('partial or legacy evidence cannot claim coverage of an entire campus',()=>{
 const old=structuredClone(row);delete old.result.voiceBrief.findings;old.result.voiceBrief.status='partial';
 const reuse=selectResearchReuse(query,[old],{now});assert.deepEqual(reuse.lookupInstitutions,['UC Berkeley','UC Santa Cruz']);assert.equal(reuse.reusedEvidence[0].coverage,'reference');
 const narrow=selectResearchReuse({...query,question:query.question+' and total housing budgets'},[row],{now});assert.equal(narrow.reusedEvidence[0].coverage,'reference');
 const bad=structuredClone(row);bad.result.sources[0].url='https://aggregator.example/cost';assert.deepEqual(selectResearchReuse(query,[bad],{now}),{});
});

test('housing, period, currency, program and omitted population assumptions never earn direct coverage',()=>{
 const housingRow=structuredClone(row);housingRow.input.question=question+' with on-campus housing budget';housingRow.result.voiceBrief.findings=[{...finding,aspect:'housing',answer:'UC Berkeley on-campus housing budget is $21,000 for the academic year. [1]'}];
 const next={...query,question:question+' with off-campus housing budget'};
 assert.equal(selectResearchReuse(next,[housingRow],{now}).reusedEvidence[0].coverage,'reference');
 assert.equal(selectResearchReuse({...next,question:question+' with housing budget'},[housingRow],{now}).reusedEvidence[0].coverage,'reference');
 for(const changed of [question+' per semester',question+' in CAD',question+' for the engineering program',question.replace(' for California residents','')]){
  const reuse=selectResearchReuse({...query,question:changed},[row],{now});assert.equal(reuse.reusedEvidence[0].coverage,'reference');assert.equal(cachedResearchForCoverage(reuse),null);
 }
 assert.equal(selectResearchReuse({...query,question:query.question.replace('2026–27','2026-2027')},[row],{now}).reusedEvidence[0].coverage,'verified');
});

test('citations from retained facts merge with new official citations without collisions or forged refs',()=>{
 const reuse=selectResearchReuse(query,[row],{now}),parsed={text:'UCSC finding [1]. Berkeley retained finding [R1].',sources:[{url:'https://financialaid.ucsc.edu/costs',title:'UCSC costs'}]};
 const merged=mergeReusedResearchSources(parsed,reuse);
 assert.equal(merged.text,'UCSC finding [1]. Berkeley retained finding [2].');assert.equal(merged.sources[1].url,result.sources[0].url);
 assert.equal(mergeReusedResearchSources({...parsed,text:'Forged [R999].'},reuse),null);
 assert.equal(mergeReusedResearchSources(null,reuse),null);
});

test('fully covered follow-up returns current evidence without another model or research job',()=>{
 const reuse=selectResearchReuse({...query,institution:'UC Berkeley',question},[row],{now});
 const cached=cachedResearchForCoverage(reuse);assert.ok(cached);assert.equal(cached.sources.length,1);assert.equal(cached.voiceBrief.findings[0].status,'verified');assert.match(cached.text,/\[1\]/);assert.doesNotMatch(cached.text,/\[R/);
 assert.equal(cachedResearchForCoverage(selectResearchReuse(query,[row],{now})),null);
});

test('a failed new source can still return honestly partial research with retained official citations',()=>{
 const reuse=selectResearchReuse(query,[row],{now});
 const findings=[...reuse.reusedEvidence[0].findings,{subject:'UC Santa Cruz',aspect:'tuition_fees',status:'unverified',answer:'UCSC tuition could not be verified.',qualification:'The source check ended without confirming the requested figure.'}];
 const text=JSON.stringify({brief:{status:'partial',answer:'UCSC unverified; Berkeley retains its published figure [R1].',qualification:'No reliable comparison yet.',nextStep:'',findings},report:'UCSC unverified. Berkeley retained official source [R1].'});
 const data={status:'completed',output:[{type:'web_search_call',status:'completed'},{type:'message',content:[{type:'output_text',text,annotations:[]}]}]};
 const parsed=parseReusedOnlyResearch(data,reuse);assert.ok(parsed);assert.equal(parsed.sources.length,1);assert.doesNotMatch(parsed.text,/\[R1\]/);
 assert.equal(parseReusedOnlyResearch({...data,status:'incomplete'},reuse),null);
 const fabricated=structuredClone(data);fabricated.output[1].content[0].text=text.replaceAll('[R1]','[R99]');assert.equal(parseReusedOnlyResearch(fabricated,reuse),null);
 const annotation=structuredClone(data);annotation.output[1].content[0].annotations=[{type:'url_citation',url:'https://unofficial.example'}];assert.equal(parseReusedOnlyResearch(annotation,reuse),null);
 const unsupported=structuredClone(data);unsupported.output[1].content[0].text=text.replaceAll('[R1]','[1]');assert.equal(parseReusedOnlyResearch(unsupported,reuse),null);
 const crossCampus=structuredClone(data),crossValue=JSON.parse(text);crossValue.brief.findings[0].subject='UC Santa Cruz';crossCampus.output[1].content[0].text=JSON.stringify(crossValue);assert.equal(parseReusedOnlyResearch(crossCampus,reuse),null);
 const crossAspect=structuredClone(data),aspectValue=JSON.parse(text);aspectValue.brief.findings[0].aspect='total_budget';crossAspect.output[1].content[0].text=JSON.stringify(aspectValue);assert.equal(parseReusedOnlyResearch(crossAspect,reuse),null);
 const refusal=structuredClone(data);refusal.output[1].content.push({type:'refusal',refusal:'Cannot complete.'});assert.equal(parseReusedOnlyResearch(refusal,reuse),null);
 assert.equal(parseReusedOnlyResearch({...data,status:'failed'},reuse),null);
 const partial=structuredClone(reuse);partial.reusedEvidence[0].findings[0].status='partial';assert.equal(parseReusedOnlyResearch(data,partial),null);
});

test('per-call cache exposes only bounded public query records and clears on scope changes',()=>{
 const cache=voiceResearchCache(()=>now);cache.put({...row.input,studentId:'private-id',secret:'no'},result);
 assert.equal(cache.records().length,1);assert.equal(cache.records()[0].input.studentId,undefined);assert.equal(cache.records()[0].input.secret,undefined);
 cache.clear();assert.deepEqual(cache.records(),[]);assert.equal(cache.get(row.input),undefined);
});

function comparisonFixture(institutions,language='en'){
 const question=language==='es'?
  `Compara matrícula y cuotas de pregrado y presupuesto total fuera del campus 2026–27 para residentes de California: ${institutions.join(' y ')}`:
  `Compare 2026–27 undergraduate tuition and mandatory fees and off-campus total budget for California residents: ${institutions.join(' and ')}`;
 const sources=institutions.map((institution,index)=>({url:`https://campus${index}.edu/costs`,title:institution+' official budget',checkedAt:new Date(now-1000).toISOString()}));
 const findings=institutions.flatMap((institution,index)=>[
  {subject:institution+' — entering undergraduates, 2026–27',aspect:'tuition_fees',status:'verified',answer:`${institution} tuition and fees are $18,000 for 2026–27. [${index+1}]`,qualification:`California-resident academic-year estimate; health insurance is separate. [${index+1}]`},
  {subject:institution+' — entering undergraduates, 2026–27',aspect:'total_budget',status:'verified',answer:`${institution} off-campus total is $48,000 for 2026–27. [${index+1}]`,qualification:`California-resident academic-year estimate before aid. [${index+1}]`},
 ]);
 return {status:'completed',finished_at:new Date(now-500).toISOString(),input:{mode:'finance',institution:institutions.join('; '),question},result:{checkedAt:new Date(now-1000).toISOString(),sources,text:findings.map(f=>f.answer+' '+f.qualification).join(' '),voiceBrief:{status:'verified',answer:findings[0].answer,qualification:findings[0].qualification,nextStep:'',findings}}};
}

for(const language of ['en','es'])test(`${language}: Berkeley to Davis to UCLA to Irvine reuses findings from prior comparisons`,()=>{
 const berkeley=comparisonFixture(['UC Berkeley'],language);
 const davis=comparisonFixture(['UC Davis','UC Berkeley'],language);
 const ucla=comparisonFixture(['UCLA','UC Berkeley','UC Davis'],language);
 const irvine=comparisonFixture(['UC Irvine','UCLA','UC Berkeley','UC Davis'],language);
 for(const [next,history,expected] of [[davis,[berkeley],['UC Berkeley']],[ucla,[davis,berkeley],['UC Davis','UC Berkeley']],[irvine,[ucla,davis,berkeley],['UCLA','UC Berkeley','UC Davis']]]){
  const reuse=selectResearchReuse(next.input,history,{now});
  assert.deepEqual(reuse.lookupInstitutions,[next.input.institution.split('; ')[0]]);
  assert.deepEqual(reuse.reusedEvidence.map(e=>e.institution).sort(),expected.sort());
  assert.ok(reuse.reusedEvidence.every(e=>e.coverage==='verified'));
  for(const entry of reuse.reusedEvidence){
   assert.equal(entry.findings.length,2);
   assert.equal(entry.sources.length,1);
   assert.equal(entry.sources[0].title,entry.institution+' official budget');
   assert.ok(entry.findings.every(f=>f.subject.startsWith(entry.institution+' —')));
   assert.ok(entry.findings.every(f=>f.answer.includes(`[${entry.sources[0].ref}]`)));
  }
 }
 // A later narrow follow-up can use the same comparison's Davis portion with
 // no new search, without importing UCLA's or Berkeley's findings as Davis.
 const followup=comparisonFixture(['UC Davis'],language).input;
 const reuse=selectResearchReuse(followup,[ucla],{now}),cached=cachedResearchForCoverage(reuse);
 assert.deepEqual(reuse.lookupInstitutions,[]);assert.ok(cached);
 assert.equal(cached.sources.length,1);assert.ok(cached.voiceBrief.findings.every(f=>f.subject.startsWith('UC Davis —')));
 assert.doesNotMatch(cached.text,/UCLA|Berkeley/);
});

test('comparison reuse rejects ambiguous subjects, wrong-year portions and legacy mixed-campus prose',()=>{
 const previous=comparisonFixture(['UC Davis','UC Berkeley']),input=comparisonFixture(['UCLA','UC Davis','UC Berkeley']).input;
 const ambiguous=structuredClone(previous);ambiguous.result.voiceBrief.findings.forEach(f=>{f.subject='UC Davis and UC Berkeley';});
 assert.deepEqual(selectResearchReuse(input,[ambiguous],{now}),{});
 const wrongYear=structuredClone(previous);wrongYear.result.voiceBrief.findings.filter(f=>f.subject.startsWith('UC Davis')).forEach(f=>{f.subject=f.subject.replace('2026–27','2025–26');f.answer=f.answer.replace('2026–27','2025–26');});
 const reuse=selectResearchReuse(input,[wrongYear],{now});
 assert.deepEqual(reuse.reusedEvidence.map(e=>e.institution),['UC Berkeley']);
 assert.deepEqual(reuse.lookupInstitutions,['UCLA','UC Davis']);
 const legacy=structuredClone(previous);delete legacy.result.voiceBrief.findings;
 assert.deepEqual(selectResearchReuse(input,[legacy],{now}),{});
});

test('a newer comparison cannot refresh an inherited stale source or upgrade partial campus findings',()=>{
 const previous=comparisonFixture(['UCLA','UC Berkeley']),input=comparisonFixture(['UC Irvine','UCLA','UC Berkeley']).input;
 previous.result.sources[1].checkedAt=new Date(now-300000).toISOString();
 previous.result.voiceBrief.findings.find(f=>f.subject.startsWith('UCLA')&&f.aspect==='tuition_fees').status='partial';
 const reuse=selectResearchReuse(input,[previous],{now});
 assert.deepEqual(reuse.reusedEvidence.map(e=>e.institution),['UCLA']);
 assert.deepEqual(reuse.lookupInstitutions,['UC Irvine','UCLA','UC Berkeley']);
 assert.equal(reuse.reusedEvidence[0].coverage,'reference');
 assert.deepEqual(reuse.reusedEvidence[0].findings.map(f=>f.aspect),['total_budget']);
 assert.equal(reuse.reusedEvidence[0].checkedAt,previous.result.sources[0].checkedAt);
 const wrongSource=structuredClone(previous);wrongSource.result.sources[0].url='https://unofficial.example/costs';
 assert.deepEqual(selectResearchReuse(input,[wrongSource],{now}),{});
});

test('comparison reuse stays within four campuses and eight source-linked findings',()=>{
 const names=['UC Irvine','UCLA','UC Berkeley','UC Davis','UC Santa Cruz'];
 const records=names.map(name=>comparisonFixture([name]));
 const input=comparisonFixture(names).input;
 const reuse=selectResearchReuse(input,records,{now});
 assert.equal(reuse.reusedEvidence.length,4);
 assert.equal(reuse.reusedEvidence.flatMap(e=>e.findings).length,8);
 assert.deepEqual(reuse.lookupInstitutions,['UC Santa Cruz']);
 assert.ok(reuse.reusedEvidence.every(e=>e.coverage==='verified'));
});

test('per-campus subject population and housing limitations cannot inherit broader comparison coverage',()=>{
 for(const language of ['en','es']){
  const previous=comparisonFixture(['UC Davis','UC Berkeley'],language);
  const input={...previous.input,question:previous.input.question+(language==='es'?' para estudiantes de transferencia':' for transfer students')};
  previous.input.question=input.question;
  for(const subject of [
   language==='es'?'UC Davis — estudiantes de primer año, 2026–27':'UC Davis — first-year undergraduates, 2026–27',
   language==='es'?'UC Davis — estudiantes de transferencia, en el campus, 2026–27':'UC Davis — undergraduate transfers, on-campus, 2026–27',
  ]){
   const limited=structuredClone(previous);limited.result.voiceBrief.findings.filter(f=>f.subject.startsWith('UC Davis')).forEach(f=>{f.subject=subject;});
   const reuse=selectResearchReuse(input,[limited],{now});
   const davis=reuse.reusedEvidence.find(e=>e.institution==='UC Davis');
   assert.equal(davis.coverage,'reference',subject);
   assert.deepEqual(reuse.lookupInstitutions,['UC Davis'],subject);
   assert.equal(cachedResearchForCoverage(reuse),null);
  }
 }
});
