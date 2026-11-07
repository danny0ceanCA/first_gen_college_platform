import {researchFocus} from './researchFindings.mjs';

// A boundary around an answer is not another requested lookup. Keep this
// separate from speech matching: a spoken qualification can mention many facets.
export function requestedResearchAspects(question){
 const text=String(question||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[-–—]/gu,' ');
 const budget='(?:(?:the|a|el|un)\\s+)?(?:total\\s+(?:cost(?:s)?(?:\\s+of\\s+attendance)?|budget)|cost\\s+of\\s+attendance|presupuesto\\s+total|costo\\s+(?:total|de\\s+asistencia))';
 const contrast=new RegExp('(?:separately\\s+from|separate\\s+from|distinct\\s+from|rather\\s+than|not\\s+including|excluding|separad[oa]s?\\s+(?:de|del)|aparte\\s+(?:de|del)|sin\\s+incluir|no\\s+incluyas)\\s+'+budget,'gu');
 const separate=new RegExp('((?:separate|distinguish|separa|distingue)\\b[^.!?;]*?)\\s+(?:from|del|de)\\s+'+budget,'gu');
 const scoped=text.replace(contrast,' ').replace(separate,'$1');
 const aspects=researchFocus(scoped);
 // "Total tuition" / "subtotal de matrícula" requests the tuition sum,
 // not a new living-cost budget. Explicit budget questions still retain both.
 if(aspects.includes('tuition_fees')&&!/\b(?:budgets?|presupuestos?|cost of attendance|costo de asistencia|total costs?|costo total|costos totales)\b/u.test(scoped))return aspects.filter(aspect=>aspect!=='total_budget');
 return aspects;
}
