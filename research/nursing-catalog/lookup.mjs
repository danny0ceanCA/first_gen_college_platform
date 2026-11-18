import {costCampusName} from '../cost-catalog/campus.mjs';
import {projectNursingRecord,nursingClarification} from './projection.mjs';
import {nursingRequestNeedsResearch,matchesNursingCohort} from './scope.mjs';
const fold=s=>String(s??'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const institutionKey=s=>fold(costCampusName(s)||s).replace(/\b(?:university|college|of|the)\b/gu,'').replace(/\s+/gu,' ').trim();
const pathwayTokens=s=>new Set((fold(s).match(/\b(?:absn|bsn|adn|lvn|vn|rn|msn|dnp|phd|anesthesia|accelerated|traditional|vocational|bridge|completion)\b/gu)||[]));
export const isNursingCatalogRequest=input=>/\bNUR-\d{4}\b/iu.test(String(input.question||''))||/\b(?:nurs\w*|enfermer\w*|bsn|absn|adn|lvn|msn|dnp|rn)\b/u.test(fold((input.question||'')+' '+(input.institution||'')));
export function createNursingLookup({query,campuses,now=Date.now}){
 return async(input,{observe=()=>{}}={})=>{
  const question=String(input.question||''),q=fold(question),ids=[...new Set([...question.matchAll(/\bNUR-\d{4}\b/giu)].map(m=>m[0].toUpperCase()))],id=ids[0];
  if(input.forceRefresh||!['finance','loans'].includes(input.mode)||input.comparisonPlan||!isNursingCatalogRequest(input)||nursingRequestNeedsResearch(question))return null;
  if(ids.length>1){
   const references=(await query('SELECT * FROM nursing_catalog.production_budgets WHERE budget_id=ANY($1::text[]) ORDER BY budget_id',[ids.slice(0,8)])).rows;
   return nursingClarification(references,input.language,{multipleReferences:true,now:now()});
  }
  const requested=(input.lookupInstitutions?.length?input.lookupInstitutions:[input.institution]).filter(Boolean).map(institutionKey);
  let matches=campuses.filter(c=>requested.includes(institutionKey(c)));
  if(!matches.length)matches=campuses.filter(c=>(' '+q+' ').includes(' '+fold(c)+' ')||(' '+q+' ').includes(' '+institutionKey(c)+' '));
  const names=[...new Set(matches.map(institutionKey))];if(!id&&names.length!==1)return null;
  const params=[id||matches],where=id?'budget_id=$1':'campus=ANY($1::text[])';
  const rows=(await query('SELECT * FROM nursing_catalog.production_budgets WHERE '+where+' ORDER BY budget_id',params)).rows;
  if(!rows.length)return null;
  const conflict=()=>nursingClarification(rows,input.language,{scopeConflict:true,now:now()});
  if(id&&requested.length&&(new Set(requested).size!==1||!requested.includes(institutionKey(rows[0].campus))))return conflict();
  // IDs identify records, not permission to ignore a caller's new scope. Site
  // names come from the whole campus so a different site can be recognized.
  const locationRows=id&&rows.some(r=>r.payload.values['Institution / location note'])?
   (await query('SELECT * FROM nursing_catalog.production_budgets WHERE campus=ANY($1::text[]) ORDER BY budget_id',[[...new Set(rows.map(r=>r.campus))]])).rows:rows;
  let selected=rows;
  const years=[...new Set([...question.matchAll(/\b(20\d{2})[-–](?:20)?(\d{2})\b/gu)].map(m=>m[1]+'-'+m[2]))];
  if(years.length>1)return id?conflict():null;
  if(years.length)selected=selected.filter(r=>r.academic_year_key===years[0]);
  const singleYears=[...new Set([...question.normalize('NFKD').replace(/\p{M}/gu,'').matchAll(/\b(?:for|in|year|ano|en|para)\s+(20\d{2})(?![-–\d])/giu)].map(m=>m[1]))];
  if(singleYears.length)selected=selected.filter(r=>{
   const own=new Set([...String(r.academic_year_raw||'').matchAll(/20\d{2}/gu)].map(m=>m[0]));
   if(r.academic_year_key){own.add(r.academic_year_key.slice(0,4));own.add('20'+r.academic_year_key.slice(-2));}
   return singleYears.every(year=>own.has(year));
  });
  const target=pathwayTokens(question);
  if(target.size)selected=selected.filter(r=>{const own=pathwayTokens(r.program);return [...target].every(t=>own.has(t)||t==='accelerated'&&own.has('absn')||t==='absn'&&own.has('accelerated')&&own.has('bsn')||t==='lvn'&&own.has('vn')||t==='vocational'&&own.has('vn')||t==='bridge'&&own.has('lvn')&&own.has('rn'));});
  selected=selected.filter(r=>matchesNursingCohort(r,question));
  const locations=[...new Set(locationRows.flatMap(r=>String(r.payload.values['Institution / location note']||'').split(/[;()]/u).map(fold)).filter(s=>s&&!['california','not specified','not applicable','unknown'].includes(s)))];
  const namedLocations=locations.filter(location=>(' '+q+' ').includes(' '+location+' '));
  if(namedLocations.length)selected=selected.filter(r=>namedLocations.some(location=>(' '+fold(r.payload.values['Institution / location note'])+' ').includes(' '+location+' ')));
  const part=/\b(?:part time|parttime|tiempo parcial)\b/u.test(q),full=/\b(?:full time|fulltime|tiempo completo)\b/u.test(q);
  if(part!==full&&(part||full))selected=selected.filter(r=>new RegExp(part?'part time|parttime|tiempo parcial':'full time|fulltime|tiempo completo','u').test(fold(r.program+' '+r.enrollment)));
  const nonresident=/\b(?:nonresident|non resident|out of state|no residente)\b/u.test(q);
  const resident=!nonresident&&/\b(?:california resident|in state|residente de california)\b/u.test(q);
  if(nonresident)selected=selected.filter(r=>/nonresident|non resident|out of state|no residente/u.test(fold(r.residency)));
  if(resident)selected=selected.filter(r=>/california resident|resident tuition/u.test(fold(r.residency))&&!/nonresident|non resident/u.test(fold(r.residency)));
  const housing=/\b(?:with family|with parents|con padres|con familia)\b/u.test(q)?/family|parents|relatives|at home/:/\b(?:off campus|fuera del campus)\b/u.test(q)?/off campus/:/\b(?:on campus|en el campus)\b/u.test(q)?/on campus|residence hall/:null;
  if(housing)selected=selected.filter(r=>housing.test(fold(r.housing)));
  const period=/\b(?:entire program|whole program|programa completo)\b/u.test(q)?/program/:null;
  if(period)selected=selected.filter(r=>period.test(fold(r.budget_period)));
  if(!selected.length)return id?conflict():null;
  if(selected.length!==1){observe({outcome:'hit',reason:'nursing_scope_clarification'});return nursingClarification(selected,input.language,{now:now()});}
  const record=selected[0];
  const items=(await query('SELECT payload FROM nursing_catalog.production_items WHERE batch_id=$1 AND budget_id=$2 ORDER BY source_row',[record.batch_id,record.budget_id])).rows;
  const result=projectNursingRecord(record,items,input.language,question,{now:now()});
  if(result)observe({outcome:'hit',reason:'nursing_caveated_reference'});
  return result;
 };
}
