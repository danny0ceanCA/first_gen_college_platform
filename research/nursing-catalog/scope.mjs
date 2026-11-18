const fold=value=>String(value||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();

// A catalog price cannot establish an award, personal net cost, eligibility or
// an application deadline. Admissions and approval require separate evidence
// too. Before-aid boundaries still request the gross price.
export function nursingRequestNeedsResearch(question){
 const q=fold(question)
  .replace(/\b(?:before|without|excluding|prior to) (?:any )?(?:financial aid|aid|scholarships?|grants?|loans?|waivers?)\b/gu,'')
  .replace(/\b(?:antes de|sin|sin incluir) (?:la |las |los |el )?(?:ayuda financiera|ayuda|becas?|prestamos?|subsidios?)\b/gu,'')
  .replace(/\bfirst aid\b/gu,'');
 return /\b(?:eligib\w*|elegib\w*|qualif(?:y|ies|ied|ying)|calific\w*|scholarships?|becas?|grants?|subsidios?|loans?|prestamos?|aid|ayuda financiera|ayuda estudiantil|cuanta ayuda|fafsa|pell|cal grant|waiv\w*|exenci\w*|deadlines?|due date|fecha limite|plazos?|net (?:cost|price)|out of pocket|costo neto)\b/u.test(q)||
  /\b(?:prerequisites?|prerrequisitos?|admission requirements?|entrance requirements?|requisitos de (?:admision|ingreso)|accredit\w*|acredit\w*|approved|approval|aprobados?|aprobadas?|aprobacion|application process|how to apply|como (?:aplicar|solicitar)|required documents|documentos (?:necesarios|requeridos))\b/u.test(q)||
  /\b(?:what|which|que|cuales)\b.*\b(?:requirements?|requisitos|entrance exams?|examenes de (?:admision|ingreso))\b/u.test(q);
}

// Negated personal scope is not an affirmative resident category. Keep
// contradictory/ambiguous statements separate from a chosen fee scenario.
export function nursingResidency(question){
 let q=fold(question),notResident=false,notNonresident=false;
 q=q.replace(/\b(?:not (?:a |an )?(?:nonresident|non (?:california |ca )?resident|out of state)|no soy (?:un |una )?no residente)\b/gu,()=>{notNonresident=true;return ' ';});
 q=q.replace(/\b(?:not (?:a |an )?(?:(?:california|ca) resident|resident (?:of|in) california|in state)|no soy (?:un |una )?residente (?:de|en) california)\b/gu,()=>{notResident=true;return ' ';});
 const nonresident=notResident||/\b(?:nonresidents?|non (?:california |ca )?residents?|out of state|no residente)\b/u.test(q);
 q=q.replace(/\b(?:nonresidents?|non (?:california |ca )?residents?|out of state|no residente)\b/gu,' ');
 const resident=/\b(?:(?:california|ca) resident|resident (?:of|in) california|in state|residente (?:de|en) california)\b/u.test(q);
 return {nonresident,resident,conflict:resident&&nonresident||notNonresident&&!resident||notNonresident&&nonresident};
}

export function nursingResidencyMatches(label,requested){
 const own=fold(label),nonresident=/\b(?:nonresidents?|non (?:california |ca )?residents?|out of state|no residente)\b/u.test(own);
 if(requested.nonresident)return nonresident;
 if(requested.resident)return !nonresident&&/\b(?:(?:california|ca) resident|resident tuition|resident (?:of|in) california)\b/u.test(own);
 return true;
}

const seasonWords='summer|fall|autumn|spring|winter|verano|otono|primavera|invierno';
const season=value=>({verano:'summer',otono:'fall',autumn:'fall',primavera:'spring',invierno:'winter'}[value]||value);
const yearWords=['first|primer|primero','second|segundo','third|tercer|tercero','fourth|cuarto','fifth|quinto','sixth|sexto'];
const yearPhrase=`(?:year|ano)\\s*\\d{1,2}|(?:${yearWords.join('|')})(?: academic| program)? (?:year|ano)`;
const programYears=text=>{
 const years=[...text.matchAll(/\b(?:year|ano)\s*(\d{1,2})\b/gu)].map(m=>m[1]);
 yearWords.forEach((words,index)=>{if(new RegExp(`\\b(?:${words})(?: academic| program)? (?:year|ano)\\b`,'u').test(text))years.push(String(index+1));});
 return years;
};
export function matchesNursingCohort(row,question){
 const v=row.payload.values,academic=String(v['Academic year']||'');
 let q=fold(question),notEntering=false,notContinuing=false;
 q=q.replace(/\b(?:not (?:a |an )?(?:new students?|entering(?: students?)?|incoming(?: students?)?)|no soy (?:un |una )?(?:estudiante )?(?:de )?(?:nuevo ingreso|primer ingreso|ingresante))\b/gu,()=>{notEntering=true;return ' ';});
 q=q.replace(/\b(?:not (?:a |an )?(?:continuing|returning)(?: students?)?|no soy (?:un |una )?(?:estudiante )?que continua)\b/gu,()=>{notContinuing=true;return ' ';});
 const cohort=fold([v['Entering cohort / applies to'],/cohort|entering|start/iu.test(academic)?academic:''].filter(Boolean).join(' ')).replace(/([a-z])(20\d{2})/gu,'$1 $2');
 const continuing=notEntering||/\b(?:continuing|returning|que continua|que continuan|continuacion)\b/u.test(q);
 const entering=notContinuing||/\b(?:entering|incoming|new students?|newly admitted|first time|nuevo ingreso|primer ingreso|ingresantes?)\b/u.test(q);
 if(continuing&&entering||continuing&&!/\b(?:continuing|returning|continua\w*)\b/u.test(cohort)||entering&&!/\b(?:entering|incoming|new|ingres\w*)\b/u.test(cohort))return false;
 const excludedYears=[];
 q=q.replace(new RegExp(`\\b(?:not|no) (?:in |en )?(?:(?:my|the|mi|el) )?(${yearPhrase})\\b`,'gu'),(_,phrase)=>{excludedYears.push(...programYears(phrase));return ' ';});
 const requestedYears=programYears(q);
 const ownYears=programYears(cohort+' '+fold(row.budget_period));
 if(requestedYears.some(year=>!ownYears.includes(year))||excludedYears.length&&(!ownYears.length||excludedYears.some(year=>ownYears.includes(year))))return false;
 const excludedTerms=[];
 q=q.replace(new RegExp(`\\bnot (?:a |an )?(${seasonWords})(?:\\s*20\\d{2})? start\\b`,'gu'),(_,term)=>{excludedTerms.push(season(term));return ' ';});
 const forward=new RegExp(`\\b(${seasonWords})(?:\\s*(20\\d{2}))?\\s+(?:start|entry|entering|cohort|intake|cohorte|ingreso|inicio)\\b`,'gu');
 const reverse=new RegExp(`\\b(?:start(?:ing)?|entering|entry|cohort|intake|inicio|ingreso)\\s+(?:in |en |de )?(${seasonWords})(?:\\s*(20\\d{2}))?\\b`,'gu');
 const terms=[...q.matchAll(forward),...q.matchAll(reverse)];
 const ownTerms=[...cohort.matchAll(new RegExp(`\\b(${seasonWords})\\b`,'gu'))].map(m=>season(m[1]));
 if(excludedTerms.length&&(!ownTerms.length||excludedTerms.some(term=>ownTerms.includes(term))))return false;
 return terms.every(m=>ownTerms.includes(season(m[1]))&&(!m[2]||cohort.includes(m[2])));
}
