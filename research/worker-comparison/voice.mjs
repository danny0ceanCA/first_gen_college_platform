// Paid only with --execute. Fictional records, real native Live/Decisions,
// production voiceControlSession, mocked durable research jobs. No deployments.
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {mkdir,open,readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {resolve} from 'node:path';
import {setTimeout as pause} from 'node:timers/promises';
import {loadEnv} from 'vite';
import WebSocket from 'ws';
import {voiceSession} from '../../server/profile-voice.mjs';
import {studentLiveSession} from '../../server/student-live-session.mjs';
import {voiceControlSession} from '../../server/voice-control.mjs';
import {comparisonUpdateTool,comparisonFindings,comparisonLookup,parseComparisonResearch} from '../../server/voice-comparison-update.mjs';
import {selectResearchReuse} from '../../server/research-reuse.mjs';
import {createDecisionsClient} from '../decisions/client.mjs';
import {createBudget,wav} from '../../scripts/evaluate-live-voice-prompts.mjs';

import {createScout} from './scout.mjs';
import {researchContextPackets} from '../../src/liveResearchContext.mjs';
import {validatedResearchRecord,researchRecordAudit} from '../../src/researchRecord.mjs';
const campaign='second-worker-comparison-20261111',cap=5,fixed=true;
const root=resolve('output',campaign,'voice'),ledgerPath=resolve('output',campaign,'budget.json');
const cases=['current','rules','decisions'].flatMap(arm=>['en','es'].map(language=>({
 id:arm+'-'+language,arm,decisionsEnabled:false,language,mode:'planning',
 initial:language==='es'?'Soy la madre. Estamos haciendo la FAFSA de mi hija dependiente. Ella me mandó ese correo de contribuyente. Lo abrí pero no sé cómo seguir.':'I am the parent. We are doing my dependent child’s FAFSA. She sent me that contributor email. I opened it but do not know what to do next.',
 clear:language==='es'?'¿Debo entrar con mi propia cuenta o con la de mi hija?':'Should I sign in with my own account or my child’s?',
 next:language==='es'?'Dejemos la FAFSA por ahora. Ayúdame a pensar ideas para mi ensayo.':'Let’s leave FAFSA for now. Help me brainstorm ideas for my essay.',
 expectedFact:'Parent uses their own StudentAid.gov account; no credential sharing.',expectedCaveat:'Do not assume a contributor owes payment; preserve official conditions.'
})));
const saved=JSON.parse(await readFile(resolve('output',campaign,'research.json'),'utf8'));
const significant=pcm=>{for(let i=0;i+1<pcm.length;i+=2)if(Math.abs(pcm.readInt16LE(i))>350)return true;return false;};
const boundary=(pcm,last=false)=>{for(let i=last?pcm.length-2:0;i>=0&&i+1<pcm.length;i+=last?-2:2)if(Math.abs(pcm.readInt16LE(i))>350)return i;return -1;};
const safeError=e=>String(e?.code||e?.message||e).replace(/(?:sk-|ek_)[a-zA-Z0-9_-]+/gu,'[redacted]').slice(0,300);
if(!process.argv.includes('--execute')){
 console.log(JSON.stringify({preflight:true,campaign,capUsd:cap,calls:cases.map(s=>({id:s.id,turns:3,expectedFact:s.expectedFact,expectedCaveat:s.expectedCaveat})),research:'isolated in-memory jobs replay public research from this campaign; no new web lookups during voice calls',voice:'native provider audio; generated caller audio; equal 8-second replay source delay; no prepared assistant playback',execute:'node research/worker-comparison/voice.mjs --execute'}));
 process.exit(0);
}
assert(cap>=1,'a new approved budget is required');
await mkdir(root,{recursive:true});
const lock=await open(ledgerPath+'.lock','wx');
let ledger;
try{ledger=JSON.parse(await readFile(ledgerPath,'utf8'));assert.equal(ledger.campaign,campaign);assert.equal(ledger.capUsd,cap);}catch(e){if(e.code!=='ENOENT')throw e;ledger={campaign,capUsd:cap,entries:[]};}
const budget=createBudget(cap,ledger.entries,async()=>{ledger.accountedUsd=budget.total();ledger.updatedAt=new Date().toISOString();await writeFile(ledgerPath+'.tmp',JSON.stringify(ledger,null,2));await rename(ledgerPath+'.tmp',ledgerPath);});
const env={...loadEnv('development',process.cwd(),''),...process.env},key=env.OPENAI_API_KEY;assert(key,'OpenAI key required');
const auth={Authorization:'Bearer '+key};
async function synthesize(text,id){
 await budget.reserve('caller_tts',.015,{scenario:id});
 const r=await fetch('https://api.openai.com/v1/audio/speech',{method:'POST',headers:{...auth,'Content-Type':'application/json'},body:JSON.stringify({model:'tts-1',voice:'alloy',input:text,response_format:'pcm'}),signal:AbortSignal.timeout(18000)});
 assert(r.ok,'caller TTS HTTP '+r.status);const pcm=Buffer.from(await r.arrayBuffer());assert(pcm.length&&pcm.length<48000*20);return pcm;
}
async function run(s){
 const report={scenario:s.id,language:s.language,syntheticResearch:false,researchTransport:'in-memory jobs replay real paid research outputs; no second web lookup',visuals:[],expectedFact:s.expectedFact,expectedCaveat:s.expectedCaveat,backendResponseCount:0,toolCalls:[],toolResults:[],jobs:[],decisions:[],turns:[],errors:[],inputTranscript:'',outputTranscript:'',providerEvents:[],applicationEvents:[],outboundAppends:[]};
 let ws,engine,scout,scoutTimer,backgroundTimer,timer,inputPump,queuedCaller,ready=false,failure=null,closed=false,lastSpeechAt=0,playbackEndAt=0,speechEndAt=0,playbackVersion=0,playbackIdle=true,activeTurn,sessionStartedAt=0;
 const chunks=[],jobs=new Map();let posted=0,formalClaimed=false,backgroundStartedAt=null,backgroundReadyAt=null;const initial=saved.find(r=>r.id==='parent_invitation-'+s.language)?.result,started=Date.now();assert(initial,'reparsed research required');
 try{
  const audio=[];for(const [index,text] of [s.initial,s.clear,s.next].entries())audio.push(await synthesize(text,s.id+'-'+index));
  await budget.reserve('native_live_call',.5,{scenario:s.id,maxWallSeconds:160,maxOutputPcmSeconds:120});
  const underlying=createDecisionsClient({apiKey:key,timeoutMs:1200});let decisionCount=0;
  const comparisonClient={async evaluate(body){if(++decisionCount>2)throw Error('decision_request_limit');await budget.reserve('decision',.025,{scenario:s.id});const at=Date.now();const r=await underlying.evaluate(body);report.decisions.push({durationMs:Date.now()-at,...r.response});return r;}};
  report.arm=s.arm;report.scoutEvents=[];
  const input={mode:s.mode,role:'parent',language:s.language,studentId:'fictional-student',targetConfirmed:true,voiceProtocol:'live-v1',voiceControlProtocol:'server-v1',experience:{usedVoice:true},profile:{id:'fictional-student',name:'Fictional Student'}};
  const config=voiceSession(input,{OPENAI_MODEL_VOICE:'gpt-live-1'});
  config.tools=config.tools.filter(t=>['lookup_college_applications','lookup_education_planning','read_research_details'].includes(t.name));if(s.decisionsEnabled)config.tools.push(comparisonUpdateTool);
  config.language=s.language;
  const session=studentLiveSession(config,input,[],{});session.audio.format={type:'audio/pcm',rate:24000};session.delegation.responses.max_output_tokens=1400;
  const setup='This evaluation uses a fictional caller with no personal student records. The student is already selected. Begin with the first question, without an opening recap. Use the appropriate research tool for official facts. Ordinary follow-ups should use the known findings. Keep the same warm conversational style. Preserve material qualifications; say when requested details remain unverified. Return concise answers.';
  session.instructions+='\n'+setup;session.delegation.responses.instructions+='\n'+setup;
  assert(Buffer.byteLength(JSON.stringify(session))<70000,'session input reservation bound');
  ws=new WebSocket('wss://api.openai.com/v1/live/sessions',{headers:auth,handshakeTimeout:10000});
  const originalSend=ws.send.bind(ws);
  ws.send=(data,...args)=>{try{const e=JSON.parse(data);if(/session\.(?:thinking|commentary|instructions)\.append$/.test(e.type))report.outboundAppends.push({at:Date.now()-started,...e});}catch{}return originalSend(data,...args);};
  const send=(type,fields={})=>{if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type,event_id:randomUUID(),...fields}));};
  const client=createDecisionsClient({apiKey:key,timeoutMs:10000});
  scout=createScout({mode:s.arm,client:{async evaluate(body){await budget.reserve('decisions',.02,{scenario:s.id});const r=await client.evaluate(body);report.decisions.push(r);return r;}},
   log:e=>report.scoutEvents.push({at:Date.now()-started,...e}),
   research:async()=>{backgroundStartedAt=Date.now();backgroundReadyAt=backgroundStartedAt+8000;await pause(8000);return initial;},
   accept:async(candidate,result)=>{
    const ids=new Set(result.sources.map((x,i)=>x.id??i+1));
    const good=result.voiceBrief.findings.filter(f=>f.evidence&&validatedResearchRecord(f.evidence,ids)&&f.evidence.facts.some(x=>x.status==='verified'));
    if(!good.length)return false;
    report.scoutAcceptedAt=Date.now()-started;
    if(!formalClaimed){for(const content of researchContextPackets({question:candidate[s.language],language:s.language,result:{...result,researchPending:false}},'scout-'+s.id))send('session.thinking.append',{delegation_id:null,content});report.quietScoutContextSent=true;}
    return true;
   }});

  engine=voiceControlSession({provider:ws,config,scope:{sessionId:randomUUID(),studentId:'fictional-student',confirmed:true},comparisonClient:s.decisionsEnabled?comparisonClient:undefined,researchDeliveryV2:true,visualCards:true,log:()=>{},
   emit:e=>{report.applicationEvents.push({at:Date.now()-started,type:e.type,...(e.type==='origen.research.delivery'?{deliveryStage:e.deliveryStage,deliveryReason:e.deliveryReason}:{})});
    if(e.type==='origen.visual.research')report.visuals.push({...e,at:Date.now()-started});
    if(e.type==='origen.control.tool_call'){report.toolCalls.push({at:Date.now()-started,item:e.item});if(report.toolCalls.length>6)failure='tool_call_limit';}
    if(e.type==='origen.control.tool_result')report.toolResults.push({at:Date.now()-started,callId:e.callId,durationMs:e.durationMs,output:JSON.parse(e.output)});
   },jobRequest:async(method,id,query)=>{
    if(method==='POST'){
     if(++posted>2)throw Error('unexpected_extra_research');formalClaimed=true;
     const jobId=randomUUID();
     const result=initial;
     assert(result,'research result missing');
     const job={id:jobId,status:'queued',result,readyAt:backgroundReadyAt??Date.now()+8000};jobs.set(jobId,job);
     report.jobs.push({at:Date.now()-started,id:jobId,query,tableSubjects:result.voiceBrief.findings.map(f=>f.subject)});
     return {id:jobId,status:'queued'};
    }
    const job=jobs.get(id);if(!job)throw Error('unknown_job');if(method==='DELETE'){job.status='cancelled';return {id,status:'cancelled'};}
    return {id,status:Date.now()>=job.readyAt?'completed':'running',...(Date.now()>=job.readyAt?{result:job.result}:{})};
   }});
  ws.on('error',e=>{failure=safeError(e);});ws.on('close',()=>{closed=true;queuedCaller?.reject(Error('voice connection closed'));queuedCaller=null;});
  ws.on('message',raw=>{try{
   const e=JSON.parse(raw);report.providerEvents.push({at:Date.now()-started,type:e.type,...(e.type==='response.event'?{nestedType:e.event?.type}:{})});
   if(e.type==='response.event'&&e.event?.type==='response.created'&&++report.backendResponseCount>6){failure='backend_response_limit';ws.terminate();return;}
   if(e.type==='session.started'){ready=true;report.providerModel=e.session?.model;report.providerVoice=e.session?.audio?.output?.voice;}
   if(e.type==='session.input_transcript.delta'){report.inputTranscript+=e.delta;if(activeTurn){activeTurn.inputTranscript+=e.delta;activeTurn.transcriptEvidence.push({speaker:'caller',delta:e.delta,start_ms:e.start_ms,end_ms:e.end_ms,receivedAt:Date.now()});}}
   if(e.type==='session.output_transcript.delta'){report.outputTranscript+=e.delta;if(activeTurn){activeTurn.outputTranscript+=e.delta;activeTurn.transcriptEvidence.push({speaker:'assistant',delta:e.delta,start_ms:e.start_ms,end_ms:e.end_ms,receivedAt:Date.now()});}}
   if(e.type==='session.output_audio.delta'){
    const pcm=Buffer.from(e.delta,'base64');chunks.push(pcm);if(activeTurn)activeTurn.chunks.push(pcm);
    const receivedAt=Date.now(),scheduledAt=Math.max(receivedAt,playbackEndAt);playbackEndAt=scheduledAt+pcm.length/48;
    if(significant(pcm)){
     lastSpeechAt=receivedAt;
     const simulatedStartAt=scheduledAt+boundary(pcm)/48,simulatedEndAt=scheduledAt+(boundary(pcm,true)+2)/48;
     speechEndAt=Math.max(speechEndAt,simulatedEndAt);
     if(activeTurn)activeTurn.audioObservations.push({receivedAt,simulatedStartAt,simulatedEndAt});
    }
    if(chunks.reduce((n,c)=>n+c.length,0)>48000*120)failure='output_audio_limit';
   }
   if(e.type==='session.closed')report.usage=e.usage??e.session?.usage;
   if(e.type==='error')report.errors.push(e.code??e.error?.code??'provider_error');
   engine.receive(e);
  }catch(e){failure=safeError(e);}});
  timer=setInterval(()=>{const idle=Date.now()>speechEndAt+100;if(idle!==playbackIdle){playbackIdle=idle;playbackVersion++;}engine.playback({idle:playbackIdle,version:playbackVersion});if(failure||sessionStartedAt&&Date.now()-sessionStartedAt>160000){failure??='call_time_limit';queuedCaller?.reject(Error(failure));queuedCaller=null;ws.terminate();}},100);
  const until=async(fn,ms,label)=>{const end=Date.now()+ms;while(!fn()){if(failure||closed||Date.now()>end)throw Error(label+': '+(failure||'timeout'));await pause(50);}};
  await once(ws,'open');send('session.start',{session});await until(()=>ready,12000,'startup');engine.start();sessionStartedAt=Date.now();
  // A single microphone clock stays active for the whole call. Context append
  // delivery advances with the Live timeline, including the quiet gaps.
  inputPump=setInterval(()=>{
   if(ws.readyState!==WebSocket.OPEN)return;
   const frame=Buffer.alloc(4800),queued=queuedCaller,sentAt=Date.now();
   if(queued){
    const end=Math.min(queued.offset+frame.length,queued.pcm.length);queued.pcm.copy(frame,0,queued.offset,end);
    if(queued.lastSpeech>=queued.offset&&queued.lastSpeech<end){queued.turn.callerLastFrameSentAt=sentAt;queued.turn.callerEndedAt=sentAt+(queued.lastSpeech-queued.offset+2)/48;}
    queued.offset=end;
   }
   send('session.input_audio.append',{audio:frame.toString('base64')});
   if(queued&&queued.offset>=queued.pcm.length){queuedCaller=null;queued.resolve();}
  },100);
  for(let index=0;index<audio.length;index++){
   if(index===2)scout.invalidate();
   const caller=audio[index],turn={kind:['initial','followup','support'][index],ask:[s.initial,s.clear,s.next][index],inputTranscript:'',outputTranscript:'',transcriptEvidence:[],audioObservations:[],chunks:[],startedAt:Date.now(),toolResultsBefore:report.toolResults.length};report.turns.push(turn);activeTurn=turn;
   const padded=Buffer.concat([Buffer.alloc(9600),caller,Buffer.alloc(48000)]),last=9600+boundary(caller,true);
   await new Promise((resolve,reject)=>{assert(!queuedCaller);queuedCaller={pcm:padded,lastSpeech:last,offset:0,turn,resolve,reject};});
   if(index===0){scoutTimer=setTimeout(()=>{void scout.observe({language:s.language,turns:[{role:'user',text:turn.inputTranscript}],knownTaskIds:formalClaimed?['parent_invitation']:[]}).then(r=>report.scoutResult=r);},400);}
   await until(()=>turn.audioObservations.some(o=>o.receivedAt>=turn.callerEndedAt),24000,'post-caller native audio');
   await until(()=>turn.outputTranscript.length>10&&Date.now()-turn.startedAt>13000&&Date.now()-lastSpeechAt>1800&&Date.now()>speechEndAt+400,40000,'turn complete');
   const firstAfter=turn.audioObservations.find(o=>o.receivedAt>=turn.callerEndedAt);
   const firstPlayback=turn.audioObservations.find(o=>o.simulatedStartAt>=turn.callerEndedAt);
   turn.firstAudioMs=firstAfter?firstAfter.receivedAt-turn.callerEndedAt:null;
   turn.firstSimulatedPlaybackMs=firstPlayback?firstPlayback.simulatedStartAt-turn.callerEndedAt:null;
   turn.overlapObserved=turn.audioObservations.some(o=>o.simulatedStartAt<turn.callerEndedAt);
   turn.overlapEstimatedMs=turn.audioObservations.reduce((n,o)=>n+Math.max(0,Math.min(o.simulatedEndAt,turn.callerEndedAt)-Math.max(o.simulatedStartAt,turn.startedAt)),0);
   turn.elapsedMs=Date.now()-turn.startedAt;turn.toolResults=report.toolResults.slice(turn.toolResultsBefore);turn.audioSeconds=turn.chunks.reduce((n,c)=>n+c.length,0)/48000;
   await writeFile(resolve(root,s.id+'-'+turn.kind+'.wav'),wav(Buffer.concat(turn.chunks)));delete turn.chunks;activeTurn=null;
  }
 }catch(e){report.failure=safeError(e);}
 finally{clearTimeout(scoutTimer);scout?.close();clearInterval(timer);clearInterval(inputPump);if(ws?.readyState===WebSocket.OPEN){ws.send(JSON.stringify({type:'session.close',event_id:randomUUID()}));await pause(700);}engine?.close();ws?.terminate();for(const turn of report.turns){
   if(turn.chunks?.length)await writeFile(resolve(root,s.id+'-'+turn.kind+'.wav'),wav(Buffer.concat(turn.chunks)));
   const first=turn.audioObservations.find(o=>o.receivedAt>=turn.callerEndedAt);
   if(turn.firstAudioMs===undefined&&first)turn.firstAudioMs=first.receivedAt-turn.callerEndedAt;
   delete turn.chunks;
  }}
 const pcm=Buffer.concat(chunks);report.audioSeconds=pcm.length/48000;report.elapsedMs=Date.now()-started;report.playbackEvidence='PCM received and simulated playback clock; no browser or physical speaker playback verification';
 if(pcm.length){const audio=wav(pcm);await writeFile(resolve(root,s.id+'.wav'),audio);try{
  if(fixed)throw Error('Provider output transcript and PCM retained; independent ASR omitted'); await budget.reserve('independent_asr',.05,{scenario:s.id});const form=new FormData();form.set('model','gpt-4o-transcribe');form.set('file',new Blob([audio],{type:'audio/wav'}),'native-output.wav');
  const r=await fetch('https://api.openai.com/v1/audio/transcriptions',{method:'POST',headers:auth,body:form,signal:AbortSignal.timeout(20000)});if(r.ok)report.audioTranscript=(await r.json()).text;else report.asrStatus=r.status;
 }catch(e){report.asrError=safeError(e);}}
 await writeFile(resolve(root,s.id+'.json'),JSON.stringify(report,null,2));return report;
}
try{
 const reports=[];for(const s of cases){const r=await run(s);reports.push(r);console.log(JSON.stringify({id:s.id,failure:r.failure,errors:r.errors,decisions:r.decisions.length,jobs:r.jobs.length,turns:r.turns.map(t=>({kind:t.kind,firstAudioMs:t.firstAudioMs,toolStatuses:t.toolResults?.map(x=>x.output.status),transcript:t.outputTranscript})),audioTranscript:r.audioTranscript}));}
 await writeFile(resolve(root,'summary.json'),JSON.stringify({campaign,capUsd:cap,accountedUsd:budget.total(),reports},null,2));
}finally{await lock.close();await unlink(ledgerPath+'.lock');}
