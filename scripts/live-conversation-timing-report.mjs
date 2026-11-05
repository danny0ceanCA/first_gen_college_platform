import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

// Offline analysis of the voice harness export. Never output transcripts,
// identifiers, prompts, request bodies or student data. Stages may overlap.
const terminal=new Set(['response.completed','response.failed','response.cancelled','response.incomplete']);
const paths=new Map([['/api/profile-voice','context'],['/api/live-memory','memory'],['/api/conversation-history','history'],['/api/student-memory','memory'],['/api/education-planning','research']]);
const tools=new Set(['switch_college_guide','highlight_binder_topics','recall_student_context','lookup_education_planning','lookup_financial_aid','lookup_college_applications','read_research_details','request_conversation_target','set_conversation_language','select_conversation_student']);
const round=n=>Math.round(n);
export function liveConversationTiming(report){
 return {calls:(report.runs||[]).map(run=>({language:['en','es'].includes(run.language)?run.language:'unknown',...(typeof run.brief==='boolean'?{variant:run.brief?'brief':'full-report'}:{}),failed:!!run.failure,
  callbackTimeouts:(report.diagnostics||[]).filter(e=>e.run===run.id&&e.event==='voice.control.callback_timeout').length,
  research:(report.research||[]).filter(e=>e.run===run.id&&e.kind==='research-finished').map(e=>({durationMs:round(e.durationMs),httpStatus:e.status})),
  delivery:(run.events||[]).filter(e=>e.type==='origen.research.supplied').map(e=>{
   const ack=e.jobId&&(run.events||[]).find(a=>a.type==='origen.research.context_acknowledged'&&a.jobId===e.jobId&&a.at>=e.at);
   return {evidenceFormat:['brief-v1','full-report'].includes(e.evidenceFormat)?e.evidenceFormat:'unknown',packetCount:e.packetCount??null,contextBytes:e.contextBytes??null,acknowledgmentMs:ack?.durationMs??null};
  }),turns:(run.steps||[]).map((step,index)=>{
  const start=step.after??step.startedAt,end=step.at??run.steps[index+1]?.startedAt??run.finishedAt??Infinity;
  const inside=e=>Number.isFinite(e.at)&&e.at>=start&&e.at<=end;
  const native=(report.native||[]).filter(e=>e.run===run.id),events=[...(run.events||[]),...native].filter(inside),sent=(run.sent||[]).filter(inside),starts=new Map(),modelSpans=[],pending=new Set();
  for(const envelope of events){const e=envelope.type==='response.event'?envelope.event:null;if(!e)continue;
   if(e.type==='response.created'){starts.set(e.response.id,envelope.at);pending.add(e.response.id);}
   if(terminal.has(e.type)&&starts.has(e.response?.id)){
    modelSpans.push({startMs:round(starts.get(e.response.id)-step.audioEnded),durationMs:round(envelope.at-starts.get(e.response.id)),outcome:e.type.slice(9)});pending.delete(e.response.id);starts.delete(e.response.id);
   }
  }
  const groups=[];
  const speechType=events.some(e=>e.type==='session.output_transcript.delta')?'session.output_transcript.delta':'response.output_audio_transcript.delta';
  for(const e of events)if(e.type===speechType){
   if(!groups.length||e.at-groups.at(-1).end>1600)groups.push({start:e.at,end:e.at,length:0});
   groups.at(-1).end=e.at;groups.at(-1).length+=String(e.delta||'').length;
  }
  // A timing aid, not an assertion that words were useful or heard. Review audio.
  const afterInput=groups.filter(g=>g.start>=step.audioEnded);
  const candidate=afterInput.find(g=>g.length>90)||afterInput.at(-1);
  const updates=sent.filter(e=>e.type==='session.update').map(e=>{
   const ack=events.find(a=>a.type==='session.updated'&&(a.client_event_id||a.event_id)===e.event_id&&a.at>=e.at);
   return {startMs:round(e.at-step.audioEnded),...(ack?{durationMs:round(ack.at-e.at)}:{unmatched:true})};
  });
  const audible=(run.soundStarts||[]).find(at=>Number.isFinite(at)&&at>=step.audioEnded&&at<=end);
  const lookups=events.filter(e=>e.type==='response.event'&&e.event?.type==='response.output_item.done'&&['lookup_financial_aid','lookup_college_applications','lookup_education_planning'].includes(e.event.item?.name));
  return {turn:index+1,firstAudibleMs:audible===undefined?null:round(audible-step.audioEnded),freshResearchCalls:lookups.length,firstTranscriptMs:groups.length?round(groups[0].start-step.audioEnded):null,candidateTranscriptMs:candidate?round(candidate.start-step.audioEnded):null,backendResponses:modelSpans,unfinishedBackendResponses:pending.size,
   http:(report.requests||[]).filter(e=>inside(e)&&paths.has(e.path)&&Number.isFinite(e.durationMs)&&e.action!=='revision').map(e=>({stage:paths.get(e.path),startMs:round(e.at-step.audioEnded),durationMs:round(e.durationMs),status:e.status})),
   contextUpdates:updates,toolCalls:events.filter(e=>e.type==='response.event'&&e.event?.type==='response.output_item.done'&&e.event.item?.type==='function_call').map(e=>({tool:tools.has(e.event.item.name)?e.event.item.name:'workflow',startMs:round(e.at-step.audioEnded)}))};
 })})),limitations:['Boundaries are the end of synthetic input WAV playback, not production microphone VAD.','First audible is observed sound, which can be an acknowledgment; it is not proof of a useful answer.','Candidate transcript is a length/gap heuristic; inspect the recording for substantive speech. It is not first audible sound.','HTTP and model stages can overlap; do not sum them as a critical path.','Context acknowledgment is injection confirmation, not spoken or heard delivery.','Unmatched context acknowledgments are not assigned to another update.','Small local samples do not establish production percentiles.']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const report=JSON.parse(await readFile(process.argv[2],'utf8'));console.log(JSON.stringify(liveConversationTiming(report),null,2));
}
