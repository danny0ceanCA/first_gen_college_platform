import test from 'node:test';
import assert from 'node:assert/strict';
import {selectResearchReuse,reuseResearchRequest,mergeReusedResearchSources,cachedResearchForCoverage,parseReusedOnlyResearch,retainVerifiedResearch,comparisonAddition,mergeComparisonAddition} from './research-reuse.mjs';
import {voiceResearchCache} from '../src/voiceResearchCache.mjs';
import {costHousingScenario} from './voice-housing-scope.mjs';
const now=Date.parse('2026-11-05T17:00:00Z');
const question='2026–27 undergraduate tuition and mandatory fees for California residents at UC Berkeley';
const finding={subject:'UC Berkeley',aspect:'tuition_fees',status:'verified',answer:'UC Berkeley 2026–27 undergraduate tuition and mandatory fees are $18,214. [1]',qualification:'California-resident published academic-year estimate before aid, not a personal bill. [1]'};
const result={text:finding.answer+' '+finding.qualification,sources:[{url:'https://financialaid.berkeley.edu/costs',title:'Official costs',checkedAt:new Date(now-1000).toISOString()}],checkedAt:new Date(now-1000).toISOString(),voiceBrief:{status:'verified',answer:finding.answer,qualification:finding.qualification,nextStep:'',findings:[finding]}};
const row={status:'completed',finished_at:new Date(now-1000).toISOString(),input:{mode:'finance',institution:'UC Berkeley',question},result};
const query={mode:'finance',institution:'UC Berkeley and UC Santa Cruz',question:'Compare 2026–27 undergraduate tuition and mandatory fees for California residents at UC Berkeley and UC Santa Cruz'};

test('explicit rental scope survives comparison phrasing without inferring an unspecified housing plan',()=>{
 for(const text of ['off-campus renting scenarios for both (not on campus)','off-campus apartment rental','alquiler fuera del campus','fuera del campus y alquilando'])assert.equal(costHousingScenario(text),'renting',text);
 for(const text of ['off campus, not renting','off campus renting is not the plan','renting off campus isn’t the plan','alquiler fuera del campus no es el plan','off-campus housing, arrangement unspecified','fuera del campus, modalidad sin especificar'])assert.equal(costHousingScenario(text),'off_campus',text);
 for(const text of ['off campus renting or living with family','alquiler fuera del campus o con sus padres','off-campus renting or on campus'])assert.notEqual(costHousingScenario(text),'renting',text);
});

for(const language of ['en','es'])test(`${language}: cited partial budget stays with its discrepancy when adding a college`,()=>{
 const previous=structuredClone(row);
 previous.input.question=language==='en'?'2026–27 undergraduate annual tuition and total budget for California residents renting off campus':'Matrícula y presupuesto anual de pregrado 2026–27 para residentes de California que alquilan fuera del campus';
 const partial={subject:'UC Berkeley — off-campus apartment rental, 2026–27',aspect:'total_budget',status:'partial',
  answer:language==='en'?'US$49,692 before aid for the academic year. Published breakdown: Tuition and fees: $18,214; Housing: $14,386. [1]':'US$49,692 antes de la ayuda para el año académico. Desglose publicado: Matrícula y cuotas: $18,214; Alojamiento: $14,386. [1]',
  qualification:language==='en'?'Another official page lists $49,420; this discrepancy is unresolved. Planning estimate, not a bill. [1]':'Otra página oficial indica $49,420; la discrepancia no está resuelta. Es una estimación, no una factura. [1]'};
 previous.result.voiceBrief.findings.push(partial);previous.result.voiceBrief.status='partial';
 const input={...previous.input,language,institution:'UC Davis'};
 const reuse=selectResearchReuse({...input,institution:'UC Davis; UC Berkeley'},[previous],{now});
 assert.equal(reuse.reusedEvidence[0].coverage,'reference');assert.equal(cachedResearchForCoverage(reuse),null);
 const tuitionOnly=selectResearchReuse({...input,institution:'UC Berkeley',question:'2026–27 undergraduate annual tuition and mandatory fees for California residents'},[previous],{now});
 const cached=cachedResearchForCoverage(tuitionOnly);
 assert.ok(cached);assert.equal(cached.voiceBrief.status,'partial','fully covered tuition cannot upgrade a retained partial budget');
 const plan=comparisonAddition(input,previous,{now});assert.deepEqual(plan.lookupInstitutions,['UC Davis']);
 const retained=plan.reusedEvidence[0].findings.find(f=>f.aspect==='total_budget');
 assert.equal(retained.status,'partial');assert.match(retained.qualification,/49,420/);
 assert.match(retained.answer,/49,692/);assert.match(retained.answer,/14,386/);
 const davis=structuredClone(result);davis.voiceBrief.findings=davis.voiceBrief.findings.map(f=>({...f,subject:'UC Davis'}));
 const merged=mergeComparisonAddition(davis,plan);
 assert.equal(merged.voiceBrief.status,'partial');
 assert.equal(merged.voiceBrief.findings.find(f=>f.aspect==='total_budget').qualification,partial.qualification);
 const stale=structuredClone(previous);stale.result.sources[0].checkedAt=new Date(now-300000).toISOString();
 assert.deepEqual(comparisonAddition(input,stale,{now}).reusedEvidence,[],'a fresh task may continue without reusing stale source facts');
 assert.equal(comparisonAddition({...input,question:input.question.replace('2026–27','2027–28')},previous,{now}),null);
 const unsupported=structuredClone(previous);unsupported.result.voiceBrief.findings[1].status='unverified';
 assert.deepEqual(comparisonAddition(input,unsupported,{now}).reusedEvidence[0].findings.map(f=>f.aspect),['tuition_fees']);
});

