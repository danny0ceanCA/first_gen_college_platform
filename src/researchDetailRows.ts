import {researchFactValue} from './researchRecord.mjs';
import type {ResearchFact} from './researchRecord.mjs';
import type {ComparisonCell} from './researchVisualState';
export type ResearchDetailRow={aspect:string;label?:string;cells:((ComparisonCell&{fact?:ResearchFact})|null)[]};
// Keep the typed public fact and all its conditions together. No parsing of
// paragraphs into dates, award maxima, or ordered instructions in the browser.
export function researchDetailRows(rows:ResearchDetailRow[],language:'en'|'es'):ResearchDetailRow[]{
 return rows.flatMap(row=>{
  if(!row.cells.some(cell=>cell?.evidence))return [row];
  const keys=[...new Set(row.cells.flatMap(cell=>cell?.evidence?[...cell.evidence.expectedFacts,...cell.evidence.facts.map(f=>f.key)]:[]))];
  return keys.map(key=>{
   const representative=row.cells.flatMap(cell=>cell?.evidence?.facts.filter(f=>f.key===key)||[])[0];
   const fallback:Record<string,[string,string]>={deadline:['Deadline','Fecha límite'],award:['Award amount','Monto de la beca'],eligibility:['Eligibility','Requisitos de elegibilidad']};
   const label=representative?.label||fallback[key]?.[language==='es'?1:0]||key.replaceAll('_',' ');
   return {aspect:row.aspect+':'+key,label:(representative?.kind==='step'&&representative.order?representative.order+'. ':'')+label,
    cells:row.cells.map(cell=>{
     const fact=cell?.evidence?.facts.find(f=>f.key===key);if(!cell||!fact||fact.status==='unverified')return null;
     return {...cell,fact,answer:researchFactValue(fact,language),qualification:[fact.qualification,cell.qualification].filter(Boolean).join(' '),
      sources:cell.sources.filter(source=>new RegExp('\\['+source.id+'\\]').test(fact.sourceCitation))};
    })};
  });
 });
}
