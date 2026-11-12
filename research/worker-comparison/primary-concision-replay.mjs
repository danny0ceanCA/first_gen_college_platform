// Offline only. Rebuild the source packets; do not play old downstream speech
// as evidence that a changed prompt/packet would produce the same or faster audio.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {researchContextPackets} from '../../src/liveResearchContext.mjs';
import {decodedResearchContext} from '../../src/researchContext.fixture.mjs';
import {researchSpokenFinding} from '../../src/researchAnswerDelivery.mjs';
import {scenarios} from './scenarios.mjs';
import {campaignRoot} from './campaign.mjs';
const root=resolve('output/primary-concision-offline-20261111');await mkdir(root,{recursive:true});
// Same-input control: restore only the prior full-answer serialization in an
// in-memory copy of our own module. Recorded packet counts can include other
// findings/configurations and are not an apples-to-apples size comparison.
const contextUrl=pathToFileURL(resolve('src/liveResearchContext.mjs'));
const code=(await readFile(contextUrl,'utf8')).replace('answer:researchSpokenFinding(finding,{question,language}).answer','answer:finding.answer')
 .replace(/from '(\.\/[^']+)'/gu,(_,path)=>'from '+JSON.stringify(new URL(path,contextUrl).href));
const beforeRenderer=(await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))).researchContextPackets;
const rows=[];
for(const language of ['en','es']){
 const report=JSON.parse(await readFile(resolve(campaignRoot,'voice-r4-focus',`costs-${language}-on.json`),'utf8'));
 const recorded=report.appends.filter(e=>e.type==='session.thinking.append').map(e=>({at:e.at,packet:JSON.parse(e.content)}));
 const first=recorded.find(e=>e.packet.kind==='untrusted-research-evidence');
 const originalPackets=recorded.filter(e=>e.packet.resultId===first.packet.resultId).map(e=>e.packet);
 const original=decodedResearchContext(originalPackets);
 const source=JSON.parse(await readFile(resolve(campaignRoot,'research-current',`costs-primary-${language}.json`),'utf8'));
 const result=source.traces.at(-1).initial?.result||source.result;
 const question=report.jobs[0].query.question;
 const job={jobId:'offline-primary',question,language,evidenceVersion:1,researchPending:true,result};
 const options={focus:['total_budget'],priorityFindings:result.voiceBrief.findings.filter(f=>f.aspect==='total_budget')};
 const baselinePackets=beforeRenderer(job,'offline-reference',options),nextPackets=researchContextPackets(job,'offline-reference',options);
 const next=decodedResearchContext(nextPackets.map(JSON.parse)),before=original.findings.find(f=>f.aspect==='total_budget'),after=next.findings.find(f=>f.aspect==='total_budget');
 assert(before&&after);assert.equal(before.qualification,after.qualification,'all original finding qualifications retained');
 assert.ok(!/Published breakdown:|Desglose publicado:/u.test(after.answer));
 assert.ok(after.answer.includes('44,760'));assert.ok(nextPackets.every(p=>Buffer.byteLength(p)<=480));
 rows.push({language,question,recordedFirstSupplyAt:first.at,recordedPackets:originalPackets.length,newPackets:nextPackets.length,
  recordedBytes:originalPackets.reduce((n,p)=>n+Buffer.byteLength(JSON.stringify(p)),0),newBytes:nextPackets.reduce((n,p)=>n+Buffer.byteLength(p),0),
  sameInputBeforePackets:baselinePackets.length,sameInputBeforeBytes:baselinePackets.reduce((n,p)=>n+Buffer.byteLength(p),0),
  beforeAnswer:before.answer,afterAnswer:after.answer,qualification:after.qualification,
  evidenceBoundary:'Original recording is usable only before the first changed context. No counterfactual speech or latency score is claimed.'});
}
let records=0,unchangedNonBudget=0;
for(const s of scenarios)for(const language of ['en','es'])for(const role of ['primary','supplement']){
 const row=JSON.parse(await readFile(resolve(campaignRoot,'research-current',`${s.id}-${role}-${language}.json`),'utf8'));
 for(const finding of row.result.voiceBrief.findings){
  const before=JSON.stringify(finding),view=researchSpokenFinding(finding,{question:s[role][language],language});records++;
  assert.equal(JSON.stringify(finding),before,'original report/table data is immutable');
  assert.equal(view.qualification,finding.qualification);
  if(!finding.budget){assert.equal(view.answer,finding.answer);unchangedNonBudget++;}
 }
}
const output={scope:'Fictional isolated saved source records only; no network, production database or paid API calls',rows,records,unchangedNonBudget,
 limits:'This proves source projection, retention and transport bounds, not shorter spoken answers, naturalness, physical playback or a measured faster worker contribution.'};
await writeFile(resolve(root,'replay.json'),JSON.stringify(output,null,2));
console.log(JSON.stringify({rows:rows.map(({language,recordedPackets,newPackets,recordedBytes,newBytes,sameInputBeforePackets,sameInputBeforeBytes})=>({language,recordedPackets,newPackets,recordedBytes,newBytes,sameInputBeforePackets,sameInputBeforeBytes})),records,unchangedNonBudget},null,2));