for(const language of ['en','es'])test(`${language}: an inaccessible previous campus does not block a clear same-scenario addition`,()=>{
 const question=language==='en'?'2026–27 undergraduate transfer annual tuition and total budget for California residents renting off campus':'Matrícula y presupuesto anual de pregrado y transferencia 2026–27 para residentes de California que alquilan fuera del campus';
 const previous={...structuredClone(row),input:{mode:'finance',institution:'UC Irvine',question}};
 const tuition={...previous.result.voiceBrief.findings[0],subject:'UC Irvine',status:'partial',answer:'2026–27 tuition $14,202; Student Services Fee $1,386 [1].',qualification:'The official total does not reconcile. The full fee subtotal remains unverified [1].'};
 const unknown={subject:'UC Irvine',aspect:'total_budget',status:'unverified',answer:'The annual rental total could not be verified.',qualification:'The official page was inaccessible.'};
 previous.result.voiceBrief.findings=[tuition,unknown];previous.result.voiceBrief.status='partial';
 const input={mode:'finance',language,institution:'UC Merced',question};
 const plan=comparisonAddition(input,previous,{now});
 assert.deepEqual(plan.lookupInstitutions,['UC Merced']);assert.doesNotMatch(plan.question,/Irvine/);
 assert.equal(plan.reusedEvidence[0].coverage,'reference');assert.equal(plan.reusedEvidence[0].findings[0].status,'partial');
 assert.match(plan.reusedEvidence[0].findings[0].qualification,/does not reconcile/);
 const fresh={...structuredClone(result),voiceBrief:{...result.voiceBrief,status:'unverified',findings:[{...unknown,subject:'UC Merced'}]}};
 const merged=mergeComparisonAddition(fresh,plan);
 assert.equal(merged.voiceBrief.status,'partial');assert.equal(merged.voiceBrief.findings[0].status,'unverified');
 assert.equal(merged.voiceBrief.findings[1].status,'partial');
 previous.result.voiceBrief.findings=[unknown];previous.result.sources=[];
 const emptyPlan=comparisonAddition(input,previous,{now});
 assert.deepEqual(emptyPlan.reusedEvidence,[]);assert.deepEqual(emptyPlan.lookupInstitutions,['UC Merced']);
 assert.equal(mergeComparisonAddition(fresh,emptyPlan).voiceBrief.status,'unverified');
 for(const invalid of [
  {...input,question:question.replace('2026–27','2027–28')},
  {...input,question:language==='en'?question.replace('renting off campus','living with family'):question.replace('alquilan fuera del campus','viven con sus padres')},
  {...input,question:question.replace(language==='en'?'California residents':'residentes de California',language==='en'?'nonresidents':'no residentes')},
  {...input,question:question+(language==='en'?' per semester':' por semestre')},
 ])assert.equal(comparisonAddition(invalid,previous,{now}),null,invalid.question);
 assert.equal(comparisonAddition(input,{...previous,status:'running'},{now}),null);
 assert.equal(comparisonAddition(input,{...previous,finished_at:new Date(now-300000).toISOString()},{now}),null);
});

test('new-campus results take priority over retained context within the eight-finding Live contract',()=>{
 const fresh=structuredClone(result);
 fresh.voiceBrief.findings=Array.from({length:8},(_,index)=>({...finding,subject:'UC Merced',answer:`Verified detail ${index+1} [1].`}));
 const retained={...finding,answer:finding.answer.replace('[1]','[R1]'),qualification:finding.qualification.replace('[1]','[R1]')};
 const input={comparisonAddition:true,institution:'UC Merced',reusedEvidence:[{findings:[retained],sources:[{ref:'R1',...result.sources[0]}]}]};
 const merged=mergeComparisonAddition(fresh,input);
 assert.ok(merged);assert.equal(merged.voiceBrief.findings.length,8);assert.equal(merged.retainedFindingCount,0);
 assert.ok(merged.voiceBrief.findings.every(f=>f.subject==='UC Merced'));
});

