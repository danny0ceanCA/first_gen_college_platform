import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {once} from 'node:events';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {setTimeout as pause} from 'node:timers/promises';
import {loadEnv} from 'vite';
import WebSocket from 'ws';
import {voiceSession} from '../../server/profile-voice.mjs';
import {studentLiveSession} from '../../server/student-live-session.mjs';
import {voiceControlSession} from '../../server/voice-control.mjs';
import {createDecisionsClient} from '../decisions/client.mjs';
import {createResearchTask,auditResearchTask,researchTaskRelationship} from '../../src/researchTask.mjs';
import {researchEvidence} from '../../src/voiceResearchProgress.mjs';
import {createScout} from './scout.mjs';
import {createPauseDelivery} from './pause-delivery.mjs';
import {createSupplementStore} from './supplement-store.mjs';
import {scenarios,supplementalCatalog} from './scenarios.mjs';
import {campaignBudget,campaignRoot} from './campaign.mjs';
import {researchGap} from './gap-research.mjs';
import {wav} from '../../scripts/evaluate-live-voice-prompts.mjs';
import {researchSpeechObservation} from '../../src/researchSpeechObservation.mjs';
import {createPrimaryDeliveryGate} from './primary-delivery-gate.mjs';
import {createCallerTimeline,observedTopicChange} from './call-timeline.mjs';

