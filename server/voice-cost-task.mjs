// Public research scope derived from this call. These values never save a
// student profile and never establish that an amount has been verified.
const fold=text=>String(text||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase();
export function statedHousingChoice(text){
 const value=fold(text);
 const affirmative=value.replace(/\bnot on campus\b|\bno en el campus\b/gu,'')
  .replace(/\bnot (?:living |staying )?with (?:his |her |their |my )?(?:family|parents|relatives)\b|\bno (?:con|vive con|vivira con) (?:su |sus |mi |mis )?(?:familia|familiares|padres)\b/gu,'')
  .replace(/^(?:yes|yeah|si)[, ]+/u,'');
 if(/\b(?:not|never|don['’]?t|doesn['’]?t|no|nunca|if)\b/u.test(affirmative))return;
 if(/[?¿]|\b(?:what if|would|might|maybe|if he|if she|if i|not renting|not going to rent|not sure|undecided|no va a|no vamos a|no se|tal vez|quizas|y si|podria)\b/u.test(value))return;
 const excludesFamily=affirmative!==value&&/\b(?:off[- ]campus|fuera del campus)\b/u.test(affirmative)&&
  /\b(?:not (?:living |staying )?with|no (?:con|vive con|vivira con))\b/u.test(value);
 const rental=excludesFamily||/\b(?:rent(?:ing)?|alquil(?:ar|ando|ara)|rent(?:ar|ando|ara))\b/u.test(affirmative);
 const family=/\b(?:with (?:his |her |their |my )?(?:family|relatives|parents)|con (?:su |sus |mi |mis )?(?:familia|familiares|padres))\b/u.test(affirmative);
 if(rental===family)return;
 const personal=/\b(?:he|she|they|we|i|el|ella|nosotros|vamos|va a|voy a)\b/u.test(value)||/^(?:renting|alquilando|rentando|(?:living )?with (?:family|relatives|parents)|(?:vivir |viviendo )?con (?:familia|familiares|padres))\s*[.!]?$/u.test(value.trim());
 if(!personal)return;
 return rental?'renting':'with_family';
}

export function publishedCostQuestion(question,turns,language){
 if(!turns.length)return question;
 if(!/\b(?:costs?|cost of attendance|tuition|budget|presupuesto|costos?|costo de asistencia|matr[ií]cula)\b/iu.test(question))return question;
 const explicit=turns.some(text=>/\b20\d{2}\b|\b(?:next (?:academic )?year|this (?:academic )?year|last year|proximo ano|este ano|ano que viene)\b/u.test(fold(text)));
 if(explicit)return question;
 const benchmark=language==='es'?'Usa el año académico publicado más reciente como referencia, con su año claramente identificado.':'Use the latest officially published academic-year benchmark and clearly identify its year.';
 if(question.includes(benchmark))return question;
 const scoped=question.replace(/\b20\d{2}\s*[–—-]\s*(?:20)?\d{2}\b/gu,language==='es'?'el año publicado':'the published year')
  .replace(/\b(?:for )?the next available academic year\b/giu,'the latest published academic year')
  .replace(/\b(?:next|upcoming) (?:academic )?year\b/giu,'latest published academic year');
 return scoped.length+benchmark.length+1<=3000?scoped+' '+benchmark:scoped;
}

export function housingResearchQuestion(question,choice,language){
 const detail=language==='es'
  ? choice==='renting'?'Para esta estimación se prevé alquilar un apartamento fuera del campus.':'Para esta estimación se prevé vivir con familiares.'
  : choice==='renting'?'Use the planned scenario of renting an off-campus apartment.':'Use the planned scenario of living with relatives.';
 // Replace the old unspecified label so the worker and table share one scope.
 const scoped=question.replace(/\s*\(housing arrangement unspecified\)/giu,'')
  .replace(/\boff[- ]campus(?: housing)?(?: scenario)?(?:,? (?:housing )?arrangement unspecified)?/giu,choice==='renting'?'renting off campus':'living with relatives');
 return scoped.length+detail.length+1<=3000?scoped+' '+detail:null;
}
