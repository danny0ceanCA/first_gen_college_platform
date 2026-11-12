import {researchFocus} from './researchFindings.mjs';

// A boundary around an answer is not another requested lookup. Keep this
// separate from speech matching: a spoken qualification can mention many facets.
export function requestedResearchAspects(question){
 const text=String(question||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[-–—]/gu,' ')
  .replace(/ (?:housing scenario: (?:off campus housing, arrangement unspecified|renting off campus|living with family)|modalidad de vivienda: (?:alojamiento fuera del campus, modalidad sin especificar|alquiler fuera del campus|vivir con familiares))\.$/u,'');
 const budget='(?:(?:the|a|el|un)\\s+)?(?:total\\s+(?:cost(?:s)?(?:\\s+of\\s+attendance)?|budget)|cost\\s+of\\s+attendance|presupuesto\\s+total|costo\\s+(?:total|de\\s+asistencia))';
 const contrast=new RegExp('(?:separately\\s+from|separate\\s+from|distinct\\s+from|rather\\s+than|not\\s+including|excluding|separad[oa]s?\\s+(?:de|del)|aparte\\s+(?:de|del)|sin\\s+incluir|no\\s+incluyas)\\s+'+budget,'gu');
 const separate=new RegExp('((?:separate|distinguish|separa|distingue)\\b[^.!?;]*?)\\s+(?:from|del|de)\\s+'+budget,'gu');
 // Excluded living expenses constrain a fee answer; they aren't additional
 // requested facets. Stop at a new positive instruction, not across it.
 const excludedLiving=/\b(?:excluding|not including|sin incluir|excluyendo|no incluyas)\s+(?:(?:estimated|the|estimated costs of|costs of|los gastos de|gastos estimados de|la|el|los|las)\s+)*(?:housing|food|living expenses|vivienda|alojamiento|alimentacion|gastos de vida)\b(?:(?!\b(?:but|pero|include|incluye|incluyan)\b)[^.!?;])*/gu;
 const scoped=text.replace(contrast,' ').replace(separate,'$1').replace(excludedLiving,' ');
 const aspects=researchFocus(scoped);
 // "Total tuition" / "subtotal de matrícula" requests the tuition sum,
 // not a new living-cost budget. Explicit budget questions still retain both.
 if(aspects.includes('tuition_fees')&&!/\b(?:budgets?|presupuestos?|cost of attendance|costo de asistencia|total costs?|costo total|costos totales)\b/u.test(scoped))return aspects.filter(aspect=>aspect!=='total_budget');
 return aspects;
}
