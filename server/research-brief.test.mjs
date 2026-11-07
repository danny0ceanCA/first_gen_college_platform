import test from 'node:test';
import assert from 'node:assert/strict';
import {researchBriefRequest,parseResearchBrief} from './research-brief.mjs';
import {parseFinanceResearch} from './finance-research.mjs';
import {researchBriefSelection} from '../src/researchBrief.mjs';
import {researchContextPackets} from '../src/liveResearchContext.mjs';
import {researchEvidence} from '../src/voiceResearchProgress.mjs';

const sources=[{url:'https://example.edu/costs',title:'Published costs'},{url:'https://example.edu/fees',title:'Fees'},{url:'https://example.edu/policies',title:'Policy'}];

for(const language of ['en','es'])for(const comparison of [false,true])test(`${language}${comparison?' with another campus':''}: the selected tuition finding carries the source discrepancy without the unrelated budget failure`,()=>{
 const es=language==='es';
 const tuition={subject:'UC Irvine — new California-resident undergraduate transfer, fall 2026 cohort',aspect:'tuition_fees',status:'verified',
  answer:es?'La matrícula y cuotas anuales de UC Irvine para 2026–27 son $18,214 [1].':'UC Irvine 2026–27 annual tuition and mandatory fees are $18,214 [1].',
  qualification:es?'Antes de ayuda; excluye seguro, documentos y cargos opcionales [1].':'Before aid; excludes insurance, document and optional charges [1].'};
 const budget={subject:'UC Irvine',aspect:'total_budget',status:'unverified',answer:'Total budget could not be verified.',qualification:'The aid budget page was inaccessible.'};
 const qualification=es?'Este subtotal calculado incluye cuotas obligatorias de eTech que el total mostrado por el Registro parece omitir. Los cargos pueden cambiar. El presupuesto total de UCI no se pudo verificar porque su página de ayuda financiera fue inaccesible. [1]':
  'This calculated subtotal includes required eTech fees, which the Registrar’s displayed total appears to omit. Charges may change. UCI’s total cost-of-attendance budget could not be verified because its financial-aid budget page was inaccessible. [1]';
 const other={subject:'UC Berkeley',aspect:'tuition_fees',status:'verified',answer:'UC Berkeley annual tuition is $18,000 in 2026–27 [2].',qualification:'California-resident published estimate before aid [2].'};
 const brief={status:'partial',answer:tuition.answer,qualification,nextStep:'',findings:[tuition,budget,...(comparison?[other]:[])]};
 const result=parseResearchBrief({text:JSON.stringify({brief,report:'Detailed report with figures [1].'}),sources:[{url:'https://reg.uci.edu/fees',title:'UCI registrar fees'},...(comparison?[{url:'https://registrar.berkeley.edu/fees',title:'Berkeley fees'}]:[])]});
 const selected=researchBriefSelection(result);
 assert.equal(selected.evidenceFormat,'brief-v1');assert.equal(selected.findings.length,comparison?3:2);
 const final=selected.findings[0];assert.match(final.qualification,/eTech/);assert.match(final.qualification,/omit/);assert.doesNotMatch(final.qualification,/inaccesible|inaccessible/);
 assert.ok(final.qualification.length<=700);assert.deepEqual(final.sourceIds,[1]);
 if(comparison)assert.equal(selected.findings[2].qualification,other.qualification);
 const evidence=researchEvidence(result,false),packets=researchContextPackets({question:es?'Matrícula y cuotas de UCI':'UCI tuition and fees',result:evidence},'scope-test');
 assert.match(packets.map(packet=>JSON.parse(packet).text).join(''),/eTech/);
});

test('a campus-qualified caveat is not copied into another campus finding',()=>{
 const findings=['UC Irvine','UC Berkeley'].map((subject,index)=>({subject,aspect:'tuition_fees',status:'verified',answer:`${subject} annual tuition is $18000 for 2026–27 [${index+1}].`,qualification:`Before aid [${index+1}].`}));
 const result=parseResearchBrief({text:JSON.stringify({brief:{status:'partial',answer:findings[0].answer,qualification:'UCI required eTech fees appear omitted from the displayed total [1].',nextStep:'',findings},report:'Qualified comparison [1] [2].'}),sources});
 assert.match(result.voiceBrief.findings[0].qualification,/eTech/);assert.doesNotMatch(result.voiceBrief.findings[1].qualification,/eTech/);
});

