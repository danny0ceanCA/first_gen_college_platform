import {readFile,writeFile} from 'node:fs/promises';
const root='output/worker-useful-gap-20261111';
const cases=[['current','en','voice'],['current','es','voice'],['rules','en','voice'],['rules','es','voice-retest'],['decisions','en','voice-retest'],['decisions','es','voice-retest']];
const calls=[];
for(const [arm,language,folder] of cases){
 const file=`${folder}/${arm}-${language}.json`;let r;try{r=JSON.parse(await readFile(root+'/'+file,'utf8'));}catch(e){if(e.code==='ENOENT')continue;throw e;}
 const first=r.turns[0],text=r.outputTranscript;
 const sent=r.outboundAppends.filter(e=>e.type==='session.thinking.append'),sentIds=new Set(sent.map(e=>e.event_id));
 const acked=new Set(r.providerEvents.filter(e=>e.type==='session.thinking.appended'&&sentIds.has(e.clientEventId)).map(e=>e.clientEventId));
 let accumulated='',factEvent;for(const turn of r.turns)for(const e of turn.transcriptEvidence){if(e.speaker!=='assistant')continue;accumulated+=e.delta;if(!factEvent&&/Aggie\s*Card/iu.test(accumulated))factEvent=e;}
 calls.push({arm,language,file,failure:r.failure||null,errors:r.errors,formalResearchRequests:r.jobs.length,toolNames:r.toolCalls.map(e=>e.item.name),scout:r.scoutResult,scoutEvents:r.scoutEvents,quietScoutContextSent:!!r.quietScoutContextSent,thinkingAppends:sent.length,matchedThinkingAcks:folder==='voice-retest'?acked.size:null,
  firstAudioMs:first.firstAudioMs,followupAudioMs:r.turns[1]?.firstAudioMs,cardFactTranscriptMs:factEvent?factEvent.receivedAt-first.callerEndedAt:null,factAfterContextAppendMs:factEvent&&r.startedAt&&sent[0]?factEvent.receivedAt-r.startedAt-sent[0].at:null,
  mentionsUnitrans:/unitrans/iu.test(text),mentionsYolobus:/yolobus|yolo bus/iu.test(text),mentionsAggieCard:/aggie\s*card/iu.test(text),explicitCardCondition:/valid|vigent|f[ií]sic|undergrad|pregrado/iu.test(text),transcripts:r.turns.map(t=>({kind:t.kind,text:t.outputTranscript,overlapEstimatedMs:t.overlapEstimatedMs})),
  research:r.liveResearch?.map(x=>({cachedReplay:!!x.cachedReplay,durationMs:x.durationMs,passes:x.calls,coverage:x.result?.requestCoverage,sources:x.result?.sources}))});
}
const ledger=JSON.parse(await readFile(root+'/budget.json','utf8'));
const result={campaign:'worker-useful-gap-20261111',calls,accountedAndReservedUSD:ledger.accountedUsd,excluded:['voice/rules-es.json: pending-job harness bug produced an invalid unavailable response','original decisions-en attempt: stopped to prevent more spending with the known harness bug; reservation retained; partial audio retained'],evidenceLimitations:['One trial per language/condition, fixed order, generated caller PCM, real provider output; simulated playback, no physical browser speaker verification.','Original research ran during rules calls. Corrected matched retests replay that same verified public research at its measured duration, avoiding extra searches.','Original rules-en recording has ACK counts/timing only; corrected retests also record client-event IDs for per-packet acknowledgments.','Receipt does not prove played audio or comprehension.']};
await writeFile(root+'/comparison.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
