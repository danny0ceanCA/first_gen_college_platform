// Offline replay through the CURRENT production worker. No network, new model
// output, source editing or budget resets. Original recordings stay immutable.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {campaignRoot} from './campaign.mjs';
import {researchGap} from './gap-research.mjs';
import {scenarios} from './scenarios.mjs';
import {createResearchTask,auditResearchTask} from '../../src/researchTask.mjs';
const root=resolve(campaignRoot,'research-current');await mkdir(root,{recursive:true});
for(const s of scenarios)for(const language of ['en','es'])for(const role of ['primary','supplement']){
 const id=`${s.id}-${role}-${language}`;let source,sourceFile;
 for(const folder of ['research-retest','research'])try{sourceFile=resolve(campaignRoot,folder,id+'.json');source=JSON.parse(await readFile(sourceFile,'utf8'));break;}catch(e){if(e.code!=='ENOENT')throw e;}
 if(!source)throw Error('missing_recording');
 const trace=source.traces.at(-1),requests=trace.requests;let index=0,exhausted=false;const traces=[];
 const result=await researchGap(s[role],language,{env:{OPENAI_API_KEY:'offline-replay'},report:traces,
  budget:{reserve:async()=>({}),settle:async()=>{}},fetchImpl:async()=>{
   const r=requests[index++];if(!r){exhausted=true;throw Error('recording_exhausted_no_network_allowed');}
   return new Response(JSON.stringify(r.data),{status:r.httpStatus,headers:{'Content-Type':'application/json'}});
  }}).catch(()=>null);
 const complete=!!result&&!exhausted;
 const row={...source,sourceFile,reparsedAt:new Date().toISOString(),replayIncomplete:!complete,
  replayRequests:index,recordedRequests:requests.length,replayEvents:traces.flatMap(t=>t.events),
  result:complete?result:source.result,
  // Voice replays use the ACTUAL source timings, not the zero-cost parser run.
  traces:[{...trace,...(complete?{result,initial:traces[0]?.initial?{durationMs:trace.initial?.durationMs||trace.durationMs,result:traces[0].initial.result}:undefined}:{})}]};
 row.audit=auditResearchTask(createResearchTask({question:s[role][language],institution:s[role].institution,language}),row.result);
 await writeFile(resolve(root,id+'.json'),JSON.stringify(row,null,2));
 console.log(JSON.stringify({id,replayIncomplete:!complete,status:row.audit.status,verified:row.audit.verifiedCount,required:row.audit.requiredCount}));
}
