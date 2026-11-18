const fold=value=>String(value||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const specialties=[
 ['fnp','fnp|family (?:nurse practitioner|np)|enfermeria familiar'],
 ['pmhnp','pmhnp|(?:psychiatric )?mental health (?:nurse practitioner|np)|psychiatric nurse practitioner|enfermeria psiquiatrica'],
 ['anesthesia','(?:nurse )?(?:anesthesia|anaesthesia)|nurse anesthetist|crna|anestesia'],
];
function credentials(value){
 return fold(value)
  .replace(/\bdoctor (?:of|in) nursing practice\b/gu,'dnp')
  .replace(/\b(?:bachelor(?: s)? (?:of science )?(?:in )?nursing|bs nursing|licenciatura en enfermeria)\b/gu,'bsn')
  .replace(/\b(?:master(?: s)? of science in nursing|elmsn)\b/gu,'msn')
  .replace(/\b(?:associate(?: s)? (?:degree|of science) in nursing|asn)\b/gu,'adn');
}
const pathways=text=>new Set((text.match(/\b(?:absn|bsn|adn|lvn|vn|rn|msn|dnp|phd|anesthesia|accelerated|traditional|vocational|bridge|completion)\b/gu)||[]));
const specialtySet=text=>new Set(specialties.filter(([,pattern])=>new RegExp(`\\b(?:${pattern})\\b`,'u').test(text)).map(([name])=>name));

export function nursingProgramMatches(program,question){
 let requested=credentials(question);
 const excluded=new Set();
 for(const [name,pattern] of specialties){
  requested=requested.replace(new RegExp(`\\b(?:not|except|excluding|no)(?: (?:a|an|the))? (?:${pattern})\\b`,'gu'),()=>{excluded.add(name);return ' ';});
 }
 const own=credentials(program),target=pathways(requested),ownPathways=pathways(own);
 if(![...target].every(t=>ownPathways.has(t)||t==='accelerated'&&ownPathways.has('absn')||t==='absn'&&ownPathways.has('accelerated')&&ownPathways.has('bsn')||t==='lvn'&&ownPathways.has('vn')||t==='vocational'&&ownPathways.has('vn')||t==='bridge'&&ownPathways.has('lvn')&&ownPathways.has('rn')))return false;
 const wanted=specialtySet(requested),available=specialtySet(own);
 if([...wanted].some(t=>!available.has(t))||[...excluded].some(t=>available.has(t)))return false;
 // NP/FNP/PMHNP and nurse-anesthesia routes are distinct even at one degree
 // level. A generic DNP title does not establish an NP specialty either.
 if(/\b(?:nurse practitioners?|np)\b/u.test(requested)&&!(/\b(?:nurse practitioners?|np)\b/u.test(own)||available.has('fnp')||available.has('pmhnp')))return false;
 return true;
}