for(const language of ['en','es'])test(`${language}: distinct campus caveats stay with their local citations`,()=>{
 const findings=['UC Irvine','UC Riverside'].map((subject,index)=>({subject,aspect:'tuition_fees',status:'verified',answer:`${subject} annual tuition is $18000 for 2026–27 [${index+1}].`,qualification:`Before aid [${index+1}].`}));
 const qualification=language==='en'?'UC Irvine tuition excludes mandatory health insurance. [1] UC Riverside tuition includes mandatory health insurance [2].':'La matrícula de UC Irvine excluye el seguro médico obligatorio. [1] La matrícula de UC Riverside incluye el seguro médico obligatorio [2].';
 const result=parseResearchBrief({text:JSON.stringify({brief:{status:'verified',answer:findings[0].answer,qualification,nextStep:'',findings},report:'Complete comparison [1] [2].'}),sources});
 const selected=researchBriefSelection(result);assert.equal(selected.findings.length,2);
 assert.match(selected.findings[0].qualification,/exclud|excluy/);assert.doesNotMatch(selected.findings[0].qualification,/Riverside/);assert.deepEqual(selected.findings[0].sourceIds,[1]);
 assert.match(selected.findings[1].qualification,/includ|incluy/);assert.doesNotMatch(selected.findings[1].qualification,/Irvine/);assert.deepEqual(selected.findings[1].sourceIds,[2]);
});

test('an ambiguous shared caveat is not attributed to either campus',()=>{
 const findings=['UC Irvine','UC Riverside'].map(subject=>({subject,aspect:'tuition_fees',status:'verified',answer:`${subject} annual tuition is $18000 [1].`,qualification:'Before aid [1].'}));
 const result=parseResearchBrief({text:JSON.stringify({brief:{status:'partial',answer:findings[0].answer,qualification:'Some displayed totals omit required fees [1].',nextStep:'',findings},report:'Complete comparison [1].'}),sources});
 assert.deepEqual(result.voiceBrief.findings.map(f=>f.qualification),findings.map(f=>f.qualification));
 const shared=parseResearchBrief({text:JSON.stringify({brief:{status:'partial',answer:findings[0].answer,qualification:'The displayed total omits required eTech fees. UC Irvine has a missing budget [1].',nextStep:'',findings},report:'Complete comparison [1].'}),sources});
 assert.ok(shared.voiceBrief.findings.every(f=>!f.qualification.includes('eTech')));
});

test('same-campus findings do not inherit caveats linked only to the other source',()=>{
 const findings=[1,2].map(id=>({subject:'UC Irvine',aspect:'tuition_fees',status:'verified',answer:`UC Irvine tuition for population ${id} is $18000 [${id}].`,qualification:`Before aid [${id}].`}));
 const result=parseResearchBrief({text:JSON.stringify({brief:{status:'partial',answer:findings[0].answer,qualification:'UC Irvine tuition includes an additional required charge for this population [2].',nextStep:'',findings},report:'Complete report [1] [2].'}),sources});
 assert.equal(result.voiceBrief.findings[0].qualification,findings[0].qualification);
 assert.match(result.voiceBrief.findings[1].qualification,/additional required charge/);
});

