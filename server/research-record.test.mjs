import test from 'node:test';import assert from 'node:assert/strict';
import {validatedResearchRecord,researchRecordAudit,researchFactValue} from '../src/researchRecord.mjs';
import {researchBriefRequest,parseResearchBrief} from './research-brief.mjs';
import {selectResearchReuse,cachedResearchForCoverage,comparisonAddition,mergeComparisonAddition} from './research-reuse.mjs';
import {recordScopeMatches,selectedRecordFacts} from './research-record-reuse.mjs';
import {researchRecoveryPlan,researchRecoveryOutcome,mergeRecoveryResearch} from './research-recovery.mjs';
import {voiceVisualCards} from './voice-visual-cards.mjs';
import {researchDetailRows} from '../src/researchDetailRows.ts';import {researchCostRows} from '../src/researchCostRows.ts';
import {comparisonFindings,comparisonClue,comparisonLookup,selectComparisonFinding,comparisonResearchRequest,parseComparisonResearch} from './voice-comparison-update.mjs';
import {focusedResearchFindings} from '../src/researchFindings.mjs';
import {researchContextPackets} from '../src/liveResearchContext.mjs';
import {processResearchJob} from './voice-research-worker.mjs';
import {publicFact,publicRecord,recordFixture,recordCheckedAt as checkedAt,recordTestNow as now} from './research-record.fixtures.mjs';
function saved(result,mode='admissions'){return {status:'completed',finished_at:checkedAt,input:{mode,institution:'Eastview College',question:'Published policy'},result};}
function table(result,language){const events=[];const bridge=voiceVisualCards({emit:e=>events.push(e),now:()=>now});bridge.trackResearch('r','Published policy');bridge.receiveResearch({id:'r',query:{requestKey:'r',language},question:'Published policy',status:'completed',result});return events.at(-1).report;}
function providerResponse(payload,url='https://pinevalley.edu/policy'){
 const text=JSON.stringify(payload).replaceAll('[1]','CITE');
 return {status:'completed',output:[{type:'web_search_call',status:'completed',action:{type:'search',sources:[{url}]}},{type:'message',content:[{type:'output_text',text,annotations:[...text.matchAll(/CITE/gu)].map(m=>({type:'url_citation',url,start_index:m.index,end_index:m.index+4}))}]}]};
}
for(const language of ['en','es']){
 for(const topic of ['admissions','scholarships','financial_aid','housing','process','programs','student_support'])test(`${language}: ${topic} uses identical typed facts for voice, report and table`,()=>{
  const {record,result}=recordFixture(language,topic);assert.ok(validatedResearchRecord(record,new Set([1])));assert.equal(result.voiceBrief.status,'verified');assert.ok(!result.text.includes('999'));
  const report=table(result,language),rows=researchDetailRows(report.table.rows,language);assert.equal(rows.length,record.facts.length);assert.equal(researchCostRows(report.table.rows,1),null);
  for(const fact of record.facts){const row=rows.find(row=>row.aspect.endsWith(':'+fact.key));assert.equal(row.cells[0].answer,researchFactValue(fact,language));assert.ok(result.text.includes(researchFactValue(fact,language)));assert.ok(row.cells[0].qualification.includes(fact.qualification));}
  assert.ok(rows.every(row=>row.cells[0].sources[0].url.endsWith('.edu/policy')));
  const packets=researchContextPackets({result},'job');assert.ok(packets.every(p=>Buffer.byteLength(p)<=480));
 });
 test(`${language}: missing award deadline is partial while the verified award remains usable`,()=>{
  const r=publicRecord('scholarships',language);r.facts[1]={...r.facts[1],status:'unverified',date:null,time:null,timeZone:null,sourceCitation:'',qualification:''};
  const {result}=recordFixture(language,'scholarships','Eastview College',r);assert.equal(result.voiceBrief.status,'partial');assert.match(result.voiceBrief.findings[0].answer,language==='es'?/Hasta \$2,500 USD/:/Up to \$2,500 USD/);
  const plan=researchRecoveryPlan(result,{question:language==='es'?'Beca y fecha límite':'Scholarship award and deadline'});assert.equal(plan.reason,'incomplete_record');assert.deepEqual(plan.gaps[0].requiredFacts,['award','deadline']);assert.equal(researchRecoveryOutcome(result,plan),'partial');
  const rows=researchDetailRows(table(result,language).table.rows,language);assert.equal(rows[0].cells[0].answer,researchFactValue(r.facts[0],language));assert.equal(rows[1].cells[0],null);
 });
 test(`${language}: clear fact reuse preserves date, cutoff and caveat without a lookup`,()=>{
  const {result}=recordFixture(language),row=saved(result),input={mode:'admissions',language,institution:'Eastview College',question:language==='es'?'¿Cuál es la fecha límite de admisión?':'What is the admissions deadline?'};
  const reuse=selectResearchReuse(input,[row],{now});assert.deepEqual(reuse.lookupInstitutions,[]);const cached=cachedResearchForCoverage(reuse);assert.ok(cached);assert.equal(cached.voiceBrief.findings[0].evidence.facts[0].sourceCitation,'[1]');assert.equal(cached.sources[0].checkedAt,checkedAt);assert.match(cached.voiceBrief.answer,/23:59/);
  for(const change of [{question:'What is the deadline for 2028?'},{question:'What is the transfer deadline?'},{question:'What is the deadline for spring 2027?'},{question:'What is the nursing program deadline?'},{forceRefresh:true}])assert.equal(cachedResearchForCoverage(selectResearchReuse({...input,...change},[row],{now})),null);
  assert.equal(cachedResearchForCoverage(selectResearchReuse(input,[row],{now:now+300001})),null);
 });
 test(`${language}: adding a college checks only the new college and preserves existing record provenance`,()=>{
  const first=recordFixture(language),next=recordFixture(language,'admissions','Pine Valley College'),input={mode:'admissions',language,institution:'Pine Valley College',question:language==='es'?'¿Y Pine Valley College?':'What about Pine Valley College?'};
  const plan=comparisonAddition(input,saved(first.result),{now});assert.ok(plan);assert.deepEqual(plan.lookupInstitutions,['Pine Valley College']);assert.ok(!plan.question.includes('Eastview'));
  const merged=mergeComparisonAddition(next.result,{...input,...plan});assert.equal(merged.voiceBrief.findings.length,2);const old=merged.voiceBrief.findings.find(f=>f.subject==='Eastview College');assert.equal(old.evidence.facts[0].sourceCitation,'[2]');assert.equal(merged.sources[1].checkedAt,checkedAt);
  const rows=researchDetailRows(table(merged,language).table.rows,language);assert.equal(rows[0].cells.length,2);assert.ok(rows[0].cells.every(Boolean));
 });
 test(`${language}: compatible recovery fills only missing facts and retains a previously verified award`,()=>{
  const r=publicRecord('scholarships',language);r.facts[1]={...r.facts[1],status:'unverified',date:null,time:null,timeZone:null,sourceCitation:''};
  const first=recordFixture(language,'scholarships','Eastview College',r).result,complete=publicRecord('scholarships',language);complete.facts=complete.facts.slice(1);
  const next=recordFixture(language,'scholarships','Eastview College',complete).result,plan=researchRecoveryPlan(first,{question:'Scholarship amount and deadline'});
  const result=mergeRecoveryResearch(first,next,language,plan);assert.equal(result.voiceBrief.findings[0].evidence.facts.length,2);assert.equal(result.voiceBrief.findings[0].evidence.facts[0].amount,2500);assert.equal(result.voiceBrief.findings[0].status,'verified');assert.equal(researchRecoveryOutcome(result,plan),'recovered');
 });
 test(`${language}: worker stores complete non-budget evidence after one source check`,async()=>{
  const input={mode:'admissions',language,institution:'Pine Valley College',question:'Published fall 2027 first-year deadline'},writes=[];let claimed=false,calls=0;
  const db={async query(sql,args){if(sql.includes('RETURNING id,input')){if(claimed)return {rows:[]};claimed=true;return {rows:[{id:'record-job',input}]};}writes.push({sql,args});return {rows:[{status:'running'}],rowCount:1};}};
  await processResearchJob(db,{}, {now:()=>now,log:()=>{},request:async(url,options)=>{calls++;const body=JSON.parse(options.body);assert.ok(body.text.format.schema.properties.brief.properties.findings.items.required.includes('evidence'));return new Response(JSON.stringify(providerResponse(recordFixture(language,'admissions','Pine Valley College').payload)));}});
  assert.equal(calls,1);const result=writes.find(w=>w.sql.includes("status='completed'"))?.args[1];assert.ok(result);assert.equal(result.researchDiagnostics.recoveryStatus,'not_needed');assert.equal(result.voiceBrief.findings[0].evidence.scope.term,'fall');
 });
 test(`${language}: Decisions selects a changed deadline; only that entry is researched`,async()=>{
  const first=recordFixture(language),other=recordFixture(language,'admissions','Pine Valley College');
  const addition=comparisonAddition({mode:'admissions',language,institution:'Pine Valley College',question:'What about Pine Valley College?'},saved(first.result),{now});
  const result=mergeComparisonAddition(other.result,addition),entries=comparisonFindings(result,{now});assert.equal(entries.length,2);
  const text=language==='es'?'Cambia Pine Valley College a primavera de 2028.':'Change Pine Valley College to spring 2028.';
  const clue=comparisonClue(text,[],entries);assert.ok(clue);let calls=0;
  const client={evaluate:async()=>{calls++;return {response:{answers:[{type:'choice',name:'comparison_update',choice:clue.id,probabilities:[{value:clue.id,probability:.95}]}]}};}};
  assert.equal(await selectComparisonFinding(client,entries,clue),clue.id);assert.equal(calls,1);
  const plan={version:2,...comparisonLookup(entries,clue.id,language,{changeText:text,mode:'admissions'})},input={mode:'admissions',language,comparisonPlan:plan};
  const body=comparisonResearchRequest({model:'fixture',instructions:'Source rules'},input);assert.ok(!body.input.includes('Eastview'));assert.ok(body.text.format.schema.required.includes('evidence'));
  const evidence=publicRecord('admissions',language);evidence.scope.cycle='2028';evidence.scope.term='spring';evidence.scope.validThrough='2027-11-01';evidence.facts[0].date='2027-11-01';
  const data=providerResponse({subject:'Pine Valley College',aspect:'deadline',requestedChange:text,status:'verified',answer:'Old incorrect prose [1]',qualification:'Source conditions apply. [1]',budget:null,evidence});
  const changed=parseComparisonResearch(data,input,()=>now);assert.ok(changed);assert.equal(changed.voiceBrief.findings.find(f=>f.subject==='Eastview College').evidence.scope.term,'fall');assert.equal(changed.voiceBrief.findings[0].evidence.scope.term,'spring');assert.ok(!changed.voiceBrief.answer.includes('incorrect'));
 });
}
test('invalid dates, forged references, ranges, duplicates and unsafe links fail validation',()=>{
 for(const mutate of [r=>r.facts[0].date='2027-02-30',r=>r.facts[0].sourceCitation='[99]',r=>r.facts[0].time='25:00',r=>r.facts[0].timeZone='not-a-zone',r=>r.facts.push({...r.facts[0]}),r=>r.facts[0]={...publicFact(),kind:'link',value:'javascript:alert(1)',date:null,time:null,timeZone:null}]){const r=publicRecord();mutate(r);assert.equal(validatedResearchRecord(r,new Set([1])),null);}
 const r=publicRecord('scholarships');r.facts[0].bound='range';r.facts[0].upperAmount=100;assert.equal(validatedResearchRecord(r,new Set([1])),null);
 const fixture=recordFixture();fixture.payload.brief.findings[0].evidence.facts[0].sourceCitation='[99]';const result=parseResearchBrief({text:JSON.stringify(fixture.payload),sources:[fixture.source]});assert.equal(result.voiceBrief.status,'unverified');assert.ok(!result.text.includes('999'));
});
test('unknown cutoff zone and missing process step cannot claim complete recovery',()=>{
 const r=publicRecord();r.facts[0].timeZone=null;assert.equal(researchRecordAudit(r).complete,false);assert.ok(!researchFactValue(r.facts[0]).includes('23:59'));
 const steps=publicRecord('process');steps.facts=steps.facts.slice(1);assert.equal(researchRecordAudit(steps).incompleteSteps,true);
});
test('ambiguous deadline, expired cycle and changed program or modality cannot silently reuse',()=>{
 const r=publicRecord();r.facts.push({...r.facts[0],key:'priority_deadline',label:'Priority deadline'});assert.equal(selectedRecordFacts('When is it due?',r),null);
 const nowAfter=Date.parse('2027-02-01T00:00:00Z');assert.equal(recordScopeMatches('What is the deadline?',r,{now:nowAfter}),false);
 assert.equal(recordScopeMatches('What was the 2027 deadline?',r,{now:nowAfter}),true);
 r.scope.program='Nursing';assert.equal(recordScopeMatches('Engineering program deadline',r,{now}),false);
 r.scope.program=null;r.scope.delivery='in_person';assert.equal(recordScopeMatches('Online application steps',r,{now}),false);
});
test('source schema is strict, nullable and uses no additional model rewrite',()=>{
 const schema=researchBriefRequest({max_output_tokens:1800,input:'{}',instructions:'Rules'}).text.format.schema.properties.brief.properties.findings.items;
 assert.ok(schema.required.includes('budget')&&schema.required.includes('evidence'));assert.deepEqual(schema.properties.evidence.type,['object','null']);assert.equal(schema.properties.evidence.additionalProperties,false);
});
for(const language of ['en','es'])test(`${language}: a partial record reuses a verified award but not unrelated tuition or a new program`,()=>{
 const record=publicRecord('scholarships',language);record.facts[1]={...record.facts[1],status:'unverified',date:null,time:null,timeZone:null,sourceCitation:''};
 const {result}=recordFixture(language,'scholarships','Eastview College',record),row={status:'completed',finished_at:result.checkedAt,input:{mode:'finance',institution:'Eastview College',question:'Scholarship amount and deadline'},result};
 const input={mode:'finance',language,institution:'Eastview College',question:language==='es'?'¿Cuál es el monto de la beca?':'What is the scholarship amount?'};
 const cached=cachedResearchForCoverage(selectResearchReuse(input,[row],{now}));assert.ok(cached);assert.equal(cached.voiceBrief.findings[0].evidence.facts.length,1);assert.equal(cached.voiceBrief.status,'verified');assert.ok(!cached.voiceBrief.qualification.includes('still has unverified'));
 for(const question of ['How much is tuition?','What is the engineering deadline?','¿Cuánto es la matrícula?'])assert.equal(cachedResearchForCoverage(selectResearchReuse({...input,question},[row],{now})),null);
 assert.equal(focusedResearchFindings(result.voiceBrief.findings,'What is the deadline?',['deadline']).length,1);
});
test('a recovery for a different cycle or missing structured data never replaces the original record',()=>{
 const r=publicRecord('scholarships');r.facts[1]={...r.facts[1],status:'unverified',date:null,time:null,timeZone:null,sourceCitation:''};
 const first=recordFixture('en','scholarships','Eastview College',r).result,plan=researchRecoveryPlan(first,{question:'Scholarship amount and deadline'});
 const changed=publicRecord('scholarships');changed.scope.cycle='2028';const next=recordFixture('en','scholarships','Eastview College',changed).result;
 assert.equal(mergeRecoveryResearch(first,next,'en',plan),first);
 const prose=structuredClone(next);delete prose.voiceBrief.findings[0].evidence;assert.equal(mergeRecoveryResearch(first,prose,'en',plan),first);
});
test('missing expected fact remains a visible table row instead of disappearing',()=>{
 const r=publicRecord('scholarships');r.facts=r.facts.slice(0,1);
 const {result}=recordFixture('en','scholarships','Eastview College',r),finding=result.voiceBrief.findings[0];
 const rows=researchDetailRows([{aspect:'other',cells:[{...finding,scope:'Eastview College',sources:result.sources}]}],'en');assert.equal(rows.length,2);assert.equal(rows[1].label,'Deadline');assert.equal(rows[1].cells[0],null);
});
// General facts use the same preserved source-backed record, without a budget.
for(const language of ['en','es'])for(const topic of ['careers','enrollment','other'])test(`${language}: ${topic} uses the generic fact contract without a new scenario implementation`,()=>{
 const record=publicRecord('student_support',language);record.topic=topic;record.facts[0].key='published_detail';record.expectedFacts=['published_detail'];
 const {result}=recordFixture(language,topic,'Eastview College',record);assert.equal(result.voiceBrief.status,'verified');assert.equal(result.voiceBrief.findings[0].evidence.topic,topic);assert.equal(researchDetailRows(table(result,language).table.rows,language).length,1);
});
for(const language of ['en','es'])test(`${language}: an entirely unverified record still shows the requested fact as unknown`,()=>{
 const record=publicRecord('admissions',language);record.facts[0]={...record.facts[0],status:'unverified',date:null,time:null,timeZone:null,sourceCitation:''};
 const {result}=recordFixture(language,'admissions','Eastview College',record);result.voiceBrief.status='unverified';result.voiceBrief.findings[0].status='unverified';
 const rows=researchDetailRows(table(result,language).table.rows,language);assert.equal(rows.length,1);assert.equal(rows[0].cells[0],null);
});
for(const language of ['en','es'])test(`${language}: a large record supplies focused complete facts quietly without its full structured payload`,()=>{
 const record=publicRecord('scholarships',language);record.facts[1].qualification=(language==='es'?'Condición publicada que afecta este plazo. ':'Published condition affecting this deadline. ').repeat(6).trim();
 record.facts.push({...record.facts[1],key:'priority_deadline',label:language==='es'?'Fecha prioritaria':'Priority deadline'});record.expectedFacts.push('priority_deadline');
 const {result}=recordFixture(language,'scholarships','Eastview College',record);assert.ok(result.voiceBrief);assert.ok(result.voiceBrief.findings[0].answer.length<=700);
 const packets=researchContextPackets({result,query:{language}},'record',{focus:['deadline']}).map(p=>{assert.ok(Buffer.byteLength(p)<=480);return JSON.parse(p);});
 const parts=packets.filter(p=>p.unit==='finding'),unit=parts[0].text?JSON.parse(parts.map(p=>p.text).join('')):parts[0];
 assert.equal(unit.focusedFacts.length,2);assert.equal(unit.focusedFacts[0].value,researchFactValue(record.facts[1],language));assert.equal(unit.focusedFacts[0].qualification,record.facts[1].qualification);assert.ok(!('evidence' in unit));
});
for(const language of ['en','es'])test(`${language}: worker publishes the useful award before bounded deadline-only recovery`,async()=>{
 const record=publicRecord('scholarships',language);record.facts[1]={...record.facts[1],status:'unverified',date:null,time:null,timeZone:null,sourceCitation:''};
 const first=recordFixture(language,'scholarships','Pine Valley College',record),nextRecord=publicRecord('scholarships',language);nextRecord.facts=nextRecord.facts.slice(1);
 const next=recordFixture(language,'scholarships','Pine Valley College',nextRecord),input={mode:'finance',language,institution:'Pine Valley College',question:'Scholarship amount and application deadline'},writes=[];let claimed=false,calls=0;
 const db={async query(sql,args){if(sql.includes('RETURNING id,input')){if(claimed)return {rows:[]};claimed=true;return {rows:[{id:'record-recovery',input}]};}writes.push({sql,args});return {rows:[{status:'running'}],rowCount:1};}};
  await processResearchJob(db,{}, {now:()=>now,log:()=>{},request:async(url,options)=>{calls++;const request=JSON.parse(options.body);if(calls===2){const recovery=JSON.parse(request.input).recovery;assert.deepEqual(recovery.gaps[0].requiredFacts,['deadline']);assert.equal(recovery.gaps[0].knownEvidence.facts[0].amount,2500);assert.ok(writes.some(w=>w.args?.[1]?.researchPending===true));}return new Response(JSON.stringify(providerResponse(calls===1?first.payload:next.payload)));}});
 assert.equal(calls,2);const result=writes.find(w=>w.sql.includes("status='completed'"))?.args[1];assert.ok(result);assert.equal(result.researchDiagnostics.recoveryStatus,'recovered');assert.equal(result.voiceBrief.findings[0].evidence.facts.length,2);assert.equal(result.voiceBrief.findings[0].evidence.facts[0].amount,2500);
});
