import {budgetHeadline,budgetKeys,budgetLabels} from './publishedBudget.mjs';
import {normalizedText} from './researchRecord.mjs';
import {requestedResearchFacts} from './researchTask.mjs';

const detailed=/\b(?:breakdown|break (?:it|that) down|line items?|components?|itemi[sz]ed|each (?:cost|amount|step)|all (?:costs|figures|steps)|desglos\w*|componentes?|cada (?:costo|importe|partida|paso)|tod[oa]s? l[oa]s (?:cifras|partidas|costos)|paso a paso|step by step)\b/u;
const componentRequests={transportation:/\b(?:transportation|transporte)\b/u,food:/\b(?:food|meal|comida|alimentacion)\b/u,books:/\b(?:books|supplies|libros|materiales)\b/u,
 personal:/\b(?:personal expenses|gastos personales)\b/u,health_insurance:/\b(?:health insurance|seguro medico)\b/u,document_fee:/\b(?:document fee|cuota de documentos?)\b/u,
 housing:/\b(?:housing cost|rent cost|cost of housing|costo de (?:la )?(?:vivienda|renta|alquiler))\b/u};
// Presentation only: the source finding, full budget, table and qualifications
// stay intact. A builder-owned headline is safe; cutting arbitrary prose isn't.
export function researchSpokenFinding(finding,{question='',language='en'}={}){
 const q=normalizedText(question);
 // Backend request templates say "if available" for optional figures. That
 // modifier isn't a separate availability question requiring a full recital.
 // A real availability question elsewhere in the request remains intact.
 const requirements=requestedResearchFacts(q.replace(/\b(?:(?:if|where) available|si (?:esta|estan) disponibles?)\b/gu,''),language);
 const focusedBudget=requirements.some(r=>r.key==='total_budget')&&requirements.every(r=>['total_budget','tuition_fees','housing'].includes(r.key))&&!detailed.test(q);
 if(!finding.budget||finding.aspect!=='total_budget'||finding.status==='unverified'||!focusedBudget)return finding;
 const requested=[...new Set([
  ...requirements.filter(r=>r.key!=='total_budget').map(r=>r.key),
  ...Object.entries(componentRequests).filter(([,pattern])=>pattern.test(q)).map(([key])=>key),
 ])];
 const components=requested.map(key=>finding.budget.components.find(c=>c.key===key));
 // A specific requested item cannot disappear behind a total-only headline.
 // Keep the complete existing view if its value/role is not safely established.
 if(components.some(c=>!c||c.role!=='component'||c.amount===null))return finding;
 const details=components.map(c=>budgetLabels[language==='es'?'es':'en'][budgetKeys.indexOf(c.key)]+': '+finding.budget.currency+' $'+c.amount.toLocaleString('en-US',{maximumFractionDigits:2})+
  (c.qualification?' ('+c.qualification+')':'')+' '+finding.budget.sourceCitation).join('; ');
 return {...finding,answer:[budgetHeadline(finding.budget,language),details].filter(Boolean).join(' ')};
}

// This records a completed assistant explanation, not user comprehension or
// exact physical playback. Only a general distinction is reusable across
// campuses; dates, exceptions, eligibility and source-specific caveats remain.
export function researchCaveatObservation(){
 let estimate=false;
 return {
  observe(text){
   if(estimate)return false;
   const clauses=String(text||'').split(/(?<=[.!?。！？])\s+/u);
   let precedingEstimate=false;
   for(const clause of clauses){
    if(!/[.!。！]["”’')]*\s*$/u.test(clause)||/[?¿？"“«»]/u.test(clause)){precedingEstimate=false;continue;}
    const q=normalizedText(clause);
    if(/\b(?:maybe|might|could be|not sure|not confirmed|hypothetical|quizas|tal vez|podria|sin confirmar|hipotetic\w*)\b/u.test(q)){precedingEstimate=false;continue;}
    const namedEstimate=/\b(?:estimate|estimated|budget|planning figure|planning number|estimacion|estimado|estimada|presupuesto|cifra para planificar)\b/u.test(q);
    const negatedEstimate=/\b(?:not|isn t|no es|no son|no) (?:a |an |the |una |un |el |la )*(?:estimate|estimated|budget|estimacion|estimado|estimada|presupuesto)\b/u.test(q);
    const notBill=/\b(?:not|isn t|no es|no son|no) (?:a |an |the |your |her |his |their |personal |actual |una |la |su |tu |mi )*(?:bill|factura)\b/u.test(q);
    // Only adjacent completed assertions with an explicit anaphoric link count.
    // Never join fragments across caller turns, questions or unrelated claims.
    const linked=/^(?:it\b|it s\b|this\b|that\b|these\b|those\b|esto\b|eso\b|este\b|ese\b|esta\b|esa\b|no es\b|no son\b)/u.test(q);
    if(!negatedEstimate&&notBill&&(namedEstimate||precedingEstimate&&linked)){
     estimate=true;return true;
    }
    precedingEstimate=namedEstimate&&!negatedEstimate;
   }
   return false;
  },
  hints(){return estimate?{previouslyExplained:['estimate_not_bill']}:{};},
  clear(){estimate=false;},
 };
}
