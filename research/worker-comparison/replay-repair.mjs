import {readFile,writeFile,mkdir} from 'node:fs/promises';import assert from 'node:assert/strict';
import {processResearchJob} from '../../server/voice-research-worker.mjs';
const root='output/worker-validation-repair-20261111';await mkdir(root,{recursive:true});
const old=JSON.parse(await readFile('output/second-worker-comparison-20261111/research.json','utf8')),reports=[];
for(const original of old){
 const report={id:original.id,events:[],requests:0};let available=true;
 const db={query:async(sql,args)=>{if(sql.includes('RETURNING id,input')){if(!available)return{rows:[]};available=false;return{rows:[{id:original.id,input:original.input,session_id:'fictional-replay'}]};}if(sql.includes("SET status='completed',result"))report.result=args[1];if(sql.includes("SET status='failed',result"))report.failure=args[1];return{rows:[{status:'running'}],rowCount:1};}};
 await processResearchJob(db,{}, {log:e=>report.events.push(e),request:async()=>{const data=original.requests[report.requests++]?.data;assert(data,'offline replay must not create new provider output');return new Response(JSON.stringify(data));}});
 reports.push(report);console.log(JSON.stringify({id:report.id,passes:report.requests,coverage:report.result?.requestCoverage,failure:!!report.failure}));
}
await writeFile(root+'/replay.json',JSON.stringify(reports,null,2));
