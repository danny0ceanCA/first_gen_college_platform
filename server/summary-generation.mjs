import {providerOperation} from './observability/dependencies.mjs';
import {narrativeSummaryInstructions} from './summary-style.mjs';

// Shared by interactive saves and durable recovery. No second summary contract.
export async function generateNarrativeSummary(env,input,request=fetch,log=()=>{}){
 if(!env.OPENAI_API_KEY)throw Object.assign(new Error('missing_api_key'),{status:503});
 const model=env.OPENAI_MODEL_SUMMARY||env.OPENAI_MODEL_CONVERSATION||'gpt-4.1-mini';
 const started=Date.now();
 const response=await providerOperation('summary.generate',request,{model})('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model,store:false,max_output_tokens:900,instructions:narrativeSummaryInstructions(input),input:JSON.stringify(input.turns)}),signal:AbortSignal.timeout(45000)});
 log({event:'upstream_response',operation:'conversation_summary',httpStatus:response.status,upstreamRequestId:response.headers?.get('x-request-id')||undefined});
 if(!response.ok)throw new Error('summary_unavailable');
 const data=await response.json();
 if(data.status&&data.status!=='completed')throw new Error('incomplete_summary');
 const summary=(data.output||[]).flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('');
 if(!summary.trim())throw new Error('empty_summary');
 log({event:'summary.generate.finished',outcome:'completed',durationMs:Date.now()-started});
 return {summary:summary.slice(0,4000),data,response};
}