test('an unnamed page failure for a missing campus is not attached to the known campus',()=>{
 const findings=[{subject:'UC Irvine',aspect:'tuition_fees',status:'verified',answer:'UC Irvine annual tuition is $18000 [1].',qualification:'Before aid [1].'},
  {subject:'UC Riverside',aspect:'tuition_fees',status:'unverified',answer:'Riverside tuition could not be verified.',qualification:'The page failed.'}];
 const result=parseResearchBrief({text:JSON.stringify({brief:{status:'partial',answer:findings[1].answer,qualification:'The official page failed to open. UC Irvine tuition is still established [1].',nextStep:'',findings},report:'Complete report [1].'}),sources});
 assert.doesNotMatch(result.voiceBrief.findings[0].qualification,/failed to open/);
});
for(const language of ['en','es'])test(`${language}: a concise brief preserves scope and uncertainty with fewer packets`,()=>{
 const brief=language==='en'?{status:'partial',answer:'The published 2026–27 undergraduate budget is an annual estimate before aid [1].',qualification:'This does not establish your bill or aid award; the next-year fee is unverified [3].',nextStep:'Confirm the entry term with the aid office.'}:{status:'partial',answer:'El presupuesto publicado de 2026–27 es una estimación anual de pregrado antes de la ayuda [1].',qualification:'No establece tu factura ni tu ayuda; la cuota del próximo año no está verificada [3].',nextStep:'Confirma el periodo de ingreso con la oficina de ayuda.'};
 const result={text:'Supporting detail with necessary context. '.repeat(120),sources,voiceBrief:brief,checkedAt:'2026-11-05'};
 const legacy=researchContextPackets({question:'Published costs',result:{...result,voiceBrief:undefined}},'job');
 const compact=researchContextPackets({question:'Published costs',result:researchEvidence(result,false)},'job');
 const payload=JSON.parse(compact.map(p=>JSON.parse(p).text).join(''));
 assert.ok(compact.length<legacy.length/2);assert.equal(payload.verification,'partial');assert.match(payload.text,/unverified|no está verificada/);assert.equal(payload.evidenceFormat,'brief-v1');assert.ok(!payload.text.includes('Supporting detail'));
 assert.deepEqual(payload.sources.map(source=>source.id),[1,3]);assert.equal(payload.sources[1].url,sources[2].url);
 assert.ok(result.text.length>4000);assert.ok(compact.every(p=>Buffer.byteLength(p)<=480));
 assert.equal(researchEvidence(result,true).status,'reused_verified_result');
});
test('oversized, uncited, partial and invalid-reference briefs retain the entire report',()=>{
 const base={text:'Report with all qualifications.',sources};
 for(const voiceBrief of [
  {status:'partial',answer:'x'.repeat(1500)+' [1]',qualification:'Unknown.',nextStep:''},
  {status:'partial',answer:'Uncited.',qualification:'Unknown.',nextStep:''},
  {status:'partial',answer:'A figure [99].',qualification:'Unknown.',nextStep:''},
  {status:'verified',answer:'An estimate [1].',nextStep:''},
 ]){const selected=researchBriefSelection({...base,voiceBrief});assert.equal(selected.text,base.text);assert.equal(selected.evidenceFormat,'full-report');}
});
test('one existing research request produces brief and report without another model pass',()=>{
 const base={model:'gpt-6.1-sol',store:false,max_tool_calls:2,tools:[{type:'web_search'}],instructions:'Official sources only.',input:'public question'};
 const body=researchBriefRequest(base);assert.equal(body.model,base.model);assert.equal(body.tools,base.tools);assert.equal(body.max_tool_calls,2);assert.equal(body.store,false);assert.equal(body.text.format.type,'json_schema');assert.equal(body.text.format.strict,true);assert.match(body.instructions,/Preserve unknowns, exceptions and source conflicts/);
 assert.deepEqual(body.text.format.schema.properties.brief.required,['status','answer','qualification','nextStep','findings']);
});
test('native citations survive structured output parsing and remain source linked',()=>{
 const text=JSON.stringify({brief:{status:'partial',answer:'Annual published budget CITE',qualification:'Personal aid is unknown CITE',nextStep:'Ask the office.'},report:'Detailed report CITE'});
 const annotations=[...text.matchAll(/CITE/g)].map(match=>({type:'url_citation',url:sources[0].url,title:sources[0].title,start_index:match.index,end_index:match.index+4}));
 const data={output:[{type:'web_search_call',status:'completed'},{type:'message',content:[{type:'output_text',text,annotations}]}]};
 const result=parseResearchBrief(parseFinanceResearch(data,'Test university'));
 assert.equal(result.voiceBrief.status,'partial');assert.equal(result.text,'Detailed report [1]');assert.equal(result.sources.length,1);assert.match(researchEvidence(result,false).text,/Personal aid is unknown/);
 assert.equal(parseResearchBrief(parseFinanceResearch({...data,status:'incomplete'},'Test')),null);
 const bad=structuredClone(data);bad.output[1].content[0].annotations[0].url='https://unofficial.example/costs';assert.equal(parseFinanceResearch(bad,'Test'),null);
});
test('broken structured output is not spoken as JSON and legacy reports still load',()=>{
 assert.equal(parseResearchBrief({text:'{"brief":',sources}),null);
 assert.equal(parseResearchBrief({text:'{"brief":{},"report":""}',sources}),null);
 assert.equal(parseResearchBrief({text:'Legacy report.',sources}).text,'Legacy report.');
 assert.equal(parseResearchBrief({text:'[1] A legacy cited report.',sources}).text,'[1] A legacy cited report.');
 const fallback=parseResearchBrief({text:JSON.stringify({brief:{answer:'Missing qualification'},report:'Full condition.'}),sources});assert.equal(fallback.voiceBrief,undefined);assert.equal(fallback.text,'Full condition.');
});
