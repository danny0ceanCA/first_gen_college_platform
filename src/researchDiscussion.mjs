import {researchFocus,findingSubjectMentioned,researchSubjectIdentity} from './researchFindings.mjs';
import {requestedResearchFacts,researchFactMatchesRequirement} from './researchTask.mjs';
// Local duplicate suppression, not an answer-quality grader or proof of hearing.
// Compare the finding's quantities and distinctive words, allowing spoken number
// formats and paraphrases. Nothing here initiates model work or controls playback.
const fold=text=>String(text||'').normalize('NFKD').replace(/\p{M}/gu,'');
const units=Object.fromEntries([
 ['zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen',0],
 ['cero uno dos tres cuatro cinco seis siete ocho nueve diez once doce trece catorce quince dieciseis diecisiete dieciocho diecinueve',0],
].flatMap(([text,start])=>text.split(' ').map((word,i)=>[word,start+i])));
const tens={twenty:20,thirty:30,forty:40,fifty:50,sixty:60,seventy:70,eighty:80,ninety:90,veinte:20,treinta:30,cuarenta:40,cincuenta:50,sesenta:60,setenta:70,ochenta:80,noventa:90,
 veintiuno:21,veintidos:22,veintitres:23,veinticuatro:24,veinticinco:25,veintiseis:26,veintisiete:27,veintiocho:28,veintinueve:29};
const hundreds={cien:100,ciento:100,doscientos:200,trescientos:300,cuatrocientos:400,quinientos:500,seiscientos:600,setecientos:700,ochocientos:800,novecientos:900};
function decimalFraction(tokens,start){
 let end=start,digits='';
 while(Object.hasOwn(units,tokens[end])&&units[tokens[end]]<=9){digits+=units[tokens[end++]];}
 if(digits)return {digits,end};
 const first=units[tokens[start]]??tens[tokens[start]];
 if(first===undefined)return null;
 end=start+1;let value=first;
 if(first>=20&&first%10===0){
  if((tokens[end]==='y'||tokens[end]==='and')&&Object.hasOwn(units,tokens[end+1])&&units[tokens[end+1]]<10)end++;
  if(Object.hasOwn(units,tokens[end])&&units[tokens[end]]<10)value+=units[tokens[end++]];
 }
 return {digits:String(value),end};
}
function numberWords(tokens){
 const result=[];let i=0;
 const numeric=word=>Object.hasOwn(units,word)||Object.hasOwn(tens,word)||Object.hasOwn(hundreds,word)||['hundred','thousand','mil','million','millon','millones'].includes(word);
 while(i<tokens.length){
  if(!numeric(tokens[i])){result.push(tokens[i++]);continue;}
  let total=0,part=0,start=i;
  while(i<tokens.length){
   const word=tokens[i];
   if((word==='and'||word==='y')&&numeric(tokens[i+1])){i++;continue;}
   if(!numeric(word))break;
   if(Object.hasOwn(units,word))part+=units[word];
   else if(Object.hasOwn(tens,word))part+=tens[word];
   else if(Object.hasOwn(hundreds,word))part+=hundreds[word];
   else if(word==='hundred')part=(part||1)*100;
   else if(word==='thousand'||word==='mil'){total+=(part||1)*1000;part=0;}
   else{total=(total+part||1)*1000000;part=0;}
   i++;
  }
  if(['point','punto','coma'].includes(tokens[i])){
   const fraction=decimalFraction(tokens,i+1);
   if(fraction){result.push(`${total+part}decimal${fraction.digits}`);i=fraction.end;continue;}
  }
  result.push(i>start?String(total+part):tokens[i++]);
 }
 return result;
}
const stop=new Set(('a an the is are was were be been being for of at in on to as and or with from by per this that these those it its their your our we you they he she i us usd dollars dollar new published including neither not no before versus than both also about can could would will should does do did have has had just already only each any some all what how here there which who so into through out '+
 'el la los las un una unos unas es son esta estan fue para de del en al por con sin y o se su sus tu tus nuestro nuestra que como esto eso estos esas este esta entre tanto tambien antes ni no si ya solo cada hay ser tener puede pueden '+
 'university universidad college').split(/\s+/));
