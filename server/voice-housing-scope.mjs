import {requestedResearchAspects} from '../src/researchQuestion.mjs';
import {validatedResearchFindings} from '../src/researchFindings.mjs';
import {hasCoaBreakdown} from './coa-evidence.mjs';

// Reusing a qualified published total is distinct from certifying that its
// components reconcile. Keep every source limitation; never upgrade status.
export const housingBudgetAvailable=f=>hasCoaBreakdown(f)||
 f?.aspect==='total_budget'&&f.status==='partial'&&f.sourceIds?.length>0&&
 Number.isFinite(f.budget?.total)&&f.budget.components.length>0;
export const housingBudgetCovers=(f,choice)=>housingBudgetAvailable(f)&&
 (costHousingScenario(f.subject+' '+f.answer)===choice||choice==='renting'&&f.budget?.housing==='off_campus');

export function housingResultForChoice(result,choice){
 if(!['renting','with_family'].includes(choice))return result;
 const findings=validatedResearchFindings(result);
 if(!findings.some(f=>housingBudgetCovers(f,choice)))return result;
 const selected=findings.filter(f=>!f.budget||(choice==='renting'?
  f.budget.housing!=='with_family':!['renting','off_campus'].includes(f.budget.housing)));
 if(selected.length===findings.length)return result;
 const lead=selected[0],qualification=[...new Set(selected.map(f=>f.qualification).filter(Boolean))].join(' ');
 return {...result,text:selected.map(f=>f.answer+'\n'+f.qualification).join('\n'),
  voiceBrief:{...result.voiceBrief,answer:lead.answer,qualification,
   nextStep:/\b(?:rent|alquil)\w*\b.*\b(?:family|familia|relatives)\w*\b/iu.test(result.voiceBrief?.nextStep||'')?'':result.voiceBrief?.nextStep||'',findings:selected}};
}

const fold=text=>String(text||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[-–—]/gu,' ');
const offCampus=/\b(?:off campus|fuera del campus)\b/u;
const withFamily=/\b(?:with (?:his |her |their |the |my )?(?:family|parents|relatives)|at home|con (?:su |sus |mi |mis |la )?(?:familia|familiares|padres)|en casa)\b/u;
const renting=/\b(?:rent(?:s|ing)?|alquil(?:a|ar|ara|ando)|rent(?:a|ar|ara|ando))\b/u;
const onCampus=/\b(?:on campus|(?<!off )campus apartments?|residence halls?|dorms?|en el campus|dentro del campus|apartamentos? universitarios|residencias universitarias)\b/u;
const uncertainty=/\?|\b(?:if|whether|might|may|could|considering|unsure|undecided|would|quizas|tal vez|si|podria|opciones)\b|\b(?:not|no)\s+(?:planning|living|moving|renting|going to|viv\w*|va a vivir|planea vivir|alquil\w*)\b/u;

export function costHousingScenario(question){
 const text=fold(question).replace(/\bnot (?:on campus|campus housing)\b|\bno (?:en el campus|alojamiento universitario)\b/gu,'');
 const affirmative=text.replace(/\b(?:without|not (?:living |staying )?with) (?:parents|family|relatives)\b|\bsin (?:los )?(?:padres|familiares)\b/gu,'');
 if(onCampus.test(text))return;
 const rentalRejected=/\b(?:renting|rental|alquilar|alquiler|rentar)(?: (?:off campus|fuera del campus))?\s+(?:(?:is|was|would be)\s+not|isn['’]?t|wasn['’]?t|no es|no sera)\b/u.test(text);
 const rentalWording=/\b(?:in (?:a |an )?rental(?: (?:apartment|home|house))?|(?:rent|renting) (?:an? )?(?:apartment|house|home)|en (?:un |una )?(?:alquiler|renta|(?:apartamento|vivienda|casa)(?: (?:de alquiler|alquilad[oa]|rentad[oa]))))\b/u.test(text);
 const rentalNegated=/\b(?:not|never) (?:living |staying )?in (?:a |an )?rental|\bnot (?:planning to |going to )?rent(?:ing)?\b|\bno (?:va a |planea )?(?:alquilar|rentar)\b|\bno (?:vive |vivira |esta |estara )?en (?:un |una )?(?:alquiler|renta|apartamento|vivienda|casa)/u.test(text);
 if(offCampus.test(text)&&rentalWording&&!rentalRejected&&!rentalNegated&&!withFamily.test(affirmative))return 'renting';
 if(!rentalRejected&&!rentalNegated&&offCampus.test(text)&&/\b(?:renting off campus|off campus (?:and )?(?:renting|rental|apartments?)|alquil\w* fuera del campus|apartamento fuera del campus|fuera del campus (?:y )?(?:alquilando|alquiler|rentando)|off campus.{0,5}(?:without|not with) (?:parents|family))\b/u.test(text)&&!withFamily.test(affirmative))return 'renting';
 if(offCampus.test(text)&&!withFamily.test(affirmative))return 'off_campus';
 if(withFamily.test(affirmative)&&!rentalWording&&!renting.test(affirmative))return 'with_family';
}

