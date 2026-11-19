import test from 'node:test';
import assert from 'node:assert/strict';
import {projectNursingRecord} from './projection.mjs';
import {createNursingLookup} from './lookup.mjs';
import {readExport} from './postgres.mjs';
import {researchBriefSelection} from '../../src/researchBrief.mjs';
import {researchContextPackets} from '../../src/liveResearchContext.mjs';
function row(period='12 months'){
 const values={College:'Example College','Program / degree':'Nursing','Academic year':'2026-27','Budget period':period,'Official source URL':'https://example.edu/nursing','Source checked':'2026-11-15'};
 return {budget_id:'NUR-0001',campus:values.College,budget_period:period,source_url:values['Official source URL'],payload:{id:'NUR-0001',values,normalized:{source_verified:false,automatic_production_permission:false,published_cents:10080800,caveated_decisions:[]}}};
}
function item(label,amount,period='Scenario period'){
 return {id:'NUR-0001-001',values:{'Original source label':label,Category:label,'Amount period':period,'Relationship to total':'Included component'},normalized:{value_representation:'Recorded scalar amount',source_scalar_cents:amount,caveated_decisions:[],source_url:'https://example.edu/nursing'}};
}
const annual=row(),monthly=row('Monthly allowance'),books=item('Books and Supplies',215000),tuition=item('Tuition and Fees',5424800),housing=item('Food and housing',252800),exam=item('Elsevier exams/LMS',200000);
const noQuote=result=>{assert.ok(!researchBriefSelection(result).text.includes('$'));assert.match(result.voiceBrief.qualification,/pending|pendiente/i);};
for(const language of ['en','es']){
 for(const question of ['Monthly nursing budget','Presupuesto mensual de enfermeria','Nursing budget for 9 months','Nursing cost per semester'])test(`${language}: an annual figure cannot answer ${question}`,()=>noQuote(projectNursingRecord(annual,[],language,question)));
 test(`${language}: annual housing cannot quote a monthly allowance`,()=>noQuote(projectNursingRecord(monthly,[housing],language,'Annual housing cost for nursing')));
 test(`${language}: a matching monthly housing amount retains its source period`,()=>{
  const result=projectNursingRecord(monthly,[housing],language,'Monthly housing cost for nursing');
  assert.match(result.voiceBrief.answer,/2,528/);assert.ok(result.voiceBrief.qualification.includes('Monthly allowance'));
 });
 test(`${language}: a matching 12-month budget remains available`,()=>{
  assert.match(projectNursingRecord(annual,[],language,'Nursing budget for 12 months').voiceBrief.answer,/100,808/);
 });
 test(`${language}: an item rate can differ from its parent budget period`,()=>{
  const result=projectNursingRecord(row('Entire program'),[item('Tuition',4600,'Per unit')],language,'Nursing tuition per unit');
  assert.match(result.voiceBrief.answer,/\$46/);assert.ok(result.voiceBrief.answer.includes('Per unit'));
 });
 test(`${language}: a semester-unit rate is a unit rate, not a whole-semester charge`,()=>{
  const result=projectNursingRecord(row('Entire program'),[item('Tuition',4600,'Per semester unit')],language,'Nursing tuition per semester unit');
  assert.match(result.voiceBrief.answer,/\$46/);
 });
 test(`${language}: an explicitly published semester figure still supports a semester question`,()=>{
  const result=projectNursingRecord(row('Semester'),[item('Tuition',200000,'Semester')],language,'Nursing tuition per semester');
  assert.match(result.voiceBrief.answer,/2,000/);
 });
 test(`${language}: a two-semester total cannot be treated as one semester`,()=>noQuote(projectNursingRecord(row('Two semesters'),[],language,'Nursing cost per semester')));
 test(`${language}: per-term enrollment wording is not a request for a per-term price`,()=>{
  assert.match(projectNursingRecord(row('Academic year'),[],language,'Nursing budget for 3 units per semester').voiceBrief.answer,/100,808/);
 });
 test(`${language}: a program-year stage does not request an annualized price`,()=>{
  assert.match(projectNursingRecord(row('9 months'),[],language,'Nursing budget for program year 1').voiceBrief.answer,/100,808/);
 });
 for(const question of ['Total nursing budget excluding housing','Total nursing budget excluding estimated housing','Total nursing budget without books','Presupuesto total de enfermeria sin incluir los libros','Nursing tuition excluding fees','Nursing tuition without books and mandatory fees','Matricula de enfermeria sin cuotas'])test(`${language}: an exclusion cannot quote the unchanged budget or bundle: ${question}`,()=>{
  const result=projectNursingRecord(annual,[books,tuition],language,question);
  noQuote(result);assert.ok(result.text.includes('54,248'),'the complete source report retains the original figures');
 });
 test(`${language}: excluding a separate item preserves an unbundled tuition figure`,()=>{
  assert.match(projectNursingRecord(annual,[books,item('Tuition',4000000)],language,'Nursing tuition without books').voiceBrief.answer,/40,000/);
 });
 for(const name of ['NCLEX','TEAS','HESI','ATI','BLS','CPR'])test(`${language}: absent ${name} cannot quote the budget or another exam`,()=>{
  const result=projectNursingRecord(annual,[exam,tuition],language,`${name} exam cost for nursing`);
  noQuote(result);assert.match(result.voiceBrief.answer,/not found|no se encontr/i);
 });
 test(`${language}: a supported named exam still returns its original amount`,()=>{
  const result=projectNursingRecord(annual,[exam,item('NCLEX exam',20000)],language,'NCLEX exam cost for nursing');
  assert.match(result.voiceBrief.answer,/NCLEX exam: \$200/);assert.ok(!result.voiceBrief.answer.includes('2,000'));
 });
 test(`${language}: a missing named charge cannot be hidden by a supported tuition item`,()=>noQuote(projectNursingRecord(annual,[tuition],language,'Nursing tuition and NCLEX exam cost')));
 test(`${language}: an explicit item ID cannot bypass a conflicting named charge`,()=>{
  const listedBooks={...books,id:'NUR-0001-001'},listedExam={...item('NCLEX exam',20000),id:'NUR-0001-002'};
  noQuote(projectNursingRecord(annual,[listedBooks,listedExam],language,'NCLEX exam cost item NUR-0001-001'));
 });
}
test('published nursing prices retain period, composition and named-charge identity',{skip:!process.env.ORIGEN_NURSING_BATCH},async()=>{
 const batch=await readExport(process.env.ORIGEN_NURSING_BATCH),groups=new Map();
 for(const i of batch.items){const list=groups.get(i.budget_id)||[];list.push({payload:i});groups.set(i.budget_id,list);}
 const records=batch.budgets.map(r=>({batch_id:batch.id,budget_id:r.id,campus:r.values.College,program:r.values['Program / degree'],academic_year_raw:r.values['Academic year'],academic_year_key:r.normalized.academic_year,budget_period:r.values['Budget period'],residency:r.values.Residency,housing:r.values.Housing,enrollment:r.values.Enrollment,source_url:r.values['Official source URL'],payload:r}));
 const query=async(sql,p)=>({rows:sql.includes('production_items')?groups.get(p[1])||[]:typeof p[0]==='string'?records.filter(r=>r.budget_id===p[0]):records.filter(r=>p[0].includes(r.campus))});
 const lookup=createNursingLookup({query,campuses:[...new Set(records.map(r=>r.campus))]});
 for(const language of ['en','es']){
  for(const [institution,question] of [['UC Davis','Monthly nursing budget NUR-0001'],['Concorde Career College','Annual housing cost for nursing NUR-0784'],['UC Davis','Total nursing budget excluding housing NUR-0001'],['UC Davis','Nursing tuition excluding fees NUR-0001'],['UC Davis','NCLEX exam cost for nursing NUR-0001'],['Cal State Los Angeles','NCLEX exam cost for nursing NUR-0042']]){
   const result=await lookup({mode:'finance',institution,question,language});noQuote(result);
   const packets=researchContextPackets({question,language,result},'pricing-regression');
   assert.ok(packets.length&&packets.every(p=>Buffer.byteLength(p)<=480));
   assert.match(packets.join(' '),/pending|pendiente/i);assert.ok(!packets.join(' ').includes('$'));
  }
  const matching=await lookup({mode:'finance',institution:'Concorde Career College',question:'Monthly housing cost for nursing NUR-0784',language});
  assert.match(matching.voiceBrief.answer,/2,528/);
  const bls=await lookup({mode:'finance',institution:'Cal State Los Angeles',question:'BLS certification cost for nursing NUR-0042',language});
  assert.match(bls.voiceBrief.answer,/\$40–\$60/);
 }
});