for(const language of ['en','es'])test(`${language}: same fall cohort and annual total with term breakdown remain reusable`,()=>{
 const previous=structuredClone(row);
 previous.input.question=language==='en'?'2026–27 undergraduate transfer tuition and mandatory fees for California residents at UC Berkeley':'Matrícula y cuotas 2026–27 de pregrado y transferencia para residentes de California en UC Berkeley';
 const f=previous.result.voiceBrief.findings[0];
 f.subject=language==='en'?'UC Berkeley — California-resident undergraduate transfer, fall 2026 cohort':'UC Berkeley — pregrado y transferencia, residentes de California, cohorte de otoño 2026';
 f.answer=language==='en'?'UC Berkeley 2026–27 annual tuition is $18,214; the semester breakdown is $9,107 [1].':'La matrícula anual de UC Berkeley 2026–27 es $18,214; por semestre son $9,107 [1].';
 const input={...previous.input,question:previous.input.question+(language==='en'?'. Separate tuition from total cost of attendance.':'. Separa la matrícula del costo total.')};
 const reuse=selectResearchReuse(input,[previous],{now});
 assert.equal(reuse.reusedEvidence[0].coverage,'verified');assert.deepEqual(reuse.lookupInstitutions,[]);
 assert.match(cachedResearchForCoverage(reuse).voiceBrief.findings[0].answer,/18,214/);
 const changed=structuredClone(previous);changed.result.voiceBrief.findings[0].subject=f.subject.replace('2026','2025');
 assert.deepEqual(selectResearchReuse(input,[changed],{now}),{});
 const terms=structuredClone(previous);terms.result.voiceBrief.findings[0].answer='UC Berkeley 2026–27 semester tuition is $9,107 [1].';terms.result.voiceBrief.findings[0].qualification='California-resident semester estimate before aid [1].';
 assert.equal(selectResearchReuse(input,[terms],{now}).reusedEvidence[0].coverage,'reference');
 assert.equal(selectResearchReuse({...input,question:input.question+' per semester'},[previous],{now}).reusedEvidence[0].coverage,'reference');
});

for(const language of ['en','es'])test(`${language}: a failed duplicate lookup keeps the canonical covered finding and its original check time`,()=>{
 const input={...query,...selectResearchReuse(query,[row],{now})};
 const failed={...structuredClone(result),voiceBrief:{status:'unverified',answer:'Could not confirm.',qualification:'Source unavailable.',nextStep:'',findings:[{subject:'UC Berkeley',aspect:'tuition_fees',status:'unverified',answer:language==='en'?'Could not verify 2026–27 tuition.':'No se pudo verificar la matrícula 2026–27.',qualification:language==='en'?'The page failed to open.':'No se pudo abrir la página.'}]}};
 failed.sources=[];
 const restored=retainVerifiedResearch(failed,input);
 assert.equal(restored.voiceBrief.findings[0].status,'verified');assert.equal(restored.voiceBrief.findings[0].answer,finding.answer);
 assert.equal(restored.voiceBrief.findings[0].qualification,finding.qualification);assert.equal(restored.sources[0].checkedAt,row.finished_at);
 assert.equal(restored.retainedFindingCount,1);
 for(const changed of [
  {...input,reusedEvidence:input.reusedEvidence.map(e=>({...e,coverage:'reference'}))},
  {...input,reusedEvidence:input.reusedEvidence.map(e=>({...e,findings:e.findings.map(f=>({...f,status:'partial'}))}))},
 ])assert.equal(retainVerifiedResearch(failed,changed),failed);
 for(const changes of [{aspect:'total_budget'},{answer:'2027–28 tuition could not be verified.'},{subject:'UC Berkeley — graduate tuition'},{qualification:'New official evidence contradicts the prior amount [1].'},{answer:'Amount applicability is uncertain.',qualification:'The population is unspecified.'}]){
  const other=structuredClone(failed);Object.assign(other.voiceBrief.findings[0],changes);
  assert.equal(retainVerifiedResearch(other,input),other);
 }
 const cited=structuredClone(failed);cited.sources=[{url:'https://registrar.berkeley.edu/current-fees',title:'New official table'}];
 cited.voiceBrief.findings[0].answer=language==='en'?'2026–27 tuition is now listed as $19,000; exact applicability is not confirmed [1].':'La matrícula 2026–27 ahora aparece como $19,000; no se confirma su aplicabilidad [1].';
 cited.voiceBrief.findings[0].qualification=language==='en'?'The new official page does not identify the population [1].':'La nueva página oficial no identifica la población [1].';
 assert.equal(retainVerifiedResearch(cited,input),cited);
});

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
 const request=reuseResearchRequest({input:'{}',instructions:''},reuse);assert.match(request.instructions,/check the newly requested option first/);
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
 assert.deepEqual(reuse.reusedEvidence[0].findings.map(f=>[f.aspect,f.status]),[['tuition_fees','partial'],['total_budget','verified']]);
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
