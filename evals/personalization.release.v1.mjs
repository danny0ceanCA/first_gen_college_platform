import {personalizationCatalog} from './personalization.cases.v1.mjs';

// The original 20 cases remain unchanged for matched comparisons. Additional
// cases exercise actual spoken/tool outcomes, not just prompt construction.
export const releaseCatalog={
 version:'personalization-release-v1',synthetic:true,
 cases:[...personalizationCatalog.cases,...['en','es'].flatMap(language=>[
  {id:`failed-save-${language}`,language,mode:'planning',critical:true,
   prompt:language==='en'?'Remember that I need morning classes.':'Recuerda que necesito clases por la mañana.',
   expectedBehavior:['Inject a failed write, then an unknown timeout. Neither permits a successful-save claim.','Inspect the binder before an explicit retry; exactly one confirmed record after success.']},
  {id:`durable-action-${language}`,language,mode:'admissions',critical:true,
   prompt:language==='en'?'Add email my counselor to my next steps.':'Agrega escribir a mi consejera a mis próximos pasos.',
   expectedBehavior:['Persist the explicitly accepted action once, as not-started.','End the call, reopen the binder and begin a second call: the same action remains incomplete.','Acknowledge only after a committed tool response; retain record/version evidence.']},
  {id:`deferred-opening-${language}`,language,mode:'planning',critical:false,
   prompt:language==='en'?'I want to discuss nearby programs today.':'Hoy quiero hablar de programas cercanos.',
   expectedBehavior:['Seed one deferred action, one active action and a confirmed preference for short examples.','Follow the current priority; do not keep raising the deferred task or re-ask known profile facts.','Keep parent aspirations distinct from the student’s preference.']},
  {id:`spoken-correction-${language}`,language,mode:'planning',critical:true,
   prompt:language==='en'?'I now work mornings, not evenings. How does that change the options?':'Ahora trabajo por la mañana, no por la tarde. ¿Cómo cambia eso las opciones?',
   expectedBehavior:['Seed an old evening-work constraint. Immediately follow the spoken correction.','Do not claim a durable update unless explicitly requested and successfully saved.','Correct then delete the saved detail during the call; after reconnection it must not recur.']},
 ])],
};

export function releaseRubric(base){return {
 ...base,version:'origen-personalization-rubric-v1',
 dimensions:[...base.dimensions,'memoryRelevance','correctionHandling','unnecessaryQuestions','actionPersistence','conversationalFlow'],
 thresholds:{...base.thresholds,maxP95RetrievalMs:1000,maxMeanSessionCostUSD:0.50,minimumRecallAtFive:0.90},
 thresholdStatus:'adopted-for-engineering-evaluation-2026-10-18',
 adoption:'Retain guidance-v1 mean 1.8/2, critical score 2/2, first audio p95 8000ms, research limit 8. Add retrieval p95 1000ms, zero unnecessary repeated questions, and mean $0.50 per completed session including failed attempts. These are release criteria, not measured performance or authorization to spend.',
 requiredEvidence:'Matched baseline/candidate live synthetic speech, named human listening reviews, dated budget approval before first attempt, provider usage/pricing including failures/retries, and rollback/device evidence. Production release remains a separate decision.',
};}
