import {researchTraceData,researchTraceKeys} from './research-trace.mjs';

// Consume the owner-authorized diagnostics response. Never infer heard speech,
// usefulness or semantic success from a provider/job completion flag.
export function researchTraceReport({jobs=[],events=[]}={}){
 return {version:'research-trace-report-v1',jobs:jobs.map(job=>{
  const timeline=events.filter(e=>e.job_id===job.id).sort((a,b)=>Date.parse(a.received_at)-Date.parse(b.received_at)||String(a.received_at).localeCompare(String(b.received_at))||String(a.id).localeCompare(String(b.id)));
  const at=stage=>timeline.filter(e=>e.stage===stage),last=stage=>at(stage).at(-1)?.data||{};
  const counts=(stage,field)=>Object.fromEntries(at(stage).reduce((result,e)=>{const key=e.data?.[field]||'unknown';result.set(key,(result.get(key)||0)+1);return result;},new Map()));
  const queued=Date.parse(job.queued_at),started=Date.parse(job.started_at);
  const queueMs=Number.isFinite(queued)&&Number.isFinite(started)&&started>=queued?started-queued:null;
  return {jobId:job.id,sessionId:job.session_id,...researchTraceKeys(job.session_id,job.id),status:job.status,queueMs,
   workerCompletedMs:last('completed').durationMs??null,initialPublishedMs:last('initial_published').durationMs??null,
   attempts:at('attempt_finished').map(e=>researchTraceData(e.data)),
   recovery:last('completed').recoveryStatus??null,
   deliveryStages:counts('delivery','deliveryStage'),deliveryReasons:counts('delivery','deliveryReason'),speechObservations:counts('speech_observation','speechOutcome'),
   browserPlaybackReports:at('playback_observation').length,
   diagnosticsDropped:job.diagnostics_dropped||0,
   timeline:timeline.map(e=>({stage:e.stage,observedAt:e.observed_at,receivedAt:e.received_at,data:researchTraceData(e.data)})),
   warnings:[...(job.snapshot_omitted?['A research snapshot exceeded the archive size bound; it was omitted without truncating qualifications.']:[]),...(job.diagnostics_dropped?['Some detailed observations were dropped; absent events are unknown.']:[]),...(!at('speech_observation').length?['No transcript observation is present in this export.']:[]),...(!at('playback_observation').length?['No browser playback report is present in this export.']:[])],
  };
 }),interpretation:'Worker completion, transcript observation, and browser playback reports are separate evidence. Playback reports do not prove the person heard or understood an answer. Compare durations only within their originating component; cross-machine event timestamps are approximate ordering.'};
}
