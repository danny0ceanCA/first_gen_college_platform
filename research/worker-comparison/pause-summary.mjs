import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=resolve('output/worker-pause-delivery-20261111'),attempts=[];
for(const folder of ['voice','voice-fixed','voice-final'])for(const language of ['en','es']){
 const report=JSON.parse(await readFile(resolve(root,folder,'decisions-'+language+'.json'),'utf8'));
 let spoken='',cardAt;
 for(const turn of report.turns)for(const e of turn.transcriptEvidence||[])if(e.speaker==='assistant'){
  spoken+=e.delta;if(cardAt===undefined&&/aggiecard/iu.test(spoken))cardAt=e.receivedAt-report.startedAt;
 }
 const firstAppend=report.outboundAppends.find(e=>e.type==='session.thinking.append');
 const commentary=report.outboundAppends.filter(e=>e.type==='session.commentary.append');
 const ackIds=new Set(report.providerEvents.filter(e=>e.type==='session.thinking.appended').map(e=>e.clientEventId));
 const context=report.outboundAppends.filter(e=>e.type==='session.thinking.append'&&e.content.includes('untrusted-research-evidence'));
 attempts.push({folder,language,failure:report.failure||null,providerErrors:report.errors,sourceReadyAtMs:report.scoutAcceptedAt,
  firstContextAtMs:firstAppend?.at,firstCardCandidateAtMs:cardAt,contextToCardCandidateMs:cardAt===undefined||!firstAppend?null:cardAt-firstAppend.at,
  sourceToCardCandidateMs:cardAt===undefined?null:cardAt-report.scoutAcceptedAt,
  commentaryRequests:commentary.map(e=>e.at),contextPackets:context.length,contextAcks:context.filter(e=>ackIds.has(e.event_id)).length,
  formalJobs:report.jobs.length,scoutOutcome:report.scoutResult,firstAudioMs:report.turns[0]?.firstAudioMs,
  turns:report.turns.map(t=>({kind:t.kind,transcript:t.outputTranscript,firstAudioMs:t.firstAudioMs})),
  evidence:'Card candidate is a transcript marker, not a semantic success grade. Native PCM retained; simulated playback only.'});
}
const budget=JSON.parse(await readFile(resolve(root,'budget.json'),'utf8'));
const replay=JSON.parse(await readFile(resolve(root,'final-policy-prefix-replay.json'),'utf8'));
await writeFile(resolve(root,'comparison.json'),JSON.stringify({budget:{capUsd:budget.capUsd,accountedUsd:budget.accountedUsd},attempts,replay,
 status:'Final inline policy has offline verification only; all six paid attempts preceded that final change. Further paid validation awaits authorization.'},null,2));
console.log(JSON.stringify(attempts.map(({folder,language,failure,sourceToCardCandidateMs,contextToCardCandidateMs,commentaryRequests})=>({folder,language,failure,sourceToCardCandidateMs,contextToCardCandidateMs,commentaryRequests})),null,2));
