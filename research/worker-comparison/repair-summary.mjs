import {readFile,writeFile,readdir} from 'node:fs/promises';
const root='output/worker-validation-repair-20261111';
const selections=JSON.parse(await readFile(root+'/selection.json','utf8'));
const research=JSON.parse(await readFile(root+'/research.json','utf8'));
const ledger=JSON.parse(await readFile(root+'/budget.json','utf8'));
const selection=[];
for(const language of ['en','es'])for(const mode of ['rules','decisions']){
 const rows=selections.filter(r=>r.language===language&&r.mode===mode),positive=rows.filter(r=>r.expected!=='none'),negative=rows.filter(r=>r.expected==='none');
 selection.push({language,mode,usefulTasks:positive.filter(r=>r.accepted===r.expected).length,positiveCases:positive.length,unwantedTasks:negative.filter(r=>r.accepted!=='none').length,negativeCases:negative.length,rawCorrectChoices:mode==='decisions'?rows.filter(r=>r.rawResponse?.response?.answers?.[0]?.choice===r.expected).length:null,modelRequests:rows.filter(r=>r.rawResponse).length,medianMs:rows.map(r=>r.durationMs).sort((a,b)=>a-b)[Math.floor(rows.length/2)]});
}
const calls=[];for(const name of await readdir(root+'/voice')){
 if(!/^(current|rules|decisions)-(en|es)\.json$/u.test(name))continue;
 const r=JSON.parse(await readFile(root+'/voice/'+name,'utf8'));
 const first=r.turns[0],followup=r.turns[1],last=r.turns[2];
 let assembled='',factAt=null;for(const e of first.transcriptEvidence||[]){if(e.speaker!=='assistant')continue;assembled+=e.delta;if(factAt===null&&/own (?:StudentAid(?:\s|\.|dot)*gov )?account|propia cuenta|cuenta (?:propia|en StudentAid)/iu.test(assembled))factAt=e.receivedAt;}
 const eventSent=r.outboundAppends.filter(e=>e.type==='session.thinking.append');
 calls.push({arm:r.arm,language:r.language,failure:r.failure||null,errors:r.errors,firstAudioMs:first.firstAudioMs,firstOwnAccountTranscriptMs:factAt===null?null:factAt-first.callerEndedAt,followupAudioMs:followup?.firstAudioMs,formalResearchRequests:r.jobs.length,scoutResult:r.scoutResult,scoutEvents:r.scoutEvents,decisionsRequests:r.decisions.length,scoutContextSent:!!r.quietScoutContextSent,quietAppendCount:eventSent.length,initialTranscript:first.outputTranscript,followupTranscript:followup?.outputTranscript,newTopicTranscript:last?.outputTranscript,initialOverlapEstimatedMs:first.overlapEstimatedMs,followupOverlapEstimatedMs:followup?.overlapEstimatedMs,rawFile:name});
}
const schemaResearch=JSON.parse(await readFile(root+'/schema/research.json','utf8'));
const result={schemaResearch:schemaResearch.map(r=>({id:r.id,passes:r.calls,durationMs:r.durationMs,coverage:r.result?.requestCoverage})),selection,research:research.map(r=>({id:r.id,model:r.requests[0]?.data.model,passes:r.calls,durationMs:r.durationMs,coverage:r.result?.requestCoverage,approvedByCoverage:r.approved,verifiedRecordFactCount:r.result?.voiceBrief?.findings?.reduce((n,f)=>n+(f.evidence?.facts?.filter(x=>x.status==='verified').length||0),0)})),calls,accountedAndReservedUSD:ledger.accountedUsd,evidence:'Native provider audio/transcript with generated caller audio; simulated playback; common eight-second replay retrieval delay; no human microphone/browser verification.'};
await writeFile(root+'/comparison.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
