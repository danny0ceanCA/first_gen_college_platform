import pg from 'pg';
import {projectRecord,combineCatalogResults} from './catalog.mjs';
import {costHousingScenario} from '../../server/voice-housing-scope.mjs';
import {researchTaskEntities} from '../../src/researchTask.mjs';
import {requestedResearchAspects} from '../../src/researchQuestion.mjs';
import {mergeComparisonAddition,retainVerifiedResearch} from '../../server/research-reuse.mjs';
import {costCampusName} from './campus.mjs';
import {residentCategories,cohortYear,sourceHousing,campusHousingRequest} from './scope.mjs';
import {requestsCoa} from '../../server/coa-evidence.mjs';
const fold=s=>String(s||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[-–]/gu,' ');
const canonical=costCampusName;
export function assertLocalCatalogEnvironment(env){
 const url=new URL(env.RESEARCH_WORKER_DATABASE_URL||'http://invalid');
 if(env.NODE_ENV!=='development'||url.protocol!=='postgresql:'||url.hostname!=='127.0.0.1'||url.port!=='55480'||url.pathname!=='/origen_decisions_local_20261107')throw Error('isolated_local_catalog_worker_required');
}

// This adapter is loaded only by the explicitly enabled isolated launcher.
// Unknown personal scope remains unknown. A general entering-cohort benchmark
// is labelled as such; it is never claimed as a student's established cohort.
export function createLocalCostLookup({query,emit=()=>{},publication='local'}){
 if(!['local','production'].includes(publication))throw Error('invalid_catalog_publication');
 const view=publication==='production'?'production_published':'testing_published';
 return async (input,{observe=()=>{}}={})=>{
  const report=data=>{try{emit(data);observe(data);}catch{/* Logging never changes a lookup. */}};
  const defer=reason=>{report({outcome:'deferred',reason});return null;};
  const question=String(input.question||''),q=fold(question),language=input.language==='es'?'es':'en';
  if(!['finance','loans'].includes(input.mode)||input.forceRefresh||input.comparisonPlan||
   !/\b(?:cost of attendance|coa|costs?|tuition|fees|costo|costos|matricula|presupuesto)\b/u.test(q)||
   /\b(?:eligib\w*|awards?|beca|scholarship|grant|aid offer|financial aid|ayuda financiera|graduate|masters?|doctoral|posgrado|maestria|doctorado)\b/u.test(q))return defer('request_outside_catalog');
  const campuses=researchTaskEntities(input.visualComparisonCampus|| (input.lookupInstitutions?.length?input.lookupInstitutions:input.institution)).map(canonical);
  if(!campuses.length||campuses.some(c=>!c))return defer('campus_unmatched');
  const campusHousing=campusHousingRequest(question);
  const housing=campusHousing?.scenario||costHousingScenario(question)||(/\b(?:residence halls?|dorms?|residencias universitarias)\b/u.test(q)?'on_campus':undefined);
  const aspects=requestedResearchAspects(question);
  const feeOnly=!requestsCoa(question)&&aspects.length===1&&aspects[0]==='tuition_fees';
  // Missing personal scope is a labelled comparison, not a reason to search
  // the web for figures that already exist. Never assert a personal choice.
  const family=/\b(?:with (?:family|parents|relatives)|con (?:familia|familiares|padres))\b/u.test(q);
  const rental=/\b(?:rent\w*|rental|alquil\w*|apartamento)\b/u.test(q);
  const comparing=/\b(?:compare|comparison|versus|both|compar\w*|ambos|ambas|y si|what if)\b/u.test(q);
  const uncertain=!feeOnly&&(!housing||housing==='off_campus');
  const scenarios=feeOnly?[housing&&housing!=='off_campus'?housing:'renting']:comparing&&family&&rental?['renting','with_family']:uncertain?['renting','with_family']:[housing];
  if(campuses.length*scenarios.length>8)return defer('comparison_too_large');
  const cohort=/(?:cohort|first enrolled|first enroll|cohorte|primer ingreso)[^.;]{0,20}(20\d{2})[-–](?:20)?(\d{2})/iu.exec(question);
  const academicQuestion=cohort?question.replace(cohort[0],''):question;
  const years=[...academicQuestion.matchAll(/\b(20\d{2})[-–](?:20)?(\d{2})\b/gu)].map(m=>`${m[1]}-${m[2]}`);
  const year=[...new Set(years)];if(year.length>1)return defer('multiple_years');
  const residency=/\b(?:nonresident|non resident|out of state|no residente)\b/u.test(q)?'Nonresident':'California resident';
  const residencyKnown=/\b(?:california resident|resident of california|residente (?:de |en )?california|nonresident|non resident|out of state|no residente)\b/u.test(q);
  const conditions=['campus=ANY($1::text[])'],params=[[...new Set(campuses)]];
  params.push(residentCategories(residency));conditions.push(`payload->'raw'->>'Residency'=ANY($${params.length}::text[])`);
  conditions.push("payload->'raw'->>'Student level'='Undergraduate'","payload->'raw'->>'Program / degree'='General undergraduate'","coalesce(payload->'raw'->>'Dependent children','') IN ('','0')");
  if(year.length){params.push(year[0]);conditions.push(`academic_year=$${params.length}`);}
  const rows=(await query('SELECT * FROM coa_catalog.'+view+' WHERE '+conditions.join(' AND '),params)).rows;
  const selected=[];
  for(const campus of [...new Set(campuses)])for(const scenario of scenarios){
   let choices=rows.filter(r=>r.campus===campus&&r.payload.raw['Student level']==='Undergraduate'&&r.payload.raw['Program / degree']==='General undergraduate'&&residentCategories(residency).includes(r.payload.raw.Residency)&&
    !String(r.payload.raw['Dependent children']||'').trim()&&sourceHousing(r)===scenario);
   // A source's general 'off campus' figure may be useful as a benchmark for
   // rent only when it is expressly labelled; no replacement of personal facts.
   let housingBenchmark=false;
   if(!choices.length&&scenario==='renting'){
    choices=rows.filter(r=>r.campus===campus&&r.payload.raw['Student level']==='Undergraduate'&&r.payload.raw['Program / degree']==='General undergraduate'&&residentCategories(residency).includes(r.payload.raw.Residency)&&!String(r.payload.raw['Dependent children']||'').trim()&&r.payload.normalized.housing==='off_campus_unspecified');
    housingBenchmark=choices.length>0;
   }
   let commuterBenchmark=false;
   if(!choices.length&&scenario==='with_family'){choices=rows.filter(r=>r.campus===campus&&!String(r.payload.raw['Dependent children']||'').trim()&&sourceHousing(r)==='commuter_unspecified');commuterBenchmark=choices.length>0;}
   if(!year.length&&choices.length){const newest=choices.map(r=>r.academic_year).sort().at(-1);choices=choices.filter(r=>r.academic_year===newest);}
   if(cohort)choices=choices.filter(r=>cohortYear(r.payload.raw['Normalized cohort key'])===Number(cohort[1]));
   else if(choices.length){const years=choices.map(r=>cohortYear(r.payload.raw['Normalized cohort key']));if(years.every(y=>y!==null)){const newest=Math.max(...years);choices=choices.filter(r=>cohortYear(r.payload.raw['Normalized cohort key'])===newest);}}
   if(scenario==='on_campus')choices=choices.filter(r=>{
    const label=r.payload.raw.Housing;
    return campusHousing?.form==='studio'?/studio|estudio/iu.test(label):campusHousing?.form==='apartment'?
     /apartment|apartamento|departamento/iu.test(label)&&!/studio|estudio/iu.test(label):/residence hall|residencia/iu.test(label);
   });
   if(choices.length!==1)return defer(choices.length?'scope_ambiguous':'scenario_unavailable');
   const result=projectRecord(choices[0],language,{allowTesting:true});if(!result)return defer('projection_rejected');
   const es=language==='es',label=commuterBenchmark?(es?'Referencia de viajero/estudiante remoto':'Commuter/remote learner benchmark'):housingBenchmark?(es?'Referencia publicada fuera del campus':'Published off-campus benchmark'):scenario==='on_campus'&&campusHousing?.form==='apartment'?(es?'Apartamento en el campus':'On-campus apartment'):scenario==='on_campus'&&campusHousing?.form==='studio'?(es?'Apartamento estudio en el campus':'On-campus studio apartment'):{renting:['Renting off campus','Alquiler fuera del campus'],with_family:['Living with family','Vivir con familiares'],on_campus:['Residence halls','Residencias universitarias']}[scenario][es?1:0];
   const assumptions=[commuterBenchmark?(es?'No hay categoría confirmada para vivir con familiares; se muestra la referencia de viajero/remoto. Confirma si corresponde.':'No confirmed family category; showing the published commuter/remote benchmark. Confirm applicability.'):'',!cohort?(es?'Referencia de la cohorte de ingreso; cohorte personal sin confirmar.':'Entering-cohort benchmark; personal cohort unconfirmed.'):'',!residencyKnown?(es?'Se muestra la referencia para residentes de California; residencia personal sin confirmar.':'Showing the California-resident benchmark; personal residency unconfirmed.'):'',housingBenchmark?(es?'Referencia publicada fuera del campus; no confirma el alquiler personal.':'Published off-campus benchmark; personal rental applicability unconfirmed.'):'',uncertain?(es?'Escenario de referencia; la vivienda personal aún no está confirmada.':'Scenario benchmark; the personal housing arrangement is not confirmed.'):''].filter(Boolean).join(' ');
   result.voiceBrief.findings=result.voiceBrief.findings.map(f=>({...f,subject:campus+' — '+label}));
   if(assumptions){
    result.voiceBrief.findings=result.voiceBrief.findings.map(f=>({...f,qualification:f.qualification+' '+assumptions}));
    result.voiceBrief.qualification+=' '+assumptions;result.text+='\n'+assumptions;
   }
   if(!requestsCoa(question)&&aspects.length===1&&['tuition_fees','housing'].includes(aspects[0])){
    const original=result.voiceBrief.findings[0],component=original.budget.components.find(item=>item.key===aspects[0]&&item.role==='component');
    if(component?.amount==null)return null;
    const label=aspects[0]==='tuition_fees'?(es?'Matrícula y cuotas anuales':'Annual tuition and fees'):(es?'Vivienda para el año académico':'Academic-year housing');
    const answer=`${label}: USD $${component.amount.toLocaleString('en-US',{maximumFractionDigits:2})}; ${original.budget.year}; ${original.budget.population}. ${original.budget.sourceCitation}`;
    const qualification=[original.qualification,component.qualification].filter(Boolean).join(' ');
    result.voiceBrief.findings=[{...original,aspect:aspects[0],answer,qualification,budget:null}];
    result.voiceBrief.answer=answer;result.voiceBrief.qualification=qualification;
   }
   selected.push(result);
  }
  let result=combineCatalogResults(selected,language);if(!result?.voiceBrief)return null;
  if(uncertain){result.voiceBrief.nextStep=language==='es'?'¿Alquilaría o viviría con familiares?':'Would the student rent or live with family?';}
  result=input.comparisonAddition?mergeComparisonAddition(result,input):retainVerifiedResearch(result,input);
  report({outcome:'hit',reason:'matched',campuses:[...new Set(campuses)],findings:result.voiceBrief?.findings.length||0});
  return {...result,...(publication==='production'?{catalogPublication:'production'}:{catalogLocalTesting:true})};
 };
}

export async function createLocalCatalogProvider(env,emit){
 assertLocalCatalogEnvironment(env);
 const pool=new pg.Pool({host:'127.0.0.1',port:55480,database:'origen_coa_catalog_local',user:'origen_coa_catalog_test_reader',max:2,connectionTimeoutMillis:1000,statement_timeout:750,query_timeout:1000});
 try{
  const identity=(await pool.query('SELECT current_database() AS db,current_user AS role,inet_server_port() AS port')).rows[0];
  if(identity.db!=='origen_coa_catalog_local'||identity.role!=='origen_coa_catalog_test_reader'||identity.port!==55480)throw Error('local_catalog_reader_required');
 }catch(error){await pool.end();throw error;}
 return {lookup:createLocalCostLookup({query:pool.query.bind(pool),emit}),close:()=>pool.end()};
}