const stem=word=>word.length>6&&word.endsWith('ly')?word.slice(0,-2):word.length>8&&word.endsWith('mente')?word.slice(0,-5):word.length>4&&word.endsWith('s')?word.slice(0,-1):word;
function tokens(text){
 let plain=fold(text).replace(/\[\d+\]/gu,'').toLowerCase();
 // Live may transcribe each half of an academic year in words, and combine
 // digit groups with a spoken thousands separator (e.g. "13 mil 647").
 plain=plain.replace(/\btwenty[ -]+(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[ -]+(one|two|three|four|five|six|seven|eight|nine))?\b/gu,
  (_,ten,one)=>String(2000+tens[ten]+(units[one]??0)));
 plain=plain.replace(/\b(20\d{2})\s*(?:[-–—/]|(?:and|y|to|through|a)\s+['’]?)\s*(\d{2})\b/gu,(_,year,end)=>`${year} ${year.slice(0,2)+end}`);
 plain=plain.replace(/\b(\d{1,3})\s+(?:thousand|mil)\s+(\d{1,3})(?!\d)\b/gu,(_,thousands,remainder)=>String(Number(thousands)*1000+Number(remainder)));
 plain=plain.replace(/\b(\d{1,3})\s+(?:thousand|mil)\b/gu,(_,thousands)=>String(Number(thousands)*1000));
 // Both 49,692 and 49.692 are grouped whole numbers. Decimal values remain
 // distinct tokens, so an unrecognized rendering cannot count as a match.
 plain=plain.replace(/\b\d{1,3}(?:[,.]\d{3})+(?!\d)/gu,n=>n.replace(/[,.]/gu,''));
 plain=plain.replace(/(?<=\d)[,.](?=\d)/gu,'decimal');
 const numeric=numberWords(plain.match(/[\p{L}\p{N}]+/gu)||[]),result=[];
 for(let index=0;index<numeric.length;index++){
  let cents=index+2;
  if(['and','y'].includes(numeric[cents]))cents++;
  if(/^\d+$/u.test(numeric[index])&&['dollar','dollars','dolar','dolares'].includes(numeric[index+1])&&
   /^\d{1,2}$/u.test(numeric[cents]||'')&&['cent','cents','centavo','centavos'].includes(numeric[cents+1])){
   result.push(`${numeric[index]}decimal${numeric[cents].padStart(2,'0')}`);index=cents+1;
  }else result.push(numeric[index]);
 }
 return result;
}
export function researchAnswerOverlap(answer,spoken){
 // Repeating a number as a question or as a still-unverified possibility isn't
 // stating a finding. Keep genuine statements preceding a closing question.
 const statements=String(spoken||'').split(/(?<=[.!?])\s+/u).filter(part=>{
  const text=fold(part).toLowerCase();
  return !/[?？]\s*$/u.test(text)&&!/(?:\b(?:checking|verifying|investigating|revisando|comprobando|verificando|investigando)\b|\b(?:will|going to) (?:check|verify|confirm)\b|\b(?:not|haven['’]?t|hasn['’]?t) (?:yet )?(?:verified|confirmed)\b|\b(?:no|sin) (?:he |hemos |haber )?(?:confirmado|verificado|confirmar|verificar)\b)/u.test(text);
 }).join(' ');
 const a=tokens(answer),s=tokens(statements);
 if(a.length<6||s.length<6)return false;
 const said=new Set(s.map(stem));
 const numbers=[...new Set(a.filter(w=>/^\d+(?:decimal\d+)?$/u.test(w)))];
 if(numbers.some(n=>!said.has(n)))return false;
 const content=[...new Set(a.filter(w=>!stop.has(w)&&!/^\d/u.test(w)).map(stem))];
 const matches=content.filter(w=>said.has(w)).length;
 // Names protect against treating a different campus's figures as this answer.
 // Ignore sentence-opening words and common institutional nouns, not all names.
 const names=fold(answer).replace(/(^|[.!?]\s+)\p{L}+/gu,' ').match(/\b[A-Z][a-z]{2,}\b/gu)||[];
 if(names.some(name=>!stop.has(name.toLowerCase())&&!said.has(stem(name.toLowerCase()))))return false;
 // Numbers and names provide strong anchors for a reordered explanation; a
 // non-numeric answer needs substantially more of the finding's actual words.
 return matches>=Math.min(4,content.length)&&content.length>=3&&matches/content.length>=(numbers.length?0.55:0.8);
}

// A finished check can truthfully yield an unavailable answer. Do not count an
// ongoing search, a promise to check, or a generic apology as that disclosure.
export function researchFindingHasOnlyUnverifiedFacts(finding){
 const facts=finding.evidence?.facts;
 return finding.status==='unverified'||Array.isArray(facts)&&facts.length>0&&facts.every(fact=>fact.status==='unverified');
}
export function researchLimitationOverlap(finding,spoken,mentionsSubject){
 const text=fold(spoken).toLowerCase();
 const aspects=researchFocus(text);
 if(!mentionsSubject||(aspects.length&&!aspects.includes(finding.aspect)))return false;
 const pending=/\b(?:checking|verifying|investigating|searching|looking (?:up|for)|still trying|(?:will|going to) (?:check|verify|confirm|look|search)|revisando|comprobando|verificando|investigando|buscando|(?:voy|vamos) a (?:revisar|buscar|verificar|confirmar)|sigo intentando)\b/u;
 if(pending.test(text))return false;
 const limitation=/\b(?:could(?:n['’]?t| not)|cannot|can['’]?t|unable to|not able to|(?:haven['’]?t|have not) been able to) (?:verify|confirm|establish|find)|\b(?:haven['’]?t|have not) (?:yet )?(?:verified|confirmed)|\b(?:remain|remains|is|are) (?:still |currently )?unverified|\b(?:no (?:pude|pudimos|logre|logramos|se pudo|se ha podido) (?:confirmar|verificar|encontrar)|no (?:esta|estan) (?:todavia |aun )?(?:verificad[oa]s?|confirmad[oa]s?)|no (?:la |lo |las |los )?tengo (?:todavia |aun )?(?:verificad[oa]s?|confirmad[oa]s?)|sigue[n]? sin (?:verificar|confirmar))\b/u;
 if(!limitation.test(text))return false;
 // A partial record may contain only unknown facts (e.g. contact and hours).
 // Match each explicit missing fact rather than requiring a positive answer,
 // or treating one disclosed gap as every requested detail being answered.
 const facts=finding.evidence?.facts;
 if(Array.isArray(facts)&&facts.length){
  if(!facts.every(fact=>fact.status==='unverified'))return false;
  const disclosed=String(spoken||'').split(/(?<=[.!?;])\s+|,\s*(?:but|pero)\s+/iu)
   .filter(part=>limitation.test(fold(part).toLowerCase()))
   .flatMap(part=>requestedResearchFacts(part));
  return facts.every(fact=>disclosed.some(required=>researchFactMatchesRequirement(fact,required)));
 }
 return true;
}

// A caller-led answer need not repeat the institution's name in every sentence.
// The controller may use this only for one explicit current subject, before any
// later caller question. Require a complete scoped gap clause whose vocabulary
// comes from that finding; another campus or unsupported scenario cannot match.
// This suppresses an optional repeated announcement, not verifies full delivery.
export function researchImplicitLimitationObserved(finding,spoken){
 if(!researchFindingHasOnlyUnverifiedFacts(finding))return false;
 const allowed=new Set([...tokens(`${finding.subject} ${finding.answer} ${finding.qualification}`),...stop,
  ...'still currently yet cannot unable confirm confirmed verify verified unverified haven t couldn isn aren tengo aun todavia confirmada confirmado confirmadas confirmados verificada verificado verificadas verificados'.split(' ')]);
 const statements=String(spoken||'').split(/(?<=[.!?;])\s+/u).flatMap(sentence=>sentence.split(/,?\s+\b(?:but|pero)\b\s+/iu));
 return statements.some(statement=>{
  const text=fold(statement).toLowerCase().trim();
  if(!/^(?:the|that|this|i|la|el|esa|ese|no)\b/u.test(text)||/[?¿？]/u.test(text))return false;
  if(!tokens(statement).every(word=>allowed.has(word)))return false;
  if(!researchScopeCompatible(finding,statement))return false;
  if(finding.aspect!=='other'&&!researchFocus(statement).includes(finding.aspect))return false;
  return researchLimitationOverlap(finding,statement,true);
 });
}

function concretePortion(source,aspect){
 const text=fold(source).toLowerCase();
 const condition=/\b(?:financial need|academic merit|necesidad economica|merito academico)\b/u.test(text);
 const grade=/\b(?:gpa|promedio)\b/u.test(text);
 // Counts of unnamed criteria and references to information or page numbers
 // describe where an answer lives, not the answer. Keep ambiguous clauses pending.
 if(/\b(?:information|details?|pages?|sections?|informacion|detalles|paginas?|secciones?)\b/u.test(text))return false;
 if(!condition&&!grade&&/\b(?:requirements?|criteria|requisitos|criterios)\b/u.test(text))return false;
 const rule=/\b(?:requires?|must|needs? to|requiere[n]?|debe[n]?)\b/u.test(text)||(condition&&/\b(?:includes?|incluye[n]?)\b/u.test(text));
 const eligibility=aspect==='eligibility'&&(rule||grade||condition);
 if(aspect!=='other'&&!researchFocus(source).includes(aspect)&&!eligibility)return false;
 // A year or a generic notice that information/requirements exist is not a
 // delivered fact. Partial suppression needs a value or a stated prerequisite.
 const value=tokens(source).some(token=>/^\d+(?:decimal\d+)?$/u.test(token)&&!(Number(token)>=1900&&Number(token)<=2100));
 return value||rule;
}

// Explicitly conflicting years/scenarios cannot retire a different finding.
// Omitted details alone do not make an otherwise relevant paraphrase a mismatch.
export function researchScopeCompatible(finding,statement){
 const source=`${finding.subject} ${finding.answer}`;
 const years=text=>tokens(String(text).replace(/\b(20\d{2})\s*[-–—]\s*(\d{2})\b/gu,(_,start,end)=>`${start} ${start.slice(0,2)}${end}`)).filter(t=>/^20\d{2}$/u.test(t));
 const expectedYears=years(source),spokenYears=years(statement);
 if(expectedYears.length&&spokenYears.some(year=>!expectedYears.includes(year)))return false;
 const scenarios=text=>{
  const normalized=fold(text).toLowerCase().replace(/[-–]/gu,' ');
  return [
   ['off',/\b(?:off campus|fuera del campus)\b/gu],
   ['on',/\b(?:on campus|residence halls?|dorms?|dormitor(?:y|ies)|dentro del campus|residencias? universitarias?)\b/gu],
   ['family',/\b(?:with (?:their |his |her |your )?(?:parents|relatives|family)|con (?:sus |tus )?(?:padres|familiares|familia))\b/gu],
  ].filter(([,pattern])=>[...normalized.matchAll(pattern)].some(match=>!/(?:\bnot|\bno|\bni)\s*$/u.test(normalized.slice(0,match.index)))).map(([name])=>name);
 };
 const expected=scenarios(source),claimed=scenarios(statement);
 return !expected.length||claimed.every(scenario=>expected.includes(scenario));
}
// A short campus lead and its immediately following fact belong to one spoken
// thought ("Here's the idea for Davis. The published budget is ..."). Carry
// only an exact, explicit subject lead; never infer a campus from a previous
// turn or carry past an intervening question/pending statement. The fact's
// introductory vocabulary must come from that finding or generic fact words,
// so a different named campus, even lowercased, cannot inherit this subject.
function adjacentSubjectLead(finding,previous,statement){
 if(!previous||/[?？]/u.test(previous)||!/^(?:the|its|el|la|los|las|su|sus)\s/iu.test(statement.trim()))return false;
 const lead=fold(previous).replace(/[.!]\s*$/u,'').trim().replace(/^(?:here['’]s (?:the (?:idea|answer|result|update)|what we have) (?:for|about)|as for|regarding|about|for|en cuanto a|respecto a|en el caso de|sobre|para)\s+/iu,'');
 if(lead===previous.trim()||!findingSubjectMentioned(finding.subject,lead,{exact:true}))return false;
 const expected=new Set([...tokens(`${finding.subject} ${finding.answer}`),...stop,
  ...'published annual yearly estimated estimate cost costs attendance budget living resident total minimum maximum amount rate result requirement deadline publicado publicada anual anuales estimado estimada costo costos coste asistencia presupuesto vivir residente total minimo minima maximo maxima monto importe tasa resultado requisito plazo'.split(' ')].map(stem));
 const content=tokens(statement),firstNumber=content.findIndex(word=>/^\d/u.test(word));
 if(firstNumber<0||!content.every(word=>/^\d/u.test(word)||expected.has(stem(word))))return false;
 const named=fold(statement).replace(/^\s*\p{L}+/u,'').match(/\b[A-Z][\p{L}]+\b/gu)||[];
 return named.every(name=>expected.has(stem(name.toLowerCase())))&&researchScopeCompatible(finding,previous);
}
// Retire an optional announcement when a native answer already explained a
// relevant portion. This does not certify completeness or numerical accuracy.
export function researchPortionObserved(finding,spoken){
 if(!findingSubjectMentioned(finding.subject,spoken))return false;
 if(researchFindingHasOnlyUnverifiedFacts(finding))return researchScopeCompatible(finding,spoken)&&researchLimitationOverlap(finding,spoken,true);
 const uncertain=/\b(?:checking|verifying|still trying|will check|going to check|pending|might|may|hypothetical|suppose|not verified|not confirmed|have not verified|have not confirmed|haven['’]?t verified|haven['’]?t confirmed|revisando|verificando|voy a revisar|pendiente|podria|hipotetic\w*|supongamos|no he verificado|no he confirmado|sin verificar|sin confirmar)\b/u;
 const sentences=String(spoken||'').split(/(?<=[.!?])\s+/u).map(sentence=>{
  // A limitation about a future year can precede a clearly dated benchmark.
  // Compare the affirmative benchmark clause, preserving its own year/scope.
  const contrast=sentence.match(/\b(?:but for (?:comparison|context)|pero (?:como (?:referencia|comparacion)|para comparar))[, ]+/iu);
  return contrast&&/\b(?:don['’]?t have|do not have|could not confirm|couldn['’]?t confirm|no tengo|no pude confirmar)\b/iu.test(sentence.slice(0,contrast.index))
   ?sentence.slice(contrast.index+contrast[0].length):sentence;
 });
 const statements=sentences.flatMap((statement,index)=>{
  if(/[?？]\s*$/u.test(statement)||uncertain.test(fold(statement).toLowerCase()))return [];
  return [!findingSubjectMentioned(finding.subject,statement)&&adjacentSubjectLead(finding,sentences[index-1],statement)
   ?`${researchSubjectIdentity(finding.subject)}: ${statement}`:statement];
 });
 const amounts=text=>tokens(text).filter(t=>/^\d+(?:decimal\d+)?$/u.test(t)).map(t=>Number(t.replace('decimal','.'))).filter(n=>n>=1000&&(n<1900||n>2100));
 const expected=amounts(finding.answer);
 const sourceSentences=String(finding.answer||'').split(/(?<=[.!?;])\s+/u);
 const subject=researchSubjectIdentity(finding.subject);
 const negative=text=>/\b(?:no|not|never|without|cannot|can['’]?t|don['’]?t|doesn['’]?t|isn['’]?t|aren['’]?t|won['’]?t|sin|nunca)\b/u.test(fold(text).toLowerCase());
 return statements.some(statement=>{
  if(!findingSubjectMentioned(finding.subject,statement))return false;
  if(!researchScopeCompatible(finding,statement))return false;
  const aspects=researchFocus(statement);
  const budgetHeadline=finding.aspect==='total_budget'&&finding.budget?.total!=null&&
   /\b(?:estimate|estimated|estimad[oa]|estimaci[oó]n|presupuesto|budget)\b/iu.test(statement)&&
   !aspects.includes('tuition_fees')&&amounts(statement).includes(finding.budget.total);
  if(aspects.length&&finding.aspect!=='other'&&!aspects.includes(finding.aspect)&&!budgetHeadline)return false;
  // An explained requirement or deadline is useful delivery too. Compare one
  // complete sourced clause, retaining every number and its polarity, so an
  // optional addendum does not require reciting the whole multi-part finding.
  if(sourceSentences.some(source=>concretePortion(source,finding.aspect)&&negative(source)===negative(statement)&&researchAnswerOverlap(`${subject} ${source}`,statement)))return true;
  const numericNegation=/\b(?:not|no|never|cannot|isnt|arent|without|sin)\s*(?:(?:is|are|es|son|de|about|approximately)\s*)*\d/u.test(tokens(statement).join(' '));
  if((!aspects.includes(finding.aspect)&&!budgetHeadline)||numericNegation)return false;
  const spokenAmounts=amounts(statement),approximate=/\b(?:about|roughly|around|near|approximately|cerca|aproximadamente|alrededor|unos|unas)\b/iu.test(statement);
  return expected.some(n=>spokenAmounts.some(s=>s===n||approximate&&Math.abs(s-n)/n<=0.02));
 });
}

// Suppress an optional repeat of an exact, structured budget total. The caller
// may hear a short headline rather than the full component list. Implicit
// subject use requires the controller's single current campus guard; this is
// not evidence that the complete breakdown or qualifications were delivered.
export function researchBudgetTotalObserved(finding,spoken,{implicitSubject=false}={}){
 if(finding.aspect!=='total_budget'||!finding.budget||finding.status==='unverified'||finding.budget.total==null)return false;
 const expected=new Set(tokens(`${finding.subject} ${finding.budget.population} ${finding.answer}`));
 const generic=new Set(tokens('for the published annual academic year California resident undergraduate off campus renting estimate budget total expenses costs cost attendance puts is at about approximately dollars USD en para el la publicado publicada anual año academico residente pregrado fuera del campus alquiler estimacion presupuesto total gastos costos es de unos aproximadamente dolares'));
 return String(spoken||'').split(/(?<=[.!?])\s+/u).some(sentence=>{
  if(!/[.!]["”’')]*\s*$/u.test(sentence)||/[?¿？]/u.test(sentence))return false;
  // Keep the affirmative benchmark separate from an earlier cohort limitation.
  const statement=sentence.split(/\b(?:but|pero)\s+(?=(?:for|para|en)\b)/iu).at(-1);
  const normalized=fold(statement).toLowerCase();
  if(/\b(?:not|no|isn|cannot|couldn|might|may|maybe|pending|checking|verifying|sin confirmar|podria|quizas|revisando)\b/u.test(normalized))return false;
  if(!/\b(?:total|budget|presupuesto|expenses|gastos)\b/u.test(normalized)||!researchScopeCompatible(finding,statement))return false;
  const quantities=tokens(statement);
  if(!quantities.includes(String(finding.budget.total)))return false;
  return (implicitSubject||findingSubjectMentioned(finding.subject,statement))&&
   quantities.every(word=>/^\d+(?:decimal\d+)?$/u.test(word)||expected.has(word)||generic.has(word));
 });
}
