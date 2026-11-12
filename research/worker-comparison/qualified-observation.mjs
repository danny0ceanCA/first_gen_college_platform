import {researchAnswerOverlap,researchScopeCompatible,researchFindingHasOnlyUnverifiedFacts,researchLimitationOverlap} from '../../src/researchDiscussion.mjs';
import {findingSubjectMentioned} from '../../src/researchFindings.mjs';
import {researchSpokenFinding} from '../../src/researchAnswerDelivery.mjs';

const fold=text=>String(text||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/\[\d+\]/gu,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const negative=text=>/\b(?:no|not|never|without|cannot|can t|isn t|aren t|don t|doesn t|sin|nunca)\b/u.test(fold(text));
const uncertain=text=>/\b(?:might|maybe|could be|not verified|not confirmed|checking|verifying|will check|going to check|quizas|tal vez|podria|sin verificar|sin confirmar|revisando|verificando|voy a revisar)\b/u.test(fold(text));
const clauses=text=>String(text||'').split(/(?<=[.!?;。！？])\s+/u).filter(s=>s.trim());
const statements=text=>clauses(text).filter(s=>/[.!。！]["”’')]*\s*$/u.test(s)&&!/[?¿？"“«»]/u.test(s)&&!uncertain(s));
function said(source,spoken){
 const target=fold(source);if(!target)return true;
 return spoken.some(s=>negative(source)===negative(s)&&
  ((' '+fold(s)+' ').includes(' '+target+' ')||researchAnswerOverlap(source,s)));
}

// Conservative duplicate/coverage evidence, not a semantic judge, comprehension
// score, or proof of physical playback. Unknown paraphrases stay unconfirmed.
// A fact's condition and the finding-wide limitation are separate obligations.
export function qualificationsObserved(finding,text){
 const spoken=statements(text);
 return [finding.qualification,...(finding.evidence?.facts||[]).map(f=>f.qualification)]
  .filter(Boolean).every(q=>clauses(q).every(clause=>said(clause,spoken)));
}
export function qualifiedFindingCoverage(finding,text,{question='',language='en'}={}){
 const scopeCompatible=findingSubjectMentioned(finding.subject,text)&&researchScopeCompatible(finding,text);
 if(!scopeCompatible)return {factObserved:false,qualificationObserved:false,confirmed:false};
 if(researchFindingHasOnlyUnverifiedFacts(finding)){
  const gap=researchLimitationOverlap(finding,text,true);
  return {factObserved:gap,qualificationObserved:gap,confirmed:gap};
 }
 const spoken=statements(text),view=researchSpokenFinding(finding,{question,language});
 const factObserved=researchAnswerOverlap(view.answer,spoken.join(' ')),qualificationObserved=qualificationsObserved(finding,text);
 return {factObserved,qualificationObserved,confirmed:factObserved&&qualificationObserved};
}
export const qualifiedFindingObserved=(finding,text,options)=>qualifiedFindingCoverage(finding,text,options).confirmed;
