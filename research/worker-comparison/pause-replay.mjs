// Offline prefix replay only. It answers when the FINAL delivery policy would
// request an update on recorded native timelines, not what new speech would
// sound like. Stop at the first changed outbound event; never pretend recorded
// later speech was generated in response to the new policy.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {createPauseDelivery} from './pause-delivery.mjs';
import {researchEvidence} from '../../src/voiceResearchProgress.mjs';
import {candidates} from './scout.mjs';
const root=resolve('output/worker-pause-delivery-20261111');
const cached=JSON.parse(await readFile('output/worker-useful-gap-20261111/cached-research.json','utf8'));
const rows=[];
for(const language of ['en','es']){
 const report=JSON.parse(await readFile(resolve(root,'voice-final','decisions-'+language+'.json'),'utf8'));
 const oldFirstAppend=report.outboundAppends.find(e=>e.type==='session.thinking.append');
 let time=0,sequence=0,audioEnd=-Infinity,stopped=false;
 const scheduled=new Map(),sent=[],logs=[];
 const adapter=createPauseDelivery({now:()=>time,id:()=>`replay-${++sequence}`,send:e=>{sent.push({at:time,...e});},log:e=>logs.push({at:time,...e}),
  schedule:(fn,ms)=>{const key=++sequence;scheduled.set(key,{at:time+ms,fn});return key;},cancel:key=>scheduled.delete(key)});
 const events=[];
 for(const turn of report.turns){
  events.push({at:turn.startedAt-report.startedAt,run:()=>adapter.callerStarted()});
  const lastInput=Math.max(0,...turn.transcriptEvidence.filter(e=>e.speaker==='caller').map(e=>e.receivedAt-report.startedAt));
  events.push({at:Math.max(turn.callerEndedAt-report.startedAt+1000,lastInput+800),run:()=>adapter.callerStopped(turn.inputTranscript)});
  for(const e of turn.transcriptEvidence)events.push({at:e.receivedAt-report.startedAt,run:()=>adapter.receive({type:e.speaker==='assistant'?'session.output_transcript.delta':'session.input_transcript.delta',delta:e.delta,start_ms:e.start_ms,end_ms:e.end_ms})});
  for(const e of turn.audioObservations)events.push({at:e.receivedAt-report.startedAt,run:()=>audioEnd=Math.max(audioEnd,e.simulatedEndAt-report.startedAt)});
 }
 events.push({at:report.scoutAcceptedAt,run:()=>adapter.ready({jobId:'scout',question:candidates.find(c=>c.id==='transit')[language],language,result:researchEvidence(cached[language].result,false),evidenceVersion:1},{key:'transit'})});
 events.sort((a,b)=>a.at-b.at);let index=0;
 const advance=target=>{while(true){const next=[...scheduled].filter(([,e])=>e.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;time=next[1].at;scheduled.delete(next[0]);next[1].fn();}time=target;};
 const prefixEnd=oldFirstAppend?.at??report.elapsedMs;
 for(let tick=0;tick<=prefixEnd;tick+=100){
  while(index<events.length&&events[index].at<=tick){advance(events[index].at);events[index++].run();}
  adapter.playback({idle:tick>audioEnd+100});advance(tick);
  if(sent.length){stopped=true;break;}
 }
 const sentInRecordedPrefix=!!sent.length;
 // If the new policy defers where the old one injected context, later native
 // behavior is no longer comparable. A quiet continuation is explicitly a
 // synthetic condition, not recorded speech from the changed policy.
 if(!sent.length){adapter.playback({idle:true});advance(prefixEnd+4000);}
 const outbound=sent[0];
 rows.push({language,sourceReadyAtMs:report.scoutAcceptedAt,finalFirstOutboundAtMs:outbound?.at,finalFirstOutboundType:outbound?.type,
  sourceToOutboundMs:outbound?.at-report.scoutAcceptedAt,bytes:outbound?Buffer.byteLength(outbound.content):null,
  fact:outbound?.content,oldQuietContextAtMs:oldFirstAppend?.at,logs,stoppedAtFirstPolicyDivergence:stopped,
  sentInRecordedPrefix,continuation:sentInRecordedPrefix?'none':'Synthetic continued silence after old/new policy divergence; no later recorded native events were used.',
  evidence:'Recorded native prefix + simulated audio floor. New dispatch is a counterfactual; no new provider receipt, speech or playback is asserted.'});
 adapter.close();
}
const result={moduleSha256:createHash('sha256').update(await readFile('research/worker-comparison/pause-delivery.mjs')).digest('hex'),rows};
await writeFile(resolve(root,'final-policy-prefix-replay.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(rows.map(({language,sourceReadyAtMs,finalFirstOutboundAtMs,finalFirstOutboundType,sourceToOutboundMs,bytes})=>({language,sourceReadyAtMs,finalFirstOutboundAtMs,finalFirstOutboundType,sourceToOutboundMs,bytes})),null,2));
