import test from 'node:test';
import assert from 'node:assert/strict';
import {researchSourceAllowed,researchSourcePolicy,isolateResearchSources} from './research-source-policy.mjs';
import {admissionsResearchRequest,parseAdmissionsResearch} from './admissions-research.mjs';
import {financeResearchRequest,parseFinanceResearch} from './finance-research.mjs';
import {parseResearchBrief} from './research-brief.mjs';

test('authority policy accepts responsible public sources without trusting arbitrary URLs or lookalike hosts',()=>{
 for(const url of ['https://support.eastview.edu/hours','https://www.csac.ca.gov/grants','https://www.apprenticeship.gov/','https://resource.assist.org/agreement'])assert.equal(researchSourceAllowed(url),true,url);
 for(const url of ['http://eastview.edu/policy','https://eastview.edu.evil.example/policy','https://evil.example/?site=eastview.edu','https://someone@eastview.edu/policy','https://eastview.edu:8443/policy','https://scholarship-blog.example/rules'])assert.equal(researchSourceAllowed(url),false,url);
 assert.equal(researchSourceAllowed('https://csac.ca.gov/grants',{federalOnly:true}),false);
 assert.equal(researchSourceAllowed('https://studentaid.gov/pell',{federalOnly:true}),true);
});
for(const language of ['en','es'])test(`${language}: public support, career, scholarship and program research choose the responsible authority`,()=>{
 for(const question of language==='es'?['Horario de asesoría de Eastview College','Reglas de becas estatales','Duración del programa de enfermería','Requisitos de aprendizaje laboral']:['Eastview College advising office hours','State scholarship rules','Nursing program duration','Apprenticeship requirements']){
  const body=admissionsResearchRequest({},{question,institution:'Eastview College',language,mode:'planning'});
  assert.match(body.instructions,/Responsible source and narrow research/);
  assert.doesNotMatch(body.instructions,/Research official college application instructions\./);
  assert.equal(body.tools[0].filters,undefined,'unknown responsible authority is discovered, not guessed');
  assert.equal(body.store,false);
 }
 const federal=financeResearchRequest({},{question:language==='es'?'Requisitos federales de FAFSA':'Federal FAFSA requirements',institution:'',language});
 assert.deepEqual(federal.tools[0].filters.allowed_domains,['studentaid.gov']);
 const state=researchSourcePolicy({question:language==='es'?'Requisitos de becas estatales Cal Grant':'State Cal Grant scholarship requirements',institution:'',mode:'finance'});
 assert.equal(state.federalOnly,false,'state aid is not forced into a federal-only search');
});

for(const language of ['en','es'])test(`${language}: an ineligible citation withholds its own finding without deleting independent verified facts`,()=>{
 const findings=[{subject:'Eastview College',aspect:'deadline',status:'verified',answer:'Deadline: January 15, 2027 [1].',qualification:'First-year applicants only [1].',budget:null,evidence:null},
  {subject:'Pine Valley College',aspect:'deadline',status:'verified',answer:'Unsupported deadline: February 10, 2027 [2].',qualification:'Unsupported caveat [2].',budget:null,evidence:null}];
 const original={text:JSON.stringify({brief:{status:'verified',answer:findings[1].answer,qualification:findings[1].qualification,nextStep:'Repeat unsupported details',findings},report:'Unsupported deadline: February 10, 2027 [2].'}),sources:[{url:'https://eastview.edu/admissions'},{url:'https://college-blog.example/deadlines'}]};
 const isolated=isolateResearchSources(original,{language}),parsed=parseResearchBrief(isolated,language);
 assert.equal(isolated.sourceValidation.retainedFindings,1);assert.equal(isolated.sourceValidation.withheldFindings,1);
 assert.equal(parsed.sources.length,1);assert.equal(parsed.voiceBrief.findings[0].status,'verified');assert.match(parsed.voiceBrief.findings[0].answer,/January 15/);
 assert.equal(parsed.voiceBrief.findings[1].status,'unverified');assert.equal(parsed.voiceBrief.status,'partial');assert.doesNotMatch(parsed.text,/February 10|Unsupported caveat/);
 assert.equal(parsed.voiceBrief.nextStep,'');
 const mixed=structuredClone(original),payload=JSON.parse(mixed.text);payload.brief.findings[0].answer+=' also [2]';mixed.text=JSON.stringify(payload);
 assert.equal(isolateResearchSources(mixed),null,'mixed-source claim is not sanitized into false certainty');
});
test('provider status remains separate from completed hosted search',()=>{
 const output=[{type:'web_search_call',status:'completed'},{type:'message',content:[{type:'output_text',text:'Evidence.',annotations:[{type:'url_citation',url:'https://eastview.edu/policy',start_index:0,end_index:8}]}]}];
 for(const status of ['failed','incomplete','in_progress','cancelled']){
  assert.equal(parseAdmissionsResearch({status,output},'Eastview'),null);
  assert.equal(parseFinanceResearch({status,output},'Eastview'),null);
 }
});
