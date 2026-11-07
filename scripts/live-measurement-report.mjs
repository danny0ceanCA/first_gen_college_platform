import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const metrics=['durationMs','packetCount','contextBytes','contextAvailable','contextIncluded','inputTokens','outputTokens','reasoningTokens','cachedTokens','voiceSeconds','completedPortions','overlapCount'];
const stages=new Set(['configuration','backend_started','tool_ready','tool_dispatched','backend_finished','research_delivery','context_selection','voice_usage','session_closed','control_closed','research_attempt','speech_observation']);
export function liveMeasurementReport(records){
 const groups=new Map();let accepted=0;
 for(const e of records){
  if(e?.event!=='voice.live.measurement'||!stages.has(e.measurementStage))continue;accepted++;
  const configuration=/^[a-f0-9]{64}$/.test(e.configurationHash)?e.configurationHash:'unavailable';
  const key=JSON.stringify([configuration,e.measurementStage]);
  if(!groups.has(key))groups.set(key,{configuration,stage:e.measurementStage,records:0,failures:0,failureCategories:{},deliveryOutcomes:{},speechOutcomes:{},playbackObservations:{},metrics:{}});
  const group=groups.get(key);group.records++;
  if(['output_limit','incomplete','refusal','provider_error','rate_limited','http_error','invalid_output'].includes(e.failureKind)){group.failures++;group.failureCategories[e.failureKind]=(group.failureCategories[e.failureKind]||0)+1;}
  if(['supplied','context_acknowledged','context_failed','commentary_requested','native_reply_observed','native_portion_observed','enabled','deferred','commentary_acknowledged','delivery_unconfirmed','interrupted','superseded','reply_observed','evidence_overlap_observed','repeat_suppressed'].includes(e.deliveryStage))group.deliveryOutcomes[e.deliveryStage]=(group.deliveryOutcomes[e.deliveryStage]||0)+1;
  if(e.measurementStage==='speech_observation'){
   if(['complete','acknowledgment_overlap','substantive_interruption','uncertain_overlap','forced_flush'].includes(e.speechOutcome))group.speechOutcomes[e.speechOutcome]=(group.speechOutcomes[e.speechOutcome]||0)+1;
   if(typeof e.playbackObserved==='boolean'){
    const state=e.playbackObserved?'activity_observed':'activity_not_observed';
    group.playbackObservations[state]=(group.playbackObservations[state]||0)+1;
   }
  }
  for(const name of metrics)if(Number.isFinite(e[name])&&e[name]>=0){(group.metrics[name]??=[]).push(e[name]);}
 }
 return {acceptedRecords:accepted,groups:[...groups.values()].map(g=>({...g,metrics:Object.fromEntries(Object.entries(g.metrics).map(([k,values])=>{
  values.sort((a,b)=>a-b);const percentile=p=>values[Math.max(0,Math.ceil(values.length*p)-1)];
  return [k,{samples:values.length,p50:percentile(.5),p95:percentile(.95),max:values.at(-1)}];
 }))})),limitations:['Records are observations, not unique sessions or semantic success counts.','Usage snapshots are cumulative; do not sum voice_usage records.','Missing/dropped events are unknown, not zero or success.','Tool dispatch timing ends at application dispatch, not actual service start.','Configuration fingerprints exclude prompts and private context; compare deployment release and library audit separately.','Research worker attempts have separate random run keys and no configuration hash; they are not joined to voice calls.','Quantiles describe the supplied sample only; audio review is required for naturalness.']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(!process.argv[2])throw Error('Usage: node scripts/live-measurement-report.mjs <events.jsonl>');
 const records=[];let malformedLines=0;
 for(const line of (await readFile(process.argv[2],'utf8')).split('\n')){if(!line.trim())continue;try{records.push(JSON.parse(line));}catch{malformedLines++;}}
 process.stdout.write(JSON.stringify({...liveMeasurementReport(records),malformedLines},null,2)+'\n');
}
