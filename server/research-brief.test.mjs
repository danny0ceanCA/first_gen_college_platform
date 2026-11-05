import test from 'node:test';
import assert from 'node:assert/strict';
import {researchBriefRequest,parseResearchBrief} from './research-brief.mjs';
import {parseFinanceResearch} from './finance-research.mjs';
import {researchBriefSelection} from '../src/researchBrief.mjs';
import {researchContextPackets} from '../src/liveResearchContext.mjs';
import {researchEvidence} from '../src/voiceResearchProgress.mjs';

const sources=[{url:'https://example.edu/costs',title:'Published costs'},{url:'https://example.edu/fees',title:'Fees'},{url:'https://example.edu/policies',title:'Policy'}];
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
