import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {loadEnv} from 'vite';
import {createBudget} from '../../scripts/evaluate-live-voice-prompts.mjs';
import {createDecisionsClient} from '../decisions/client.mjs';
import {createScout,candidates} from './scout.mjs';import {fixtures} from './heldout-fixtures.mjs';
import {processResearchJob} from '../../server/voice-research-worker.mjs';
import {createResearchTask,auditResearchTask} from '../../src/researchTask.mjs';
export const root='output/worker-validation-repair-20261111/schema';
await mkdir(root,{recursive:true});
const ledgerPath='output/worker-validation-repair-20261111/budget.json';let ledger;try{ledger=JSON.parse(await readFile(ledgerPath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;ledger={campaign:'worker-validation-repair-20261111',capUsd:3,entries:[]};}
assert.equal(ledger.campaign,'worker-validation-repair-20261111');assert.equal(ledger.capUsd,3);
export const budget=createBudget(3,ledger.entries,async()=>{ledger.accountedUsd=budget.total();await writeFile(ledgerPath,JSON.stringify(ledger,null,2));});
export const env={...loadEnv('development',process.cwd(),''),...process.env};
export async function paidClient(){
 const client=createDecisionsClient({apiKey:env.OPENAI_API_KEY,timeoutMs:10000});
 return {async evaluate(body){await budget.reserve('decisions',.02,{questions:body.questions.length});return client.evaluate(body);}};
}
const stage=process.argv.find(a=>a.startsWith('--stage='))?.slice(8);
if(stage&&!process.argv.includes('--execute'))throw Error('Use --execute for explicitly approved paid validation.');
if(stage==='selection'){
 const client=await paidClient();let results=[];try{results=JSON.parse(await readFile(root+'/selection.json','utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 for(const f of fixtures)for(const mode of ['current','rules','decisions']){
  if(results.some(r=>r.id===f.id&&r.mode===mode))continue;
  let accepted='none',rawResponse;const started=Date.now();const scout=createScout({mode,client:{async evaluate(body){const r=await client.evaluate(body);rawResponse=r;return r;}},research:async c=>({id:c.id}),accept:async c=>{accepted=c.id;return true;}});
  const observed=await scout.observe(f);scout.close();
  const row={id:f.id,language:f.language,expected:f.expected,mode,accepted,correct:accepted===f.expected,durationMs:Date.now()-started,observed,rawResponse};results.push(row);
  await writeFile(root+'/selection.json',JSON.stringify(results,null,2));console.log(JSON.stringify({id:f.id,mode,accepted,correct:row.correct,durationMs:row.durationMs}));
 }
}
if(stage==='research'){
 let reports=[];try{reports=JSON.parse(await readFile(root+'/research.json','utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 for(const c of candidates.filter(c=>c.id==='fee_waiver'))for(const language of ['en','es']){
  const id=c.id+'-'+language;if(reports.some(r=>r.id===id))continue;
  const input={mode:c.mode,language,institution:c.institution,question:c[language]};input.researchTask=createResearchTask(input);
  const report={id,input,events:[],requests:[],calls:0};let available=true;const started=Date.now();
  const database={query:async(sql,args)=>{
   if(sql.includes('RETURNING id,input')){if(!available)return{rows:[]};available=false;return{rows:[{id,session_id:'fictional-comparison',input}]};}
   if(sql.includes('SET result=$2'))report.initial={atMs:Date.now()-started,result:args[1]};
   if(sql.includes("SET status='completed',result")){report.result=args[1];report.status='completed';}
   if(sql.includes("SET status='failed',result")){report.result=args[1];report.status='failed';}
   return{rows:[{status:'running'}],rowCount:1};
  }};
  await processResearchJob(database,{...env,OPENAI_MODEL_RESEARCH:'gpt-6-luna',OPENAI_MODEL_FINANCE_RESEARCH:'gpt-6-luna',OPENAI_MODEL_ADMISSIONS_RESEARCH:'gpt-6-luna'},{log:e=>report.events.push(e),request:async(url,opts)=>{
   assert.equal(url,'https://api.openai.com/v1/responses');const body=JSON.parse(opts.body);assert.equal(body.model,'gpt-6-luna');assert(body.max_tool_calls<=2&&body.max_output_tokens<=6000);assert(++report.calls<=2);
   const reserved=await budget.reserve('research_pass',.5,{id});const at=Date.now();const response=await fetch(url,opts),data=await response.clone().json();
   report.requests.push({durationMs:Date.now()-at,status:response.status,data});
   if(data.usage)await budget.settle(reserved,(data.usage.input_tokens*2.5+data.usage.output_tokens*10)/1e6+(data.output||[]).filter(o=>o.type==='web_search_call').length*.025);
   return response;
  }});
  report.durationMs=Date.now()-started;report.approved=!!report.result&&auditResearchTask(input.researchTask,report.result).verifiedCount>0;reports.push(report);
  await writeFile(root+'/research.json',JSON.stringify(reports,null,2));console.log(JSON.stringify({id,status:report.status,approved:report.approved,durationMs:report.durationMs,coverage:report.result?.requestCoverage,budget:budget.total()}));
 }
}
