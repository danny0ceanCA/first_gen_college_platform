import {readFile,readdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {campaignRoot} from './campaign.mjs';
import {scenarios} from './scenarios.mjs';
const read=async path=>JSON.parse(await readFile(path,'utf8'));
const median=values=>{const a=values.filter(Number.isFinite).sort((a,b)=>a-b);return a.length?(a[Math.floor((a.length-1)/2)]+a[Math.floor(a.length/2)])/2:null;};
const completeSentence=t=>/[.!?。！？]["”’')]*\s*$/u.test(t||'');
const summary={budget:await read(resolve(campaignRoot,'budget.json')),sources:[],classifications:[],voice:[]};
for(const s of scenarios)for(const language of ['en','es'])for(const role of ['primary','supplement']){
 const name=`${s.id}-${role}-${language}.json`,initial=await read(resolve(campaignRoot,'research',name)),current=await read(resolve(campaignRoot,'research-current',name));
 summary.sources.push({scenario:s.id,language,role,initialStatus:initial.audit?.status,currentStatus:current.audit?.status,missing:current.audit?.missing.map(x=>x.key),replayIncomplete:current.replayIncomplete,
  sourceFile:current.sourceFile,sourceDurationMs:current.traces.at(-1)?.durationMs});
}
for(const revision of ['r2','r3','r4']){
 const rows=await Promise.all((await readdir(resolve(campaignRoot,'classification-'+revision))).filter(f=>f.endsWith('.json')).map(f=>read(resolve(campaignRoot,'classification-'+revision,f))));
 summary.classifications.push({revision,cases:rows.length,rawPass:rows.filter(r=>r.pass).length,positiveTotal:rows.filter(r=>r.expected!=='none').length,
  positiveAdmitted:rows.filter(r=>r.expected!=='none'&&r.pass).length,negativeTotal:rows.filter(r=>r.expected==='none').length,
  rawFalsePositiveIds:rows.filter(r=>r.expected==='none'&&!r.pass).map(r=>r.id),missedPositiveIds:rows.filter(r=>r.expected!=='none'&&!r.pass).map(r=>r.id),
  medianApiMs:median(rows.map(r=>r.response?.durationMs)),note:'Raw classifier only. The scout independently blocks explicit refusal, known/pending work and stale revisions before execution.'});
}
const transcript=[];
for(const folder of ['voice-r1','voice-r2','voice-r3-rules','voice-r4-focus']){
 let files;try{files=await readdir(resolve(campaignRoot,folder));}catch(e){if(e.code==='ENOENT')continue;throw e;}
 const rows=await Promise.all(files.filter(f=>f.endsWith('.json')&&!f.endsWith('.partial.json')&&f!=='summary.json').map(f=>read(resolve(campaignRoot,folder,f))));
 for(const r of rows){
  const requests=r.delivery.filter(e=>['inline_commentary_requested','context_published_at_pause'].includes(e.stage));
  summary.voice.push({folder,id:r.id,scenario:r.scenario,language:r.language,arm:r.arm,scoutMode:r.scoutMode||(r.arm==='on'?'decisions':'off'),failure:r.failure,providerErrors:r.errors,
   turns:r.turns.length,firstAudioMs:r.turns[0]?.firstAudioMs,followupAudioMs:r.turns[1]?.firstAudioMs,
   incompleteBoundaryTurns:r.turns.filter(t=>!completeSentence(t.outputTranscript)).map(t=>t.kind),scout:r.scoutResult,
   primaryJobs:r.jobs.filter(j=>j.role==='primary').length,supplementFormalJobs:r.jobs.filter(j=>j.role==='supplement').length,
   supplementalAccepted:r.supplementAssessments.some(e=>e.phase==='source'&&e.accepted),
   sourceReadyAt:r.supplementReadyAt,requests:requests.map(e=>({stage:e.stage,at:e.at,sourceToRequestMs:e.at-r.supplementReadyAt})),
   appendsAfterTopicChange:r.topicRevisionAt?r.appends.filter(e=>e.at>r.topicRevisionAt&&/session\.(thinking|commentary)\.append/u.test(e.type)).length:null});
  transcript.push(`## ${folder}/${r.id}\n\n${r.failure?'Incomplete trial: '+r.failure:'Trial script completed.'}\n\n`+r.turns.map(t=>`**${t.kind}: caller** ${t.inputTranscript}\n\n**Origen** ${t.outputTranscript}`).join('\n\n'));
 }
}
summary.r1Timings=['en','es'].flatMap(language=>['off','on'].map(arm=>{const rows=summary.voice.filter(r=>r.folder==='voice-r1'&&r.language===language&&r.arm===arm);return {language,arm,calls:rows.length,scriptCompleted:rows.filter(r=>!r.failure).length,medianFirstAudioMs:median(rows.map(r=>r.firstAudioMs)),medianFollowupAudioMs:median(rows.map(r=>r.followupAudioMs))};}));
await writeFile(resolve(campaignRoot,'metrics.json'),JSON.stringify(summary,null,2));
await writeFile(resolve(campaignRoot,'transcript-review.md'),'# Fictional local voice trials\n\nActual provider transcripts; generated caller audio. These are not proof of physical playback or comprehension.\n\n'+transcript.join('\n\n'));
console.log(JSON.stringify({accountedUsd:summary.budget.accountedUsd,callsWithFinalJson:summary.voice.length,failedOrBounded:summary.voice.filter(r=>r.failure).map(r=>r.folder+'/'+r.id),classifications:summary.classifications,r1Timings:summary.r1Timings},null,2));
