import {pathToFileURL} from 'node:url';
import {agentFixture} from './test-fixture.mjs';
import {runAgent} from './agent.mjs';
export async function syntheticDiagnosis(){
 const f=await agentFixture();try{
  const broker=await f.start();let step=0,observed=[];
  return await runAgent(broker,async({context})=>{
   if(step===0){step++;return {type:'tool',name:'get_timeline',arguments:{operationId:f.scope.operations[0]}};}
   if(step===1){observed=context.at(-1).result.data.verifiedFacts.filter(e=>e.event==='summary.save.finished'&&e.attributes.outcome==='failed').map(e=>e.event_id);step++;return {type:'tool',name:'read_source',arguments:{revision:f.revision,path:'server/summary.mjs'}};}
   return {type:'report',report:{status:'diagnosis',suspectedFailure:observed.length?'storage-failure':'insufficient-evidence',observedEvents:observed,competingExplanations:['connection-failure'],missingEvidence:['missing-client-receipt'],reproduction:'summary-save-failure',patchAreas:['server/summary.mjs'],tests:['voice-summary'],uncertainty:'medium'}};
  });
 }finally{await f.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{const result=await syntheticDiagnosis();process.stdout.write(JSON.stringify({mode:'synthetic_scripted_agent',...result})+'\n');}catch{process.stderr.write('Synthetic diagnosis failed.\n');process.exitCode=1;}}
