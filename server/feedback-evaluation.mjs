import {feedbackCases} from '../evals/conversation-feedback.v1.mjs';
import {analyzeConversationQuality} from './conversation-quality.mjs';
import {createSummaryReviewer} from './summary-quality.mjs';
export function scoreFeedbackCase(expected,observed){
 const wanted=new Set(expected),got=new Set(observed);
 const missed=[...wanted].filter(c=>!got.has(c)),unexpected=[...got].filter(c=>!wanted.has(c));
 return {passed:!missed.length&&!unexpected.length,missed,unexpected,truePositive:[...wanted].filter(c=>got.has(c)).length,falsePositive:unexpected.length,falseNegative:missed.length};
}
function metrics(results){
 const checked=results.filter(r=>r.status==='checked'),sum=key=>checked.reduce((n,r)=>n+(r[key]??0),0);
 const tp=sum('truePositive'),fp=sum('falsePositive'),fn=sum('falseNegative');
 return {total:results.length,checked:checked.length,failed:results.filter(r=>r.passed===false).length,precision:tp+fp?tp/(tp+fp):null,recall:tp+fn?tp/(tp+fn):null};
}
export async function evaluateFeedback({live=false,env={},request=fetch,cases=feedbackCases}={}){
 if(live&&!env.OPENAI_API_KEY)throw Error('Live evaluation requires OPENAI_API_KEY');
 const reviewer=createSummaryReviewer(env,request),results=[];
 for(const c of cases){
  if(c.synthetic!==true)throw Error('Only synthetic evaluation cases are allowed');
  let findings,status='checked';
  if(c.kind==='conversation')findings=analyzeConversationQuality({...c,turns:c.turns.map(t=>({...t,topic:c.topic}))}).findings;
  else if(c.kind==='summary'){
   if(!live){results.push({id:c.id,kind:c.kind,language:c.language,status:'not_run',passed:null});continue;}
   const review=await reviewer(c.summary,c.turns);status=review.status;findings=review.findings??[];
  }else throw Error('Unknown evaluation kind');
  results.push({id:c.id,kind:c.kind,language:c.language,status,...(status==='checked'?scoreFeedbackCase(c.expected,findings.map(f=>f.category)):{passed:false,missed:c.expected,unexpected:[]})});
 }
 const checked=results.filter(r=>r.status==='checked'),total=key=>checked.reduce((n,r)=>n+(r[key]??0),0);
 const tp=total('truePositive'),fp=total('falsePositive'),fn=total('falseNegative');
 return {version:'feedback-evaluation-v1',synthetic:true,live,model:live?(env.OPENAI_MODEL_SUMMARY||env.OPENAI_MODEL_CONVERSATION||'gpt-4.1-mini'):null,createdAt:new Date().toISOString(),total:results.length,checked:checked.length,notRun:results.filter(r=>r.status==='not_run').length,failed:results.filter(r=>r.passed===false).length,precision:tp+fp?tp/(tp+fp):null,recall:tp+fn?tp/(tp+fn):null,byLanguage:Object.fromEntries(['en','es'].map(language=>[language,metrics(results.filter(r=>r.language===language))])),byKind:Object.fromEntries(['conversation','summary'].map(kind=>[kind,metrics(results.filter(r=>r.kind===kind))])),results,limitations:'Synthetic category checks do not measure real-user outcomes, speech audio, pronunciation, latency or independent academic-policy correctness. Offline summary cases are not evaluated.'};
}
