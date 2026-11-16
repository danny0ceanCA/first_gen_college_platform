import {projectRecord} from './catalog.mjs';

const fold=text=>String(text||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export function ucsfProgram(question){
 const q=fold(question),summer=/\b(?:summer|verano)\b/u.test(q),part=/\b(?:part time|tiempo parcial)\b/u.test(q);
 const first=/\b(?:(?:year|ano|part time|tiempo parcial|master s|masters?) 1|first|primer|primero|primera)\b/u.test(q),second=/\b(?:(?:year|ano|part time|tiempo parcial|master s|masters?) 2|second|segundo|segunda)\b/u.test(q);
 if(first&&second)return null;
 if(/\b(?:postbac\w*|post bac\w*|postbaccalaureate|posbachillerato)\b/u.test(q)){
  if(summer||part)return null;
  const choices=[[/\b(?:dental|dentistry|odontologia)\b/u,'Dental PostBac'],[/\b(?:medicine|medical|medicina)\b/u,'Medicine PostBac'],[/\b(?:pharmacy|farmacia)\b/u,'Pharmacy PostBac']].filter(([pattern])=>pattern.test(q));
  return choices.length===1?choices[0][1]:null;
 }
 if(/\b(?:biomedical imaging|imagenes biomedicas|imagen biomedica)\b/u.test(q))return summer||part||/\b(?:phd|ph d|doctorado)\b/u.test(q)?null:'Biomedical Imaging';
 const masters=/\b(?:master\w*|maestria)\b/u.test(q),phd=/\b(?:phd|ph d|doctorado)\b/u.test(q);
 if(/\b(?:global health(?: sciences)?|salud global)\b/u.test(q)){
  if(phd)return !summer&&!part&&!masters?'Global Health Sciences (PhD)':null;
  if(part)return summer?'Global Health Sciences - Part-Time (Summer)':first?'Global Health Sciences Part-Time 1':second?'Global Health Sciences Part-Time 2':null;
  return masters?(summer?"Global Health Sciences - Master's (Summer)":"Global Health Sciences (Master's)"):null;
 }
 if(/\b(?:advanced training clinical research|clinical research|investigacion clinica)\b/u.test(q)){
  const certificate=/\b(?:certificate|certificado)\b/u.test(q);
  if(summer||certificate&&masters)return null;
  return certificate?'Advanced Training Clinical Research - Certificate':masters&&first?"Advanced Training Clinical Research - Master's 1":masters&&second?"Advanced Training Clinical Research - Master's 2":null;
 }
 return null;
}

// Only clearly named supported programs use this path. A partial source is
// useful evidence, never permission to invent tuition or a full annual total.
export async function lookupUcsfProgram({input,query,view,publication}){
 const program=ucsfProgram(input.question);if(!program)return null;
 const q=fold(input.question);
 if(/\b(?:per month|monthly|mensual|al mes)\b/u.test(q))return null;
 if(/\b(?:with (?:family|relatives|parents)|con (?:familia|familiares|padres)|on campus|en el campus|dentro del campus)\b/u.test(q))return null;
 const years=[...new Set([...String(input.question).matchAll(/\b(20\d{2})[-–](?:20)?(\d{2})\b/gu)].map(m=>m[1]+'-'+m[2]))];if(years.length>1)return null;
 const nonresident=/\b(?:nonresident|non resident|out of state|no residente)\b/u.test(q),resident=/\b(?:california resident|resident of california|residente de california|residente en california)\b/u.test(q);
 if(nonresident&&resident)return null;
 const params=[program],where=["campus='UC San Francisco'","payload->'raw'->>'Program / degree'=$1"];
 if(years.length){params.push(years[0]);where.push('academic_year=$2');}
 const rows=(await query('SELECT * FROM coa_catalog.'+view+' WHERE '+where.join(' AND '),params)).rows;
 let candidates=rows.filter(r=>r.campus==='UC San Francisco'&&r.payload.raw['Program / degree']===program);
 if(!years.length&&candidates.length){const latest=candidates.map(r=>r.academic_year).sort().at(-1);candidates=candidates.filter(r=>r.academic_year===latest);}
 let assumedResidency=false;
 if(program==='Global Health Sciences (PhD)'){
  candidates=candidates.filter(r=>r.payload.raw.Residency===(nonresident?'Nonresident':'California resident'));assumedResidency=!nonresident&&!resident;
 }
 if(candidates.length!==1)return null;
 const months=/\b(\d+) (?:months?|meses?)\b/u.exec(q);
 if(months&&Number(months[1])!==candidates[0].payload.raw['Coverage months'])return null;
 const language=input.language==='es'?'es':'en',result=projectRecord(candidates[0],language,{allowTesting:true});if(!result)return null;
 const es=language==='es',scope=[assumedResidency?(es?'Referencia para residente de California; residencia personal sin confirmar.':'California-resident benchmark; personal residency unconfirmed.'):'',
  es?'La vivienda corresponde a la referencia publicada de alquiler compartido fuera del campus.':'Housing uses the published shared off-campus benchmark.'].filter(Boolean).join(' ');
 result.voiceBrief.findings=result.voiceBrief.findings.map(f=>({...f,subject:'UC San Francisco — '+program,qualification:f.qualification+' '+scope}));
 result.voiceBrief.qualification+=' '+scope;
 return {...result,...(publication==='production'?{catalogPublication:'production'}:{catalogLocalTesting:true})};
}
