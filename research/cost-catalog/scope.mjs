// Match source categories without inventing a student's eligibility or plan.
export function residentCategories(residency){
 return residency==='WUE'?['WUE']:residency==='California resident'?['California resident','California resident / AB540 eligible','CA Resident']:
  ['Nonresident','Non-California resident','Non California Resident','Non-California Resident','Nonresident (U.S. and foreign)'];
}
export const generalUndergraduatePrograms=['General undergraduate','General Undergraduate','General','Undergraduate','Standard Undergraduate',
 'Undergraduate Full-Time Students (2026-2027 Academic Year)','General undergraduate (7 UNITS OR MORE per semester)'];
export const standardUndergraduateRecord=record=>record.payload.raw['Student level']==='Undergraduate'&&
 generalUndergraduatePrograms.includes(record.payload.raw['Program / degree'])&&!String(record.payload.raw['Dependent children']||'').trim();
export function cohortYear(value){
 const match=/^(20\d{2})(?:[-–](?:20)?\d{2})?(?:\s+(?:or earlier|cohort(?: and prior)?|entering|continuing))?$/iu.exec(String(value||'').trim());
 return match?Number(match[1]):null;
}
export function sourceHousing(record){
 const {raw,normalized}=record.payload;
 // Preserve explicitly reviewed source semantics, not a universal commuter alias.
 if(normalized.housing==='commuter_unspecified'&&/\bcommuter means living with family\b/iu.test(raw['Scope and exclusions']||''))return 'with_family';
 if(normalized.import_contract==='csu-workbook-v1'){
  const label=String(raw.Housing||'').toLowerCase().replace(/[-–]/gu,' ');
  if(/^(?:with relatives|living with parent or relative|housing with parent|living at home|at home|living with parents or relatives)$/u.test(label))return 'with_family';
 }
 return normalized.housing;
}

export function campusHousingRequest(question){
 const q=String(question||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[-–]/gu,' ')
  .replace(/\bnot on campus\b|\bno (?:en el|dentro del) campus\b/gu,'');
 if(!/\b(?:on campus|(?<!off )campus apartment|en el campus|dentro del campus|apartamento universitario)\b/u.test(q))return;
 const apartment=/\b(?:apartments?|apartamentos?|departamentos?|studio|estudio)\b/u.test(q);
 return {scenario:'on_campus',form:apartment?(/\b(?:studio|estudio)\b/u.test(q)?'studio':'apartment'):'residence_hall'};
}
