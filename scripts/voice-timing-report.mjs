import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {enumFields,numericFields} from '../server/observability/event-catalog.mjs';
import {contextStages} from '../server/voice-context-timing.mjs';
// Reads an existing private-capture export or JSONL. Output contains no words,
// student identities, tool arguments, prompts or provider IDs.
export function timingRows(input){
 const records=Array.isArray(input)?input:input.events||[];
 return records.flatMap(record=>{
  const data=record.data||record;
  const row=data.type==='diagnostic'&&data.event==='voice_timing'?data.details:record.event==='voice_timing'?record:null;
  if(!row||!enumFields.timingStage.includes(row.timingStage))return [];
  const safe={};
  for(const key of ['timingStage','timingOutcome','boundary','language','mode','routingPolicy','routingObservation'])if(enumFields[key]?.includes(row[key]))safe[key]=row[key];
  for(const key of ['observedDelegations','turnIndex','offsetMs','durationMs','firstAudioMs','answerCandidateMs','candidateAudioMs','boundaryOverlapMs'])if(Number.isFinite(row[key])&&row[key]>=0)safe[key]=Math.min(numericFields[key],row[key]);
  if(row.contextDurations){safe.contextDurations={};for(const key of [...contextStages,'total'])if(Number.isFinite(row.contextDurations[key])&&row.contextDurations[key]>=0)safe.contextDurations[key]=Math.min(600000,row.contextDurations[key]);}
  return [{...safe,session:record.sessionId||record.session_id||'',attempt:record.attemptId||data.attemptId||record.attempt||record.operationId||'unscoped'}];
 });
}
const stats=values=>{const list=values.filter(v=>Number.isFinite(v)&&v>=0).sort((a,b)=>a-b);return {samples:list.length,p50Ms:list.length?list[Math.ceil(list.length*.5)-1]:null,p95Ms:list.length?list[Math.ceil(list.length*.95)-1]:null,maxMs:list.length?list.at(-1):null};};
export function timingReport(input){
 const rows=timingRows(input),turns=rows.filter(r=>r.timingStage==='turn_complete');
 const eligible=r=>r.timingOutcome==='answered_candidate'&&r.boundaryOverlapMs===undefined;
 const usable=turns.filter(eligible);const calls=new Map();for(const row of rows){const key=row.session+'/'+row.attempt;if(!calls.has(key))calls.set(key,calls.size+1);row.callIndex=calls.get(key);}
 rows.sort((a,b)=>a.callIndex-b.callIndex||a.offsetMs-b.offsetMs);
 const stages={};for(const row of rows)if(['backend_model','history_tool','research_tool','tool','context_request','memory_request','research_request','workflow_request'].includes(row.timingStage))(stages[row.timingStage]??=[]).push(row.durationMs);
 const groups={};for(const row of turns){const key=[['en','es'].includes(row.language)?row.language:'unknown',['provider_vad','transcript_quiet_estimate'].includes(row.boundary)?row.boundary:'unavailable'].join('/');(groups[key]??=[]).push(row);}
 const summarize=items=>({turns:items.length,outcomes:Object.fromEntries([...new Set(items.map(r=>r.timingOutcome))].map(k=>[k,items.filter(r=>r.timingOutcome===k).length])),firstAudio:stats(items.filter(eligible).map(r=>r.firstAudioMs)),candidateText:stats(items.filter(eligible).map(r=>r.answerCandidateMs)),candidateAudio:stats(items.filter(eligible).map(r=>r.candidateAudioMs)),overlappingBoundary:items.filter(r=>r.boundaryOverlapMs!==undefined).length,withoutObservedCandidateAudio:items.filter(r=>!Number.isFinite(r.candidateAudioMs)).length});
 const routingGroups={};for(const row of turns){const key=[row.routingPolicy||'unavailable',row.routingObservation||'unavailable',['en','es'].includes(row.language)?row.language:'unknown',row.boundary||'unavailable'].join('/');(routingGroups[key]??=[]).push(row);}
 return {schemaVersion:2,routingGroups:Object.fromEntries(Object.entries(routingGroups).map(([k,v])=>[k,{...summarize(v),observedDelegations:v.reduce((n,r)=>n+(r.observedDelegations||0),0)}])),...summarize(turns),groups:Object.fromEntries(Object.entries(groups).map(([k,v])=>[k,summarize(v)])),stages:Object.fromEntries(Object.entries(stages).map(([k,v])=>[k,stats(v)])),timeline:rows.map(r=>Object.fromEntries(['callIndex','turnIndex','offsetMs','timingStage','durationMs','timingOutcome','boundary','language','mode','contextDurations','routingPolicy','routingObservation','observedDelegations'].filter(k=>r[k]!==undefined).map(k=>[k,r[k]]))),limitations:['Routing counts refer to delegated model responses; permission and evidence HTTP requests can still run.','Routing counts are observed through the turn completion marker. No backend observed is not proof that skipping the backend was appropriate, that all events arrived, or that work cannot arrive later. Routing changes during a turn are grouped as mixed; old or Realtime captures have unavailable routing.','Live speech end is a transcript quiet-window estimate, not measured microphone silence. Answers starting before this estimate are excluded from latency percentiles.','Candidate text is a heuristic; transcript/audio review is required to confirm usefulness.','Audio is sampled approximately every 100 ms and is not proof a human heard it.','Stage times can overlap. Do not add them to derive total latency.','Failures and interrupted/closed turns are excluded from successful latency percentiles and counted separately.',...(usable.length<20?['Fewer than 20 successful turns: percentile estimates are exploratory.']:[])]};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const path=process.argv[2];if(!path)throw Error('Usage: node scripts/voice-timing-report.mjs <capture.json|timing.jsonl>');
 const text=await readFile(path,'utf8');let input;try{input=JSON.parse(text);}catch{input=text.split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));}
 process.stdout.write(JSON.stringify(timingReport(input),null,2)+'\n');
}
