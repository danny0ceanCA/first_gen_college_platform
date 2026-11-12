// Match source categories without inventing a student's eligibility or plan.
export function residentCategories(residency){
 return residency==='California resident'?['California resident','California resident / AB540 eligible']:[residency];
}
export function cohortYear(value){
 const match=/^(20\d{2})(?:[-–](?:20)?\d{2})?(?:\s+(?:or earlier|cohort(?: and prior)?|entering|continuing))?$/iu.exec(String(value||'').trim());
 return match?Number(match[1]):null;
}
export function sourceHousing(record){
 const {raw,normalized}=record.payload;
 // Preserve explicitly reviewed source semantics, not a universal commuter alias.
 if(normalized.housing==='commuter_unspecified'&&/\bcommuter means living with family\b/iu.test(raw['Scope and exclusions']||''))return 'with_family';
 return normalized.housing;
}

export function campusHousingRequest(question){
 const q=String(question||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[-–]/gu,' ')
  .replace(/\bnot on campus\b|\bno (?:en el|dentro del) campus\b/gu,'');
 if(!/\b(?:on campus|(?<!off )campus apartment|en el campus|dentro del campus|apartamento universitario)\b/u.test(q))return;
 const apartment=/\b(?:apartments?|apartamentos?|departamentos?|studio|estudio)\b/u.test(q);
 return {scenario:'on_campus',form:apartment?(/\b(?:studio|estudio)\b/u.test(q)?'studio':'apartment'):'residence_hall'};
}
