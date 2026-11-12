// Actual research during isolated voice trials. Production parser/validator,
// in-memory queue, public input only. Caller transcript is not sent to search.
import assert from 'node:assert/strict';
import {processResearchJob} from '../../server/voice-research-worker.mjs';
import {createResearchTask} from '../../src/researchTask.mjs';
export async function researchGap(candidate,language,{env,budget,report,onEvent=()=>{},fetchImpl=fetch,supplemental=false}){
 const input={mode:candidate.mode,language,institution:candidate.institution,question:candidate[language]};
 input.researchTask=createResearchTask(input);const started=Date.now();let available=true,result,failed;
 const trace={input,events:[],requests:[],calls:0};report.push(trace);
 const db={query:async(sql,args)=>{
  if(sql.includes('RETURNING id,input')){if(!available)return{rows:[]};available=false;return{rows:[{id:'fictional-gap-'+language,input,session_id:'fictional-gap-call'}]};}
  if(sql.includes('SET result=$2'))trace.initial={durationMs:Date.now()-started,result:args[1]};
  if(sql.includes("SET status='completed',result"))result=args[1];
  if(sql.includes("SET status='failed',result"))failed=args[1];
  return{rows:[{status:'running'}],rowCount:1};
 }};
 await processResearchJob(db,{...env,OPENAI_MODEL_RESEARCH:'gpt-6-luna',OPENAI_MODEL_FINANCE_RESEARCH:'gpt-6-luna',OPENAI_MODEL_ADMISSIONS_RESEARCH:'gpt-6-luna'},{log:e=>{trace.events.push(e);onEvent(e);},request:async(url,options)=>{
  assert.equal(url,'https://api.openai.com/v1/responses');const body=JSON.parse(options.body);
  if(supplemental){
   body.instructions+='\nThis is one optional supplemental answer, not a new primary report. Prefer one short complete practical fact with its material access/eligibility condition together. Preserve actual year/population and unknowns. Keep the typed fact and its qualification self-contained; never leave an important condition only in a sibling fact. Aim for a value under 180 characters and a qualification under 120 when accurate. Use more facts or longer text when necessary for correctness. Never cut a word/sentence to meet a length target or imply individual eligibility. Do not restate unrelated primary figures.';
   options={...options,body:JSON.stringify(body)};
  }
  assert.equal(body.model,'gpt-6-luna');assert(body.max_tool_calls<=2&&body.max_output_tokens<=6000);assert(++trace.calls<=2);
  const reservation=await budget.reserve('live_gap_research',.5,{candidate:candidate.id,language,pass:trace.calls}),at=Date.now();
  const response=await fetchImpl(url,options),data=await response.clone().json();trace.requests.push({durationMs:Date.now()-at,httpStatus:response.status,data});
  if(data.usage)await budget.settle(reservation,(data.usage.input_tokens*2.5+data.usage.output_tokens*10)/1e6+(data.output||[]).filter(o=>o.type==='web_search_call').length*.025);
  return response;
 }});
 trace.durationMs=Date.now()-started;trace.result=result;trace.failure=failed;
 if(!result)throw Error('gap_research_unavailable');
 return result;
}