const ids=process.argv.find(x=>x.startsWith('--scenarios='))?.slice(12).split(',');
const revision=process.argv.find(x=>x.startsWith('--revision='))?.slice(11)||'initial';
const arms=process.argv.find(x=>x.startsWith('--arms='))?.slice(7).split(',');
const selector=process.argv.find(x=>x.startsWith('--selector='))?.slice(11)||'choice';
const scoutMode=process.argv.includes('--rules')?'rules':'decisions',replaySupplement=process.argv.includes('--replay-supplement');
const cases=scenarios.filter(s=>!ids||ids.includes(s.id)).flatMap((s,index)=>['en','es'].flatMap(language=>(index%2?['on','off']:['off','on']).filter(arm=>!arms||arms.includes(arm)).map(arm=>({id:`${s.id}-${language}-${arm}`,s,language,arm}))));
if(!process.argv.includes('--execute')){console.log(JSON.stringify({campaignRoot,revision,capUsd:20,calls:cases.map(c=>c.id),turnsPerCall:3,realConcurrentSupplement:'costs on, both languages; other calls replay this campaign verified public research at its measured duration',productionAccess:false}));process.exit(0);}
const budget=await campaignBudget(),root=resolve(campaignRoot,'voice-'+revision),callerRoot=resolve(campaignRoot,'caller-audio');
await Promise.all([mkdir(root,{recursive:true}),mkdir(callerRoot,{recursive:true})]);
const loaded={...loadEnv('development',process.cwd(),''),...process.env},env={OPENAI_API_KEY:loaded.OPENAI_API_KEY};assert(env.OPENAI_API_KEY);
const auth={Authorization:'Bearer '+env.OPENAI_API_KEY},ttsPromises=new Map();
const safeError=e=>String(e?.code||e?.message||e).replace(/(?:sk-|ek_)[a-zA-Z0-9_-]+/gu,'[redacted]').slice(0,180);
const significant=pcm=>{for(let i=0;i+1<pcm.length;i+=2)if(Math.abs(pcm.readInt16LE(i))>350)return true;return false;};
const boundary=(pcm,last=false)=>{for(let i=last?pcm.length-2:0;i>=0&&i+1<pcm.length;i+=last?-2:2)if(Math.abs(pcm.readInt16LE(i))>350)return i;return -1;};
async function evidence(s,role,language){
 for(const folder of ['research-current','research-retest','research'])try{return JSON.parse(await readFile(resolve(campaignRoot,folder,`${s.id}-${role}-${language}.json`),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 throw Error('missing_research_fixture');
}
async function synthesize(text){
 const key=createHash('sha256').update(text).digest('hex'),path=resolve(callerRoot,key+'.pcm');
 if(ttsPromises.has(key))return ttsPromises.get(key);
 const promise=(async()=>{try{return await readFile(path);}catch(e){if(e.code!=='ENOENT')throw e;}
  assert(text.length<950);await budget.reserve('caller_tts',.015,{textHash:key});
  const r=await fetch('https://api.openai.com/v1/audio/speech',{method:'POST',headers:{...auth,'Content-Type':'application/json'},body:JSON.stringify({model:'tts-1',voice:'alloy',input:text,response_format:'pcm'}),signal:AbortSignal.timeout(25000)});
  assert(r.ok,'caller TTS HTTP '+r.status);const pcm=Buffer.from(await r.arrayBuffer());assert(pcm.length&&pcm.length<48000*35);await writeFile(path,pcm);return pcm;
 })();ttsPromises.set(key,promise);return promise;
}
const supplementQuestion=(id,q)=>({costs:/unitrans|yolobus|bus (?:benefit|pass|access)|transit benefit|beneficio.*autob[uú]s|pase.*autob[uú]s/iu,
 applications:/fee.?waiver|exenci[oó]n|exoneraci[oó]n/iu,fafsa:/spanish.language|help.*spanish|spanish.*help|ayuda.*espa[nñ]ol|contact|phone|tel[eé]fono/iu,
 grants:/scam|fraud|estafa|guarantee.*aid|guaranteed.*scholarship|garantiz/iu,esl:/spanish.*(?:help|contact)|(?:contact|help).*spanish|ayuda.*espa[nñ]ol|contacto.*espa[nñ]ol/iu,
 support:/pantry|grocer|food support|food pantry|despensa|alimentos/iu}[id]?.test(q));
const primaryQuestion=(id,q)=>({costs:/cost of attendance|\bcoa\b|total cost|costo (?:total|de asistencia)/iu,applications:/deadline|regular.decision|fecha l[ií]mite|plazo/iu,
 fafsa:/\baccept|acept|\bsteps|\bpasos/iu,grants:/pell|grant.*loan|beca.*pr[eé]stamo/iu,esl:/\btuition|\bfees|matr[ií]cula|\bcosto/iu,support:/first.generation|primera generaci[oó]n/iu}[id]?.test(q));

async function run(c){
 const {s,language,arm}=c,path=resolve(root,c.id+'.json');
 try{return JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 const started=Date.now(),report={id:c.id,scenario:s.id,topic:s.topic,language,arm,revision,startedAt:started,providerEvents:[],applicationEvents:[],appends:[],turns:[],jobs:[],decisions:[],scoutEvents:[],delivery:[],supplementAssessments:[],research:[],errors:[],outputTranscript:'',inputTranscript:'',scope:'fictional student; in-memory jobs; no production database'};
 Object.assign(report,{scoutMode:arm==='on'?scoutMode:'off',selector:arm==='on'?selector:null,replaySupplement});
 let ws,engine,delivery,scout,activeTurn,queued,frameTimer,floorTimer,scoutTimer,checkpointTimer,send=()=>{},ready=false,closed=false,failure,lastSpeechAt=0,speechEnd=0,playbackEnd=0,playbackIdle=true,playbackVersion=0,formalSupplementClaimed=false,sourcePromise;
 const chunks=[],jobs=new Map(),inflight=new Set(),store=createSupplementStore();
 let outputBytes=0,toolCount=0,backendCount=0;
 const at=()=>Date.now()-started;
 const speechEvidence=researchSpeechObservation(),primaryGate=createPrimaryDeliveryGate({log:e=>(report.primaryGate??=[]).push({at:at(),...e})});
 const timeline=createCallerTimeline({overlap:process.argv.includes('--overlap'),initialDelayMs:process.argv.includes('--include-opening')?6000:0});
 report.turnGrouping='scheduled caller windows, not semantic assistant turns';
 report.callerPolicy=process.argv.includes('--overlap')?'overlap_after_audio':'fixed_continuous_timeline';
 function observedRevision(event){
  if(!observedTopicChange(event)||report.topicRevisionAt!==undefined)return;
  report.topicRevisionAt=at();report.topicRevisionEvidence='application_detected';
  scout?.invalidate();delivery?.clear('observed_topic_revision');store.invalidate();
  for(const job of jobs.values())if(job.role==='primary')primaryGate.end(job.id,'observed_topic_revision');
 }
 const [primaryRow,supplementRow]=await Promise.all([evidence(s,'primary',language),evidence(s,'supplement',language)]);
 const completeResearch=()=>sourcePromise??=(async()=>{
  if(s.id==='costs'&&arm==='on'&&!replaySupplement)return researchGap(s.supplement,language,{env,budget,report:report.research,supplemental:true});
  const duration=supplementRow.traces.at(-1)?.durationMs||12000;await pause(duration);return supplementRow.result;
 })();
 const register=p=>{inflight.add(p);void p.finally(()=>inflight.delete(p)).catch(()=>{});return p;};
 try{
  const prompts=[s[language].initial,s[language].followup,s[language].next],audio=await Promise.all(prompts.map(synthesize));
  await budget.reserve('native_live_call',.35,{scenario:c.id,revision,maxWallSeconds:210,maxOutputPcmSeconds:240,maxBackendResponses:6,models:'gpt-live-1 + gpt-6-luna default; research separately reserved'});
  const input={mode:s.primary.mode,role:s.id==='esl'?'student':'parent',language,studentId:'fictional-student',targetConfirmed:true,voiceProtocol:'live-v1',voiceControlProtocol:'server-v1',experience:{usedVoice:true},profile:{id:'fictional-student',name:'Fictional Student'}};
  const config=voiceSession(input,{OPENAI_MODEL_VOICE:'gpt-live-1'});config.language=language;
  config.tools=config.tools.filter(t=>['lookup_financial_aid','lookup_college_applications','lookup_education_planning','read_research_details','cancel_background_research'].includes(t.name));
  const session=studentLiveSession(config,input,[],{});session.audio.format={type:'audio/pcm',rate:24000};session.delegation.responses.max_output_tokens=1400;
  assert.equal(session.delegation.responses.model,'gpt-6-luna');
  // Same setup in both arms. No instruction forces a supplemental fact or
  // blocks the primary assistant from researching it independently.
  const setup='This isolated evaluation uses fictional records. '+(process.argv.includes('--include-opening')?'Preserve the existing opening behavior. ':'The student is already selected; begin with the caller question without an opening recap. ')+
   'Keep the existing warm voice and conversational behavior. Use official research when needed and reuse still-current results. Do not invent unknown facts.';
  report.openingIncluded=process.argv.includes('--include-opening');
  session.instructions+='\n'+setup;session.delegation.responses.instructions+='\n'+setup;
  assert(Buffer.byteLength(JSON.stringify(session))<70000);
  ws=new WebSocket('wss://api.openai.com/v1/live/sessions',{headers:auth,handshakeTimeout:12000});
  send=e=>{if(ws.readyState!==WebSocket.OPEN)return;const event={event_id:randomUUID(),...e};if(/session\.(?:thinking|commentary|instructions)\.append$/u.test(event.type))report.appends.push({at:at(),...event});ws.send(JSON.stringify(event));};
  checkpointTimer=setInterval(()=>{void writeFile(resolve(root,c.id+'.partial.json'),JSON.stringify(report,(key,value)=>key==='chunks'?undefined:value,2)).catch(()=>{});},10000);
  const provider={get readyState(){return ws.readyState;},send:raw=>send(JSON.parse(raw))};
  delivery=arm==='on'?createPauseDelivery({send,log:e=>{report.delivery.push({at:at(),...e});observedRevision(e);},supplementalOnly:true,
   canDeliver:()=>primaryGate.canDeliver()&&!formalSupplementClaimed,
   prepare:event=>{const judged=store.evaluate(event.result,{language,excludeKey:'supplement'});report.supplementAssessments.push({at:at(),phase:'delivery',...judged,result:undefined});return judged.accepted?{...event,result:judged.result}:null;}}):undefined;
  const client=createDecisionsClient({apiKey:env.OPENAI_API_KEY,timeoutMs:8000});
  scout=createScout({mode:arm==='on'?scoutMode:'current',decisionStrategy:selector,catalog:supplementalCatalog,isKnown:id=>id===s.supplement.id&&formalSupplementClaimed,
   client:{async evaluate(body){await budget.reserve('decisions',.02,{scenario:c.id,revision});const start=Date.now();const result=await client.evaluate(body);report.decisions.push({at:at(),durationMs:Date.now()-start,...result});return result;}},
   log:e=>report.scoutEvents.push({at:at(),...e}),research:candidate=>{if(candidate.id!==s.supplement.id)throw Error('scenario_candidate_mismatch');return register(completeResearch());},
   accept:async(candidate,result)=>{
    if(!result)return false;
    report.supplementReadyAt=at();store.put('supplement',result);
    const judged=store.evaluate(result,{language,excludeKey:'supplement'});report.supplementAssessments.push({at:at(),phase:'source',...judged,result:undefined});
    if(!judged.accepted||formalSupplementClaimed)return false;
    delivery.ready({jobId:'supplement',question:candidate[language],language,evidenceVersion:1,result:researchEvidence(judged.result,false)},{key:c.id+':'+candidate.id+':0'});return true;
   }});
  engine=voiceControlSession({provider,config,scope:{sessionId:randomUUID(),studentId:'fictional-student',confirmed:true},researchDeliveryV2:true,visualCards:true,
   log:()=>{},emit:e=>{
    if(e.type==='input_audio_buffer.speech_started')delivery?.callerStarted();
    if(e.type==='conversation.item.input_audio_transcription.completed'){speechEvidence.callerStopped();delivery?.callerStopped(e.transcript);}
    if(e.type==='origen.research.speech_observed'){
     const observation=speechEvidence.finish({forced:e.speechOutcome==='forced_flush',playbackObserved:e.playbackObserved});
     primaryGate.speech({...e,evidenceVersion:jobs.get(e.jobId)?.deliveredVersion},observation.completedText);
    }
    observedRevision(e);
    report.applicationEvents.push({at:at(),...e});
    if(e.type==='origen.control.tool_call'&&++toolCount>6)failure='tool_call_limit';
   },jobRequest:async(method,id,query)=>{
    if(method==='POST'){
     if(jobs.size>=3)throw Error('research_job_limit');
     const supplemental=supplementQuestion(s.id,query.question||''),combined=supplemental&&primaryQuestion(s.id,query.question||'');
     const role=supplemental&&!combined?'supplement':'primary',job={id:randomUUID(),role,query,at:Date.now(),cancelled:false};jobs.set(job.id,job);
     report.jobs.push({id:job.id,at:at(),role,query});
     if(role==='supplement'){formalSupplementClaimed=true;delivery?.clear('formal_lookup_owns');job.promise=register(completeResearch().then(result=>{job.result=result;job.done=true;return result;}).catch(error=>{job.done=true;job.error=safeError(error);return null;}));}
     else{
      const task=createResearchTask({...query,institution:query.institution||s.primary.institution});
      if(combined||researchTaskRelationship(query.question,createResearchTask({question:s.primary[language],institution:s.primary.institution}))==='changed'){
       job.promise=register(researchGap({id:'additional-'+job.id,mode:query.mode,institution:query.institution||'',en:query.question,es:query.question},language,{env,budget,report:report.research}).then(result=>{job.result=result;job.done=true;return result;}).catch(error=>{job.done=true;job.error=safeError(error);return null;}));job.dynamic=true;
      }else{job.result=primaryRow.result;job.trace=primaryRow.traces.at(-1);job.task=task;}
      primaryGate.start(job.id,{question:query.question,language});
     }
     return {id:job.id,status:'queued'};
    }
    const job=jobs.get(id);if(!job)throw Error('unknown_job');
    if(method==='DELETE'){job.cancelled=true;job.completed=true;if(job.role==='primary')primaryGate.end(job.id,'cancelled');return {id,status:'cancelled'};}
    if(job.cancelled)return {id,status:'cancelled'};
    const elapsed=Date.now()-job.at;
    const complete=job.promise?job.done:elapsed>=(job.trace?.durationMs||12000);
    if(complete){if(!job.completed){job.completed=true;if(job.result)store.put(job.role+'-'+id,job.result);
      if(job.role==='primary'){
       job.deliveredVersion=job.initialDelivered?2:1;
       if(job.result)primaryGate.ready(job.id,{version:job.deliveredVersion,result:job.result});else primaryGate.end(job.id,'research_failed');
      }}
     return {id,status:job.result?'completed':'failed',...(job.result?{result:job.result}:{})};}
    const initial=job.trace?.initial;if(initial&&elapsed>=initial.durationMs){
     if(job.role==='primary'&&!job.initialDelivered){job.initialDelivered=true;job.deliveredVersion=1;primaryGate.ready(job.id,{version:1,result:initial.result});}
     return {id,status:'running',result:initial.result};
    }
    return {id,status:'running'};
   }});
  ws.on('error',e=>failure=safeError(e));ws.on('close',()=>{closed=true;queued?.reject(Error('connection_closed'));queued=null;});
  ws.on('message',raw=>{try{
   const e=JSON.parse(raw),timestamp=Date.now();
   report.providerEvents.push({at:at(),type:e.type,...(e.client_event_id?{clientEventId:e.client_event_id}:{}),...(e.type==='response.event'?{nestedType:e.event?.type}:{}),...(e.type==='session.usage.updated'?{usage:e.usage}:{})});
   if(e.type==='session.started'){ready=true;report.providerModel=e.session?.model;report.providerVoice=e.session?.audio?.output?.voice;}
   if(e.type==='response.event'&&e.event?.type==='response.created'&&++backendCount>6)failure='backend_response_limit';
   if(e.type==='session.input_transcript.delta'){speechEvidence.caller(e);report.inputTranscript+=e.delta;if(activeTurn){activeTurn.inputTranscript+=e.delta;activeTurn.transcripts.push({speaker:'caller',delta:e.delta,at:at(),start_ms:e.start_ms,end_ms:e.end_ms});}}
   if(e.type==='session.output_transcript.delta'){speechEvidence.output(e);report.outputTranscript+=e.delta;if(activeTurn){activeTurn.outputTranscript+=e.delta;activeTurn.transcripts.push({speaker:'assistant',delta:e.delta,at:at(),start_ms:e.start_ms,end_ms:e.end_ms});}}
   if(e.type==='session.output_audio.delta'){
    const pcm=Buffer.from(e.delta,'base64');chunks.push(pcm);activeTurn?.chunks.push(pcm);outputBytes+=pcm.length;
    const start=Math.max(timestamp,playbackEnd);playbackEnd=start+pcm.length/48;
    if(significant(pcm)){lastSpeechAt=timestamp;timeline.audio(timestamp-sessionAt);const first=start+boundary(pcm)/48,end=start+(boundary(pcm,true)+2)/48;speechEnd=Math.max(speechEnd,end);activeTurn?.audio.push({receivedAt:at(),simulatedStartAt:first-started,simulatedEndAt:end-started});}
    if(outputBytes>48000*240)failure='output_audio_limit';
   }
   if(e.type==='error')report.errors.push(e.code??e.error?.code??'provider_error');
   if(e.type==='session.closed')report.finalUsage=e.usage??e.session?.usage;
   delivery?.receive(e);engine.receive(e);
  }catch(e){failure=safeError(e);}});
  const wait=async(fn,ms,label)=>{const end=Date.now()+ms;while(!fn()){if(failure||closed||Date.now()>end)throw Error(label+': '+(failure||'timeout'));await pause(50);}};
  await once(ws,'open');send({type:'session.start',session});await wait(()=>ready,15000,'startup');engine.start();const sessionAt=Date.now();
  frameTimer=setInterval(()=>{
   if(ws.readyState!==WebSocket.OPEN)return;const frame=Buffer.alloc(4800),q=queued;
   if(q){const end=Math.min(q.offset+frame.length,q.pcm.length);q.pcm.copy(frame,0,q.offset,end);if(q.last>=q.offset&&q.last<end)q.turn.callerEndedAt=at()+(q.last-q.offset+2)/48;q.offset=end;}
   send({type:'session.input_audio.append',audio:frame.toString('base64')});
   if(q&&q.offset>=q.pcm.length){queued=null;q.resolve();}
  },100);
  floorTimer=setInterval(()=>{const idle=Date.now()>speechEnd+100;if(idle!==playbackIdle){playbackIdle=idle;playbackVersion++;}engine.playback({idle:playbackIdle,version:playbackVersion});delivery?.playback({idle:playbackIdle});if(Date.now()-sessionAt>210000){failure='call_time_limit';queued?.reject(Error(failure));queued=null;ws.terminate();}},100);
  while(!timeline.finished(Date.now()-sessionAt)){
   if(failure||closed)throw Error(failure||'connection_closed');
   const i=timeline.claim(Date.now()-sessionAt);if(i===null){await pause(50);continue;}
   if(activeTurn){const first=activeTurn.audio.find(a=>a.receivedAt>=activeTurn.callerEndedAt);activeTurn.firstAudioMs=first?first.receivedAt-activeTurn.callerEndedAt:null;activeTurn.elapsedMs=at()-activeTurn.startedAt;}
   const turn={kind:['initial','followup','topic_switch'][i],prompt:prompts[i],startedAt:at(),inputTranscript:'',outputTranscript:'',transcripts:[],audio:[],chunks:[]};report.turns.push(turn);activeTurn=turn;
   const pcm=Buffer.concat([Buffer.alloc(9600),audio[i],Buffer.alloc(48000)]),last=9600+boundary(audio[i],true);
   await new Promise((resolve,reject)=>{queued={pcm,offset:0,last,turn,resolve,reject};});
   timeline.end(i,Date.now()-sessionAt);
   if(i===0)scoutTimer=setTimeout(()=>register(scout.observe({language,turns:[{role:'user',text:turn.inputTranscript}],knownTaskIds:formalSupplementClaimed?[s.supplement.id]:[],primaryResearch:[...jobs.values()].map(j=>({question:j.query.question,requirements:createResearchTask(j.query).requirements,status:j.completed?'completed':'running'}))}).then(r=>report.scoutResult=r)),350);
  }
  if(activeTurn){const first=activeTurn.audio.find(a=>a.receivedAt>=activeTurn.callerEndedAt);activeTurn.firstAudioMs=first?first.receivedAt-activeTurn.callerEndedAt:null;activeTurn.elapsedMs=at()-activeTurn.startedAt;}
  await wait(()=>Date.now()>speechEnd+650,20000,'terminal audio drain');
 }catch(error){report.failure=safeError(error);}
 finally{
  clearTimeout(scoutTimer);scout?.close();clearInterval(frameTimer);clearInterval(floorTimer);clearInterval(checkpointTimer);delivery?.close();
  try{if(ws?.readyState===WebSocket.OPEN){send({type:'session.close'});await pause(1000);}}catch(e){report.cleanupError=safeError(e);}
  try{engine?.close();}catch(e){report.cleanupError=safeError(e);}ws?.terminate();
  await Promise.allSettled([...inflight]);
  for(const turn of report.turns){if(turn.chunks?.length)await writeFile(resolve(root,c.id+'-'+turn.kind+'.wav'),wav(Buffer.concat(turn.chunks)));delete turn.chunks;}
 }
 report.elapsedMs=at();report.audioPcmSeconds=outputBytes/48000;report.backendResponses=backendCount;report.playbackEvidence='Actual provider PCM and transcript, simulated playback clock; no human microphone or browser-speaker verification';
 if(chunks.length)await writeFile(resolve(root,c.id+'.wav'),wav(Buffer.concat(chunks)));
 await writeFile(path,JSON.stringify(report,null,2));return report;
}
let index=0;const reports=[];
async function consume(){while(index<cases.length){const c=cases[index++];const r=await run(c);reports.push(r);console.log(JSON.stringify({id:r.id,failure:r.failure,errors:r.errors,scout:r.scoutResult,jobs:r.jobs.length,supplement:r.supplementAssessments.map(x=>({phase:x.phase,accepted:x.accepted,reason:x.reason})),turns:r.turns.map(t=>({kind:t.kind,firstAudioMs:t.firstAudioMs,text:t.outputTranscript})),accountedUsd:budget.total()}));}}
try{const finished=await Promise.allSettled([consume(),consume()]);await writeFile(resolve(root,'summary.json'),JSON.stringify({reports:reports.map(r=>({id:r.id,failure:r.failure})),accountedUsd:budget.total()},null,2));for(const r of finished)if(r.status==='rejected')throw r.reason;}finally{await budget.close();}