// A short affirmation is a housing choice only after a direct rental question.
// A choice between renting and relatives cannot be answered with "yes".
export function asksToConfirmRenting(transcript){
 const question=String(transcript||'').trim().split(/(?<=[.!?])\s+/u).at(-1);
 const text=fold(question).replace(/^¿/u,'');
 return /^(?:(?:is (?:he|she|the student) planning to|(?:are you|are they) planning to|will (?:you|he|she|they)) rent (?:an? )?(?:off campus )?apartment(?: off campus)?|(?:va a|vas a|planea|planeas) (?:alquilar|rentar) (?:un )?apartamento(?: fuera del campus)?)\?$/u.test(text);
}

export function confirmsRenting(transcript){
 return /^(?:yes|yeah|yep|si|renting|alquilando|rentando)$/u.test(fold(transcript).trim().replace(/[.!]+$/u,''));
}

export function studentHousingPlan(brief,studentId,history=[]){
 if(!studentId||brief?.studentId!==studentId)return undefined;
 // Only project an affirmative student-specific plan. A campus budget example
 // mentioning off-campus housing is not evidence of anyone's living plans.
 const name=fold(brief.profile?.name).split(/\s+/u)[0];
 if(!name)return undefined;
 const escaped=name.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&');
 const plan=new RegExp(String.raw`\b${escaped}(?:['’]s (?:off campus living (?:situation|plan)|plan to live)|\s+(?:(?:(?:is |will be |would be )?(?:not )?)(?:planning to live|living|going to live|moving)|plans to live|will live|lives|plans to rent|will rent|(?:no )?(?:vive|vivira|va a vivir|planea vivir|alquilara)))\b`,'u');
 const records=[...(brief.records||[]),...history.filter(item=>item.studentId===studentId)
  .map(({summary,date})=>({content:summary,date}))].sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
 for(const record of records){
  for(const sentence of fold(record.content).split(/(?<=[.!?;])\s+/u)){
   const match=plan.exec(sentence);
   if(!match)continue;
   const scoped=sentence.slice(match.index);
   if(!offCampus.test(scoped)&&!withFamily.test(scoped)&&!onCampus.test(scoped)&&!renting.test(scoped))continue;
   if(uncertainty.test(sentence)||onCampus.test(scoped)||withFamily.test(scoped)&&renting.test(scoped))return undefined;
   if(withFamily.test(scoped))return 'with_family';
   if(renting.test(scoped)&&offCampus.test(scoped))return 'renting';
   if(offCampus.test(scoped))return 'off_campus';
  }
 }
}

const scenario={
 off_campus:['off-campus housing, arrangement unspecified','alojamiento fuera del campus, modalidad sin especificar'],
 renting:['renting off campus','alquiler fuera del campus'],
 with_family:['living with family','vivir con familiares'],
};

export function scopeFinanceHousing(question,plan,language){
 if(!scenario[plan])return question;
 const text=fold(question),aspects=requestedResearchAspects(question);
 // A generic backend paraphrase must not erase the student's specific plan.
 // Explicit alternatives still belong to the caller and are not overwritten.
 if(costHousingScenario(question)==='off_campus'&&['renting','with_family'].includes(plan)){
  return question.replace(/off[- ]campus(?: housing)?(?:,? arrangement unspecified)?|(?:alojamiento )?fuera del campus(?:,? modalidad sin especificar)?/giu,scenario[plan][language==='es'?1:0]);
 }
 if(onCampus.test(text)||withFamily.test(text)||renting.test(text)||offCampus.test(text)||
  (!aspects.includes('total_budget')&&!aspects.includes('housing')&&
   (aspects.length||!(/\b(?:costs?|price|costos?|cuesta|precios?)\b/u.test(text)))))return question;
 const suffix=language==='es'?' Modalidad de vivienda: ':' Housing scenario: ';
 const detail=suffix+scenario[plan][language==='es'?1:0]+'.';
 const scoped=question.replace(/\b(?:Housing arrangement unspecified|Modalidad de vivienda sin especificar)[.;]\s*/iu,'').trim();
 return scoped.length+detail.length<=3000?scoped+detail:question;
}
