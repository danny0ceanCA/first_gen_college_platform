import test from 'node:test';
import assert from 'node:assert/strict';
import {projectNursingRecord,nursingClarification} from './projection.mjs';
import {researchBriefSelection} from '../../src/researchBrief.mjs';
import {researchContextPackets} from '../../src/liveResearchContext.mjs';

function liveFindings(result,language){
 const packets=researchContextPackets({result,language,question:'Nursing costs'},'test-nursing');
 const units=[],groups=new Map();
 for(const raw of packets){
  assert.ok(Buffer.byteLength(raw)<=480);
  const p=JSON.parse(raw);
  if(!p.group){units.push(p);continue;}
  const group=groups.get(p.group)||[];group.push(p);groups.set(p.group,group);
 }
 for(const group of groups.values()){
  assert.equal(group.length,group[0].total);
  units.push({unit:group[0].unit,...JSON.parse(group.map(p=>p.text).join(''))});
 }
 const brief=researchBriefSelection(result);
 assert.equal(brief.evidenceFormat,'brief-v1');assert.equal(brief.verification,'partial');
 assert.ok(Buffer.byteLength(brief.text)<=1400);
 const findings=units.filter(p=>p.unit==='finding');
 assert.equal(findings.length,1);assert.equal(findings[0].status,'partial');
 assert.deepEqual(findings[0].sourceIds,[1]);
 assert.match(findings[0].qualification,/pending|pendiente/i);
 return findings[0].answer+'\n'+findings[0].qualification;
}

function record(values={},decisions=[]){
 return {id:'NUR-0001',values:{College:'Example College','Program / degree':'Nursing','Academic year':'2026-27',
  'Budget period':'Program',Residency:'California resident',Housing:'Living excluded',Enrollment:'Full time',
  'Cost coverage':'Partial direct costs','Official source URL':'https://example.edu/nursing','Source checked':'2026-11-15',...values},
  normalized:{source_verified:false,automatic_production_permission:false,published_cents:99900,caveated_decisions:decisions}};
}
function item(values={},normalized={}){
 return {id:'NUR-0001-001',values:{'Original source label':'program_total','Amount period':'Program','Relationship to total':'Subtotal (do not add)',
  'Conditions / notes':'Keep source scope. '.repeat(45),...values},normalized:{source_url:'https://example.edu/nursing',
  value_representation:'Published range',published_lower_bound_cents:536900,published_upper_bound_cents:561900,
  caveated_handling:'Quote both endpoints; no midpoint or annualization.',caveated_decisions:[],...normalized}};
}

for(const language of ['en','es']){
 test(`${language}: long conflict warnings reach Live with both ranges and source validity`,()=>{
  const decision={reference:'NUR-0001-RANGE',required_caveat:'Published and calculated endpoints disagree. Campus parking is $48 per semester. Source cover names Spring 2027 but says valid through Spring 2026.',
   still_unresolved:'Which range and source validity date govern the entering cohort remains unconfirmed.',
   suggested_wording:'Published program range $5,369–$5,619. Separately calculated item range $5,321–$5,821 before campus parking. Do not combine these ranges.'};
  const r=record({'Academic year':'Spring2027 entering cohort','Budget period':'Three semesters'},[decision]);
  r.normalized.published_cents=null;
  const result=projectNursingRecord(r,[item()],language,'Nursing costs');
  const live=liveFindings(result,language);
  for(const phrase of [decision.required_caveat,decision.still_unresolved,decision.suggested_wording,'Three semesters'])assert.ok(live.includes(phrase),phrase);
  assert.match(live,/not.*confirmed|no.*confirmado/);
 });

 test(`${language}: an unpriced item remains unknown and student dependent in Live`,()=>{
  const decision={reference:'NUR-0001-001',required_caveat:'Expense depends on health clearance, existing coverage, providers or personal circumstances. Keep blank until a supported quote or student-specific input exists. A user-entered assumption is not school-published cost.',
   still_unresolved:'The source excludes living expenses; no complete cost of attendance is established.',
   suggested_wording:'Amount not established; not zero. Any known-cost subtotal excludes this amount.'};
  const r=record({},[decision]);
  const i=item({'Original source label':'Medical screening/immunization insurance-dependent','Relationship to total':'Included component'},
   {value_representation:'Unpriced or variable',caveated_handling:'Price depends on the student/provider. Do not substitute zero.',caveated_decisions:[decision]});
  const live=liveFindings(projectNursingRecord(r,[i],language,'Medical screening cost'),language);
  assert.match(live,/Unpriced or variable|no publicado o variable/);
  assert.ok(live.includes(decision.required_caveat));assert.ok(live.includes(decision.suggested_wording));
  assert.ok(!live.includes('$0'));assert.ok(!live.includes('$999'));
 });

 test(`${language}: long source history preserves the campus, duration and additional-fee warning`,()=>{
  const warning='October supplement omits those fees, so possible additional $166 must be confirmed, not treated as waived.';
  const r=record({'Institution / location note':'Bakersfield','Academic year':'Effective October 3, 2026',
   'Budget period':'Entire certificate; 48 instructional weeks excluding breaks',
   'Scope and exclusions':'Curriculum and historical source background. '.repeat(24)+warning});
  const result=projectNursingRecord(r,[],language,'Nursing costs');
  const live=liveFindings(result,language);
  for(const phrase of ['Bakersfield','October 3, 2026','48 instructional weeks',warning])assert.ok(live.includes(phrase),phrase);
  assert.ok(!live.includes('$999'));assert.ok(result.text.includes(r.values['Scope and exclusions']));
 });

 test(`${language}: scope clarification retains pending review in the actual finding`,()=>{
  const r=record(),row={payload:r,campus:r.values.College,program:'Nursing',source_url:r.values['Official source URL']};
  const live=liveFindings(nursingClarification([row,{...row,program:'ADN'}],language),language);
  assert.match(live,/scope|alcance/);assert.ok(!live.includes('$'));
 });
}
