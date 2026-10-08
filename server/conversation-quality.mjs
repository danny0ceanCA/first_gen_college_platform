import {summaryCategories} from './summary-quality.mjs';
import {spokenLanguageFromText} from '../src/voiceLanguage.mjs';

export const qualityAnalysisVersion='conversation-quality-v1';
const topics=new Set(['profile','planning','finance','loans','admissions']);
const languages=new Set(['en','es']);
const failures=new Set(['lookup_failure','guide_update_failed','spoken_language_update_failed','transcription_timeout','response_failed','connection_failure']);
const categories=[...summaryCategories,'repeated_question','clarification_request','language_drift','possibly_unanswered','topic_transition_failure','tool_failure','language_update_failure','reply_failure','transcription_failure','connection_failure'];
const normalize=text=>text.toLowerCase().normalize('NFD').replace(/\p{M}/gu,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const question=text=>/[?¿]/u.test(text)||/^(how|what|when|where|why|can|could|do|does|is|are|como|que|cuando|donde|por que|puedo|cual)\b/.test(normalize(text));
const clarification=text=>/\b(i (?:still )?(?:do not|don t|dont) understand|i m confused|im confused|explain (?:that |it )?(?:again|more simply|differently)|make (?:it |that )?shorter|no (?:lo )?entiendo|estoy confundid[oa]|explica(?:lo|me|melo)? (?:otra vez|mas sencillo|de otra forma)|mas corto)\b/.test(normalize(text));
const inferredLanguage=text=>{
 const a=spokenLanguageFromText(text,'en'),b=spokenLanguageFromText(text,'es');
 return a===b?a:null;
};

function validate(input){
 if(!input||typeof input!=='object')throw new Error('invalid_quality_input');
 if(!Array.isArray(input.turns)||!Array.isArray(input.events??[])||!Array.isArray(input.summaries??[]))throw new Error('invalid_quality_input');
 if(input.turns.length>400||(input.events?.length??0)>1000||(input.summaries?.length??0)>24)throw new Error('quality_input_too_large');
 let size=0;
 for(const turn of input.turns){
  if(!turn||!['user','assistant'].includes(turn.role)||typeof turn.text!=='string'||turn.text.length>12000)throw new Error('invalid_quality_turn');
  size+=turn.text.length;
  if(turn.language!==undefined&&!languages.has(turn.language)||turn.expectedLanguage!==undefined&&!languages.has(turn.expectedLanguage)||turn.topic!==undefined&&!topics.has(turn.topic))throw new Error('invalid_quality_turn_context');
 }
 if(size>450000)throw new Error('quality_input_too_large');
 for(const event of input.events??[]){
  if(!event||typeof event.event!=='string'||event.event.length>80||event.turnIndex!==undefined&&(!Number.isInteger(event.turnIndex)||event.turnIndex<0||event.turnIndex>=input.turns.length))throw new Error('invalid_quality_event');
 }

}

export function analyzeConversationQuality(input){
 validate(input);
 const turns=input.turns,findings=[],events=input.events??[];
 const add=(category,confidence,evidence,reason,turn)=>findings.push({category,confidence,evidence,reason,topic:topics.has(turn?.topic)?turn.topic:'unknown',language:languages.has(turn?.language)?turn.language:'unknown',needsReview:true});
 const questions=new Map();let expected=languages.has(input.language)?input.language:null;
 for(let i=0;i<turns.length;i++){
  const turn=turns[i];
  if(turn.role==='user'){
   expected=turn.expectedLanguage??turn.language??inferredLanguage(turn.text)??expected;
   if(clarification(turn.text))add('clarification_request','high',[{kind:'turn',index:i}],'Explicit request for clarification or simpler wording; this may be normal learning rather than a defect.',turn);
   if(question(turn.text)){
    const key=normalize(turn.text),previous=questions.get(key);
    if(key.length>=12&&previous!==undefined)add('repeated_question','medium',[{kind:'turn',index:previous},{kind:'turn',index:i}],'The same normalized question was asked again. Confirm whether repetition was necessary or caused by confusion.',turn);
    questions.set(key,i);
    const reply=turns.slice(i+1).find(next=>next.role==='assistant'&&next.text.trim());
    if(!reply&&input.complete===true)add('possibly_unanswered','low',[{kind:'turn',index:i}],'No subsequent assistant text in the completed capture. Check for a user-ended call, missing transcription or intentionally postponed answer.',turn);
   }
  }else if(turn.text.trim()){
   const target=turn.expectedLanguage??expected;
   // Inference is conservative: an isolated official English label is not a switch.
   const sentences=turn.text.split(/[.!?]+\s*/u).filter(Boolean);
   const observed=turn.language??inferredLanguage(turn.text);
   const otherSentence=target&&sentences.some(sentence=>{const detected=inferredLanguage(sentence);return detected&&detected!==target;});
   if(target&&(observed&&observed!==target||otherSentence))add('language_drift',turn.language?'medium':'low',[{kind:'turn',index:i}],'Assistant language may differ from the established preference. Review mixed-language labels, explicit preferences and detector limitations.',{...turn,language:target});
  }
 }
 for(let i=0;i<events.length;i++){
  const event=events[i];if(!failures.has(event.event))continue;
  const turn=turns[event.turnIndex]??{topic:event.mode,language:event.language};
  const category=event.event==='lookup_failure'?'tool_failure':event.event==='transcription_timeout'?'transcription_failure':event.event==='connection_failure'?'connection_failure':event.event==='spoken_language_update_failed'?'language_update_failure':event.event==='guide_update_failed'?'topic_transition_failure':'reply_failure';
  add(category,'high',[{kind:'event',index:i}],`Recorded technical event: ${event.event}. This does not establish the cause or whether recovery succeeded.`,turn);
 }
 const transcriptAvailable=turns.length>0;
 return {version:qualityAnalysisVersion,synthetic:input.synthetic===true,coverage:{transcriptAvailable,turns:turns.length,userTurns:turns.filter(t=>t.role==='user').length,assistantTurns:turns.filter(t=>t.role==='assistant').length,events:events.length,summaries:(input.summaries??[]).length,complete:input.complete===true},findings,
  counts:Object.fromEntries(categories.map(category=>[category,findings.filter(f=>f.category===category).length])),
  limitations:['Signals require review; there is no overall quality score or automatic model update.','Summary prose cannot establish repetition, comprehension, response language or whether a spoken question was answered.','Semantic answer correctness, paraphrased repetition, pronunciation and audio cutoffs require further evaluation.']};
}

export function qualityTrends(reports){
 if(!Array.isArray(reports)||reports.length>10000||reports.some(r=>r?.version!==qualityAnalysisVersion||typeof r.synthetic!=='boolean'||typeof r.coverage?.transcriptAvailable!=='boolean'||!Array.isArray(r.findings)||r.findings.length>2000||r.findings.some(f=>!categories.includes(f?.category)||!topics.has(f.topic)&&f.topic!=='unknown'||!languages.has(f.language)&&f.language!=='unknown')))throw new Error('invalid_quality_reports');
 const groups=new Map();
 for(const report of reports){
  const seen=new Set();
  for(const finding of report.findings){
   const key=JSON.stringify([finding.category,finding.topic,finding.language]);
   const group=groups.get(key)??{category:finding.category,topic:finding.topic,language:finding.language,signals:0,conversationsFlagged:0};
   group.signals++;if(!seen.has(key)){group.conversationsFlagged++;seen.add(key);}groups.set(key,group);
  }
 }
 return {version:qualityAnalysisVersion,synthetic:reports.every(r=>r.synthetic),conversations:reports.length,transcriptsAvailable:reports.filter(r=>r.coverage.transcriptAvailable).length,summariesChecked:reports.filter(r=>r.summaryReview?.status==='checked').length,groups:[...groups.values()].sort((a,b)=>b.conversationsFlagged-a.conversationsFlagged||b.signals-a.signals||a.category.localeCompare(b.category)),limitations:'Counts describe analyzed conversations, not all users. Missing or summary-only captures are not treated as successful conversations.'};
}
