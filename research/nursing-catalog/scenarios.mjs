const fold=value=>String(value||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const HOME=1,OFF=2,ON=4,ALL=HOME|OFF|ON;
const housingPhrases=[
 [HOME,'with (?:(?:my|our|their) )?(?:parents?|family|relatives?)|con (?:(?:mis|mi|sus|la|los) )?(?:padres?|familia|familiares)|at home|en casa'],
 [OFF,'off campus|offcampus|fuera del campus'],
 [ON,'on campus|oncampus|en el campus'],
];

// A source's "away from parents" category could include either campus or
// rented housing. A negative statement must not imply a narrower alternative.
function housingScenario(value,source=false){
 let text=fold(String(value||'').replace(/\b(?:don|doesn|isn|aren|wasn|weren|won)[’']t\b/giu,'not')),excluded=0,positive=0;
 text=text.replace(/\b(?:away from (?:parents?|home)|(?:independent )?without (?:my )?parents?|sin (?:mis )?padres)\b/gu,()=>{excluded|=HOME;return ' ';});
 for(const [kind,phrase] of housingPhrases){
  const negative=new RegExp(`\\b(?:not(?: (?:living|staying|residing|live|stay|reside))?|no(?: (?:vivo|viviendo|vivire|resido|estoy|estare))?) (?:${phrase})\\b`,'gu');
  text=text.replace(negative,()=>{excluded|=kind;return ' ';});
 }
 for(const [kind,phrase] of housingPhrases)if(new RegExp(`\\b(?:${phrase})\\b`,'u').test(text))positive|=kind;
 if(source){
  if(/\b(?:parents?|relatives?|family)\b/u.test(text)||/^(?:home|dependent with parents)$/u.test(text))positive|=HOME;
  if(/\b(?:rental|renting|on your own|off campus own)\b/u.test(text))positive|=OFF;
  if(!positive&&/\b(?:campus|dorm|residence hall|university housing)\b/u.test(text))positive|=ON;
 }
 const hasScope=Boolean(positive||excluded),allowed=(positive||ALL)&~excluded;
 return {hasScope,allowed,conflict:hasScope&&(!allowed||Boolean(positive&(positive-1)))};
}
export const nursingHousing=question=>housingScenario(question);
export function nursingHousingMatches(label,requested){
 if(!requested.hasScope)return true;
 const own=housingScenario(label,true);
 return !requested.conflict&&own.hasScope&&!own.conflict&&Boolean(own.allowed)&&(own.allowed&requested.allowed)===own.allowed;
}

const unitWord='(?:credit (?:hours?|units?)|units?|credits?|unidades?|creditos?)';
const number='(\\d+(?:\\.\\d+)?)';
function unitBands(value){
 let text=String(value||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase();
 const bands=[];
 const take=(pattern,band)=>{text=text.replace(new RegExp(pattern,'gu'),(...m)=>{bands.push(band(m));return ' ';});};
 take(`\\b${number}\\s*(?:[-–—]|to|a)\\s*${number}\\s*${unitWord}\\b`,m=>({min:+m[1],max:+m[2]}));
 take(`\\b(?:less than|fewer than|under|menos de)\\s*${number}\\s*${unitWord}\\b`,m=>({min:0,max:+m[1],maxOpen:true}));
 take(`\\b(?:more than|over|mas de)\\s*${number}\\s*${unitWord}\\b`,m=>({min:+m[1],max:Infinity,minOpen:true}));
 take(`\\b(?:at least|al menos)\\s*${number}\\s*${unitWord}\\b`,m=>({min:+m[1],max:Infinity}));
 take(`\\b${number}\\s*(?:\\+|or more|o mas)\\s*${unitWord}\\b`,m=>({min:+m[1],max:Infinity}));
 take(`\\b${number}\\s*${unitWord}\\s*(?:or more|o mas)\\b`,m=>({min:+m[1],max:Infinity}));
 take(`\\b${number}\\s*-?\\s*${unitWord}\\b`,m=>({min:+m[1],max:+m[1]}));
 return bands;
}
export function nursingCreditLoad(question){
 const bands=unitBands(question);
 if(!bands.length)return null;
 const text=String(question||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase();
 const negative=new RegExp(`\\b(?:not|no)(?: (?:taking|enrolled in|curso|cursare))? \\d+(?:\\.\\d+)?\\s*${unitWord}\\b`,'u').test(text);
 const alternatives=new RegExp(`\\b\\d+(?:\\.\\d+)?\\s+(?:and|or|y|o)\\s+\\d+(?:\\.\\d+)?\\s*${unitWord}\\b`,'u').test(text);
 const unique=[...new Map(bands.map(b=>[[b.min,b.max,b.minOpen,b.maxOpen].join(':'),b])).values()];
 return unique.length===1&&!negative&&!alternatives?unique[0]:{ambiguous:true};
}
export function nursingCreditLoadMatches(row,requested){
 if(!requested)return true;
 if(requested.ambiguous)return false;
 // These fields state the enrollment category. Unit counts in fee notes or
 // program curricula cannot establish the student's per-term pricing band.
 const values=row.payload.values,category=[values['Entering cohort / applies to'],values.Enrollment].filter(Boolean).join(' ');
 if(/regardless\s*of\s*units/iu.test(category))return true;
 const own=[...new Map(unitBands(category).map(b=>[[b.min,b.max,b.minOpen,b.maxOpen].join(':'),b])).values()];
 if(own.length!==1)return false;
 const band=own[0];
 if(band.min===band.max&&!/\bonly\b|\b(?:per|each) (?:semester|term|quarter)\b/iu.test(category))return false;
 return requested.min>=band.min&&requested.max<=band.max&&
  !(requested.min===band.min&&band.minOpen&&!requested.minOpen)&&
  !(requested.max===band.max&&band.maxOpen&&!requested.maxOpen);
}

export function nursingWholeProgramRequest(question){
 const text=fold(question).replace(/\b(?:not|except|excluding|no|sin incluir) (?:the |el )?(?:(?:entire|whole|complete|full)(?: nursing)? program|programa(?: de enfermeria)? completo)\b/gu,' ');
 return /\b(?:(?:entire|whole|complete|full)(?: nursing)? program|total (?:nursing )?program|(?:nursing )?program total|programa(?: de enfermeria)? completo|toda la carrera|todo el programa)\b/u.test(text);
}
export function nursingWholeProgramMatches(row){
 const period=fold(row.budget_period);
 // "Program year 1", a continuation phase, and mixed rate schedules do not
 // establish the price of the entire program. Never sum those rows here.
 if(/\b(?:year\s*\d|yearly|annual|academic year|phase|mixed|rates?|per|startup|pre enrollment|post program)\b/u.test(period))return false;
 if(/\bnot (?:the )?(?:entire|whole|full|complete) program\b/u.test(period))return false;
 if(/\b(?:entire|whole|complete|full)\b/u.test(period)&&/program/u.test(period))return true;
 return /^program(?: direct (?:costs|expenses)| tuition)?$/u.test(period);
}
