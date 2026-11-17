import {costCampusName} from '../cost-catalog/campus.mjs';
import {projectNursingRecord,nursingClarification} from './projection.mjs';
const fold=s=>String(s??'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const institutionKey=s=>fold(costCampusName(s)||s).replace(/\b(?:university|college|of|the)\b/gu,'').replace(/\s+/gu,' ').trim();
const pathwayTokens=s=>new Set((fold(s).match(/\b(?:absn|bsn|adn|lvn|vn|rn|msn|dnp|phd|anesthesia|accelerated|traditional|vocational|bridge|completion)\b/gu)||[]));
export function createNursingLookup({query,campuses}){
 return async(input,{observe=()=>{}}={})=>{
  const question=String(input.question||''),q=fold(question),id=question.match(/\bNUR-\d{4}\b/iu)?.[0].toUpperCase();
  if(input.forceRefresh||!['finance','loans'].includes(input.mode)||input.comparisonPlan||(!id&&!/\b(?:nurs\w*|enfermer\w*|bsn|absn|adn|lvn|msn|dnp|rn)\b/u.test(fold(question+' '+input.institution))))return null;
  const requested=(input.lookupInstitutions?.length?input.lookupInstitutions:[input.institution]).filter(Boolean).map(institutionKey);
  let matches=campuses.filter(c=>requested.includes(institutionKey(c)));
  if(!matches.length)matches=campuses.filter(c=>(' '+q+' ').includes(' '+fold(c)+' ')||(' '+q+' ').includes(' '+institutionKey(c)+' '));
  const names=[...new Set(matches.map(institutionKey))];if(!id&&names.length!==1)return null;
  const params=[id||matches],where=id?'budget_id=$1':'campus=ANY($1::text[])';
  const rows=(await query('SELECT * FROM nursing_catalog.production_budgets WHERE '+where+' ORDER BY budget_id',params)).rows;
  if(!rows.length)return null;
  let selected=rows;
  if(!id){
   const years=[...new Set([...question.matchAll(/\b(20\d{2})[-–](?:20)?(\d{2})\b/gu)].map(m=>m[1]+'-'+m[2]))];
   if(years.length>1)return null;
   if(years.length)selected=selected.filter(r=>r.academic_year_key===years[0]);
   const target=pathwayTokens(question);
   if(target.size)selected=selected.filter(r=>{const own=pathwayTokens(r.program);return [...target].every(t=>own.has(t)||t==='accelerated'&&own.has('absn')||t==='absn'&&own.has('accelerated')&&own.has('bsn')||t==='lvn'&&own.has('vn')||t==='vocational'&&own.has('vn')||t==='bridge'&&own.has('lvn')&&own.has('rn'));});
   const nonresident=/\b(?:nonresident|non resident|out of state|no residente)\b/u.test(q);
   const resident=!nonresident&&/\b(?:california resident|in state|residente de california)\b/u.test(q);
   if(nonresident)selected=selected.filter(r=>/nonresident|non resident|out of state|no residente/u.test(fold(r.residency)));
   if(resident)selected=selected.filter(r=>/california resident|resident tuition/u.test(fold(r.residency))&&!/nonresident|non resident/u.test(fold(r.residency)));
   const housing=/\b(?:with family|with parents|con padres|con familia)\b/u.test(q)?/family|parents|relatives|at home/:/\b(?:off campus|fuera del campus)\b/u.test(q)?/off campus/:/\b(?:on campus|en el campus)\b/u.test(q)?/on campus|residence hall/:null;
   if(housing)selected=selected.filter(r=>housing.test(fold(r.housing)));
   const period=/\b(?:entire program|whole program|programa completo)\b/u.test(q)?/program/:/\b(?:first year|year 1|primer ano)\b/u.test(q)?/year 1|year1|first year/:/\b(?:second year|year 2|segundo ano)\b/u.test(q)?/year 2|year2|second year/:null;
   if(period)selected=selected.filter(r=>period.test(fold(r.budget_period)));
  }
  if(!selected.length)return null;
  if(selected.length!==1){observe({outcome:'hit',reason:'nursing_scope_clarification'});return nursingClarification(selected,input.language);}
  const record=selected[0];
  const items=(await query('SELECT payload FROM nursing_catalog.production_items WHERE batch_id=$1 AND budget_id=$2 ORDER BY source_row',[record.batch_id,record.budget_id])).rows;
  const result=projectNursingRecord(record,items,input.language,question);
  if(result)observe({outcome:'hit',reason:'nursing_caveated_reference'});
  return result;
 };
}
