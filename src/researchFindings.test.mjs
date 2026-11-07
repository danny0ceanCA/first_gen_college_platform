import test from 'node:test';
import assert from 'node:assert/strict';
import {validatedResearchFindings,focusedResearchFindings,researchFocus,findingSubjectMentioned} from './researchFindings.mjs';
import {researchBriefSelection} from './researchBrief.mjs';
import {researchEvidence} from './voiceResearchProgress.mjs';
const finding={subject:'UC Berkeley',aspect:'tuition_fees',status:'verified',answer:'Published tuition is 18214 dollars for 2026–27 [2].',qualification:'For new undergraduates [2].'};
const sources=[{url:'https://example.edu/one'},{url:'https://example.edu/two'}];
test('finding citations are derived from evidence and survive a selected source subset',()=>{
 const result={text:'Report',sources,voiceBrief:{status:'partial',answer:finding.answer,qualification:finding.qualification,nextStep:'',findings:[{...finding,sourceIds:[99]}]}};
 const selected=researchBriefSelection(result);
 assert.deepEqual(selected.findings[0].sourceIds,[2]);assert.equal(selected.sources.length,1);
 assert.deepEqual(researchEvidence(selected,false).findings[0].sourceIds,[2]);
});
test('invalid, uncited factual, or oversized units do not become delivery evidence',()=>{
 for(const bad of [{...finding,answer:'Unsupported [99]'},{...finding,answer:'Uncited figure 18214',qualification:'Uncited scope'}, {...finding,aspect:'made_up'}, {...finding,qualification:'x'.repeat(701)}])assert.deepEqual(validatedResearchFindings({sources,voiceBrief:{findings:[bad]}}),[]);
});
test('a source-free result can report an explicitly unverified finding without asserting verification',()=>{
 const missing={subject:'UC Santa Cruz',aspect:'tuition_fees',status:'unverified',answer:'Could not verify current UCSC tuition.',qualification:'The official page could not be read.'};
 const result={text:'Full limitation',sources:[],voiceBrief:{status:'unverified',answer:missing.answer,qualification:missing.qualification,nextStep:'',findings:[missing]}};
 assert.equal(researchBriefSelection(result).verification,'unverified');assert.deepEqual(researchBriefSelection(result).findings[0].sourceIds,[]);
 assert.equal(researchBriefSelection({...result,voiceBrief:{...result.voiceBrief,status:'verified'}}).evidenceFormat,'full-report');
});
test('English/Spanish focus selects a campus and requested aspect without changing research state',()=>{
 const findings=[finding,{...finding,aspect:'total_budget'},{...finding,subject:'UC Santa Cruz',status:'unverified'}];
 for(const q of ['What about tuition at UCSC?','¿Y la matrícula de UC Santa Cruz?'])assert.deepEqual(focusedResearchFindings(findings,q),[findings[2]]);
 assert.equal(findingSubjectMentioned('UC Santa Cruz','UCSC'),true);
 assert.equal(findingSubjectMentioned('University of California, Santa Cruz','UCSC'),true);
 assert.deepEqual(researchFocus('Just tuition and fees, not a new search.'),['tuition_fees']);
 assert.deepEqual(focusedResearchFindings(findings,'What is the deadline?'),[]);
});

for(const subject of ['UC Berkeley California-resident undergraduate, off-campus apartment','UC Berkeley — 2026–27 entering transfers','UC Berkeley estudiantes de pregrado fuera del campus','University of California, Berkeley (undergraduate costs)'])test(`rich subject keeps campus identity: ${subject}`,()=>{
 for(const text of ['Berkeley’s off-campus budget is…','El presupuesto de Berkeley fuera del campus es…'])assert.equal(findingSubjectMentioned(subject,text),true);
 for(const text of ['UC Santa Cruz budget','University of California, Davis','Berkeleyville budget'])assert.equal(findingSubjectMentioned(subject,text),false);
});
test('campus name components are not mistaken for scenario suffixes',()=>{
 assert.equal(findingSubjectMentioned('University of California, Santa Cruz California-resident undergraduate','UCSC tuition'),true);
 assert.equal(findingSubjectMentioned('North Campus undergraduate','North Campus costs'),true);
 assert.equal(findingSubjectMentioned('North Campus undergraduate','South Campus costs'),false);
 assert.equal(findingSubjectMentioned('California State University, Long Beach undergraduate','Long Beach tuition'),true);
 assert.equal(findingSubjectMentioned('UC undergraduate','UC Berkeley tuition'),false,'a generic system label cannot identify a campus');
});
