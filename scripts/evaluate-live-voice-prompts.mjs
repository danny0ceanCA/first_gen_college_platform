// Real audio-in/audio-out Realtime evaluation. Default invocation is free preflight.
// Paid opt-in: node scripts/evaluate-live-voice-prompts.mjs --execute --budget-usd 5 --output output/live-voice-prompts-2026-10-28
// Never resets the fixed campaign ledger, including failed/partial runs.
import {mkdir,readFile,writeFile,rename,open,unlink} from 'node:fs/promises';
import {resolve,relative,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {loadEnv} from 'vite';
import {voiceSession} from '../server/profile-voice.mjs';
import {onboardingWelcome} from '../src/voiceWelcome.mjs';
import {voiceLanguageInstructions} from '../src/voiceLanguage.mjs';
import {explicitProfileSaveRequest} from '../src/voiceProfileSave.mjs';
import {liveVoicePromptCases,allSpeechInputs} from '../evals/live-voice-prompts.cases.mjs';

export const LIMITS=Object.freeze({budgetUSD:5,sessions:6,responsesPerSession:20,responsesTotal:70,toolRounds:4,outputTokens:1500,inputSecondsPerSession:150,inputSecondsPerClip:30,sessionMs:240000,runMs:1500000,eventMs:35000,configBytes:60000,outputBytesPerResponse:12_000_000});
export const CAMPAIGN='prompt-cleanup-2026-10-28';
const PRICE={textInput:4,audioInput:32,textOutput:24,audioOutput:64,ttsCharacters:15};
const SOURCES=['https://developers.openai.com/api/docs/models/gpt-realtime-2.1','https://developers.openai.com/api/docs/guides/realtime-conversations','https://developers.openai.com/api/docs/guides/voice-latency-cost','https://developers.openai.com/api/docs/models/tts-1','https://developers.openai.com/api/docs/models/gpt-4o-mini-transcribe'];
const bytes=value=>Buffer.byteLength(typeof value==='string'?value:JSON.stringify(value));
const hash=value=>createHash('sha256').update(value).digest('hex');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const safeError=error=>String(error?.message||error).replace(/(?:sk-|ek_)[A-Za-z0-9_-]+/g,'[redacted]').slice(0,200);

export async function replaceLedger(temporary,target,{renameFile=rename,wait=delay}={}){
 // Windows readers/antivirus can briefly deny replace-existing rename. Retry
 // this local atomic file operation only; no provider request is replayed.
 const backoff=[50,100,200];
 for(let attempt=0;;attempt++){
  try{await renameFile(temporary,target);return;}
  catch(error){if(!['EPERM','EBUSY'].includes(error.code)||attempt>=backoff.length)throw error;await wait(backoff[attempt]);}
 }
}

export function recoverLedger(primary,pending,{campaign=CAMPAIGN,capUSD=5,date=new Date().toISOString().slice(0,10)}={}){
 const validate=ledger=>{
  if(!ledger||ledger.kind!=='live-voice-prompts-cumulative-budget'||ledger.campaign!==campaign||ledger.capUSD!==capUSD||!Array.isArray(ledger.entries))throw Error('incompatible_budget_ledger');
  const ids=new Set();for(const entry of ledger.entries){if(typeof entry.id!=='string'||!entry.id||ids.has(entry.id)||!Number.isFinite(entry.accountedUSD)||entry.accountedUSD<0||!Number.isFinite(entry.reservedUSD)||entry.reservedUSD<=0)throw Error('invalid_budget_ledger_entry');ids.add(entry.id);}return ids;
 };
 if(!primary&&!pending)return {kind:'live-voice-prompts-cumulative-budget',campaign,date,capUSD,entries:[],accountedCostUpperUSD:0};
 const primaryIds=primary?validate(primary):new Set(),pendingIds=pending?validate(pending):new Set();
 const primaryContainsPending=[...pendingIds].every(id=>primaryIds.has(id)),pendingContainsPrimary=[...primaryIds].every(id=>pendingIds.has(id));
 if(primary&&pending&&!primaryContainsPending&&!pendingContainsPrimary)throw Error('divergent_budget_ledgers');
 const selected=pending&&pendingContainsPrimary?pending:primary;
 const recovered=structuredClone(selected);
 // A failed rename may contain a newly reserved call, or an older reservation
 // before reported usage. Retain the higher recorded amount for every ID.
 recovered.entries=recovered.entries.map(entry=>{
  const counterparts=[primary,pending].filter(Boolean).flatMap(l=>l.entries.filter(e=>e.id===entry.id));
  const maximum=Math.max(...counterparts.map(e=>e.accountedUSD));
  return maximum>entry.accountedUSD?{...entry,accountedUSD:maximum,status:'recovered_conservative',recoveredFromRecordedUpperBounds:true}:entry;
 });
 recovered.accountedCostUpperUSD=recovered.entries.reduce((n,e)=>n+e.accountedUSD,0);
 if(recovered.accountedCostUpperUSD>capUSD)throw Error('budget_boundary');
 if(pending)recovered.recovery={at:new Date().toISOString(),primaryEntries:primaryIds.size,pendingEntries:pendingIds.size,policy:'Superset of entry IDs; maximum recorded accountedUSD per ID; no paid request replayed.'};
 return recovered;
}

export function usageCostUpper(usage){
 if(!usage||!Number.isFinite(usage.input_tokens)||!Number.isFinite(usage.output_tokens))return null;
 const i=usage.input_token_details||usage.input_tokens_details,o=usage.output_token_details||usage.output_tokens_details;
 const ti=i?.text_tokens||0,ai=i?.audio_tokens||0,to=o?.text_tokens||0,ao=o?.audio_tokens||0;
 // Never subtract cached tokens; unknown modalities/reasoning use the highest rate.
 return (ti*4+ai*32+Math.max(0,usage.input_tokens-ti-ai)*32+to*24+ao*64+Math.max(0,usage.output_tokens-to-ao)*64)/1e6;
}

export function responseReservation({configBytes,textBytes=0,inputSeconds=0,priorOutputTokens=0,responses=0}){
 // UTF-8 bytes bound text tokens. 100 input tokens/sec is 10x documented PCM
 // tokenization (10/sec), plus 4096 fixed and 1024 per-turn framing tokens.
 // Prior output is entirely priced as input audio. 1500 caps all output tokens.
 return ((configBytes+textBytes+4096+1024*responses)*PRICE.textInput+(Math.ceil(inputSeconds*100)+priorOutputTokens)*PRICE.audioInput+LIMITS.outputTokens*PRICE.audioOutput)/1e6;
}

export function wav(pcm){
 if(pcm.length%2)throw Error('invalid_pcm_length');const h=Buffer.alloc(44);
 h.write('RIFF');h.writeUInt32LE(pcm.length+36,4);h.write('WAVEfmt ',8);h.writeUInt32LE(16,16);h.writeUInt16LE(1,20);h.writeUInt16LE(1,22);h.writeUInt32LE(24000,24);h.writeUInt32LE(48000,28);h.writeUInt16LE(2,32);h.writeUInt16LE(16,34);h.write('data',36);h.writeUInt32LE(pcm.length,40);return Buffer.concat([h,pcm]);
}
export function pcmFromWav(buffer){
 if(buffer.toString('ascii',0,4)!=='RIFF'||buffer.toString('ascii',8,12)!=='WAVE')throw Error('invalid_wav');let fmt,data;
 for(let p=12;p+8<=buffer.length;){const type=buffer.toString('ascii',p,p+4),declared=buffer.readUInt32LE(p+4),size=type==='data'&&declared===0xffffffff?buffer.length-p-8:declared,end=p+8+size;if(end>buffer.length)throw Error('truncated_wav');if(type==='fmt ')fmt=buffer.subarray(p+8,end);if(type==='data')data=buffer.subarray(p+8,end);p=end+(size%2);}
 if(!fmt||fmt.length<16||fmt.readUInt16LE(0)!==1||fmt.readUInt16LE(2)!==1||fmt.readUInt32LE(4)!==24000||fmt.readUInt16LE(14)!==16||!data||data.length%2)throw Error('expected_24khz_mono_pcm16');return data;
}

export function createBudget(cap,entries=[],persist=async()=>{}){
 if(!Number.isFinite(cap)||cap<=0||cap>LIMITS.budgetUSD)throw Error('budget_must_be_at_most_5');
 const total=()=>entries.reduce((n,e)=>n+e.accountedUSD,0);
 if(entries.some(e=>!Number.isFinite(e.accountedUSD)||e.accountedUSD<0)||total()>cap)throw Error('invalid_budget_ledger');
 return {entries,total,async reserve(kind,amount,metadata={}){
  if(!Number.isFinite(amount)||amount<=0||total()+amount>cap)throw Error('budget_boundary');
  const entry={id:randomUUID(),kind,reservedUSD:amount,accountedUSD:amount,status:'reserved',...metadata};entries.push(entry);await persist();return entry;
 },async settle(entry,actual){
  if(actual===null)return;if(!Number.isFinite(actual)||actual<0)throw Error('invalid_provider_usage');
  if(actual>entry.reservedUSD+1e-9){entry.accountedUSD=actual;entry.providerCostUpperUSD=actual;entry.status='reservation_exceeded';await persist();throw Error('reservation_exceeded');}
  entry.accountedUSD=actual;entry.providerCostUpperUSD=actual;entry.status='reported_usage';await persist();
 }};
}

function configFor(scenario){
 const config=voiceSession({role:'student',adaptiveEnabled:false,...scenario},{});
 if(config.model!=='gpt-realtime-2.1'||config.max_output_tokens!==1500||config.audio.input.turn_detection?.create_response!==false)throw Error('unsupported_application_config');
 const original=structuredClone(config);config.output_modalities=['audio'];config.audio.input.format={type:'audio/pcm',rate:24000};config.audio.output.format={type:'audio/pcm',rate:24000};
 if(bytes(config)>LIMITS.configBytes)throw Error('configuration_budget_boundary');return {config,original};
}

export function syntheticTool(call,state,transcript){
 const args=JSON.parse(call.arguments||'{}');let result;
 if(call.name==='propose_profile'){for(const change of args.changes||[])state.profile[change.field]=change.value;result={status:'proposed',changes:args.changes};}
 else if(call.name==='propose_account'){state.account=args;result={status:'proposed'};}
 else if(call.name==='save_onboarding_profile'){
  if(args.requested_by_user!==true||!explicitProfileSaveRequest(transcript))result={status:'save_not_requested',instruction:'No explicit save request was heard in this turn. Keep the draft unsaved.'};
  else if(!state.profile.name)result={status:'missing_details',instruction:'The student name is missing.'};
  else if(state.failFirstSave&&!state.saveAttempted){state.saveAttempted=true;result={status:'save_failed',instruction:'Storage is unavailable. Do not claim a save. The call remains open.'};}
  else {state.saveAttempted=true;state.saved={...state.profile};result={status:'saved'};}
 }else if(call.name==='request_conversation_target'){
  if(!['student:alex','student:sam','family'].includes(args.scope))throw Error('unexpected_scope');
  state.scope=args.scope;result={status:'confirmed',scope:args.scope};
 }else if(call.name==='set_conversation_language'){state.language=args.language;result={status:'language_selected',language:args.language};}
 else if(call.name.startsWith('lookup_'))result={status:'unavailable',error:'research_unavailable',instruction:'The requested official lookup failed. No current facts were verified. Do not invent a deadline or claim verification. No automatic retry.'};
 else if(call.name==='highlight_binder_topics')result={status:'highlighted',topics:args.topics||[]};
 else result={status:'unavailable',instruction:'This synthetic adapter cannot perform this action. Do not claim it happened.'};
 return {args,result:{...result,syntheticEvaluationAdapter:true,persisted:false}};
}

export class EventStream{
 constructor(ws,record){this.ws=ws;this.record=record;this.events=[];this.waiters=new Set();this.failure=null;this.closed=false;
  ws.addEventListener('message',event=>{try{this.push(JSON.parse(event.data));}catch{this.fail('invalid_provider_event');}});
  ws.addEventListener('error',()=>this.fail('provider_socket_error'));
  ws.addEventListener('close',event=>{this.closed=true;record.socketClose={code:event.code,reason:event.reason,wasClean:event.wasClean,at:new Date().toISOString()};this.fail('provider_socket_closed');});
 }
 push(event){event.receivedAt=Date.now();this.events.push(event);if(event.type==='error')this.fail(`provider_${event.error?.code||'error'}`);for(const waiter of [...this.waiters])waiter();}
 fail(message){this.failure??=Error(message);for(const waiter of [...this.waiters])waiter();}
 async wait(predicate,{after=0,timeout=LIMITS.eventMs}={}){
  const existing=this.events.slice(after).find(predicate);if(existing)return existing;if(this.failure)throw this.failure;
  return new Promise((resolve,reject)=>{let timer;const check=()=>{const event=this.events.slice(after).find(predicate);if(event||this.failure){clearTimeout(timer);this.waiters.delete(check);event?resolve(event):reject(this.failure);}};this.waiters.add(check);timer=setTimeout(()=>{this.waiters.delete(check);reject(Error('provider_event_timeout'));},timeout);check();});
 }
 send(event){if(this.failure||this.ws.readyState!==WebSocket.OPEN)throw this.failure||Error('socket_not_open');this.ws.send(JSON.stringify(event));}
 async close(reason='evaluation_finished'){
  if(this.closed){this.record.socketClosed=true;return;}
  const closed=new Promise(resolve=>this.ws.addEventListener('close',resolve,{once:true}));this.ws.close(1000,reason);await Promise.race([closed,delay(2500)]);
  this.record.socketClosed=this.closed;if(!this.closed)throw Error('socket_close_not_confirmed');
 }
}

async function runScenario(scenario,context){
 const {output,key,budget,audio,report,save}=context,{config,original}=configFor(scenario);
 const record={id:scenario.id,language:scenario.language,applicationConfigurationHash:hash(JSON.stringify(original)),configurationHash:hash(JSON.stringify(config)),model:config.model,voice:config.audio.output,turnDetection:config.audio.input.turn_detection,transcriber:config.audio.input.transcription.model,turns:[],responses:[],toolTrace:[],reviewCriteria:scenario.review,semanticReview:'pending',realMicrophone:false,browserUI:false};report.scenarios.push(record);
 await writeFile(resolve(output,`${scenario.id}-configuration.json`),JSON.stringify({original,transport:config},null,2));await save();
 // Covers up to 150 sec input, prompt text and transcript overhead at >20x the
 // published approx $0.003/min transcription price. Never released/refunded.
 await budget.reserve('input-transcription-upper-bound',0.20,{scenario:scenario.id,maxAudioSeconds:LIMITS.inputSecondsPerSession});
 const tokenResponse=await fetch('https://api.openai.com/v1/realtime/client_secrets',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({expires_after:{anchor:'created_at',seconds:120},session:config}),signal:AbortSignal.timeout(20000)});
 if(!tokenResponse.ok)throw Error(`session_auth_http_${tokenResponse.status}`);const secret=await tokenResponse.json();if(!secret.value)throw Error('missing_ephemeral_key');
 const ws=new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1',['realtime',`openai-insecure-api-key.${secret.value}`]);
 const stream=new EventStream(ws,record);context.sockets.add(stream);let timer,seconds=0,textBytes=0,priorOutputTokens=0,responseCount=0;
 const state={profile:{...scenario.profile},language:scenario.language,failFirstSave:scenario.failFirstSave};
 const sendSpeech=async(turn)=>{
  const clip=audio.get(`${scenario.id}-${turn.id}`);if(!clip)throw Error('missing_audio_fixture');const before=stream.events.length;
  const padding=Buffer.alloc(48000*1.4),pcm=Buffer.concat([padding.subarray(0,14400),clip.pcm,padding.subarray(14400)]);
  if(seconds+pcm.length/48000>LIMITS.inputSecondsPerSession)throw Error('input_audio_budget_boundary');seconds+=pcm.length/48000;
  const user={id:turn.id,scriptedText:turn.text,inputAudioFile:clip.file,inputSeconds:clip.pcm.length/48000,audioSource:clip.source,startedAt:Date.now()};record.turns.push(user);
  for(let offset=0;offset<pcm.length;offset+=9600){stream.send({type:'input_audio_buffer.append',audio:pcm.subarray(offset,offset+9600).toString('base64')});await delay(200);}
  await delay(300);const starts=stream.events.slice(before).filter(e=>e.type==='input_audio_buffer.speech_started');
  if(!starts.length)throw Error('input_speech_not_detected');
  const transcriptions=[];for(const started of starts){await stream.wait(e=>e.type==='input_audio_buffer.speech_stopped'&&e.item_id===started.item_id,{after:before});transcriptions.push(await stream.wait(e=>e.type==='conversation.item.input_audio_transcription.completed'&&e.item_id===started.item_id,{after:before}));}
  user.itemIds=starts.map(e=>e.item_id);user.transcript=transcriptions.map(e=>e.transcript).join(' ');user.transcriptionUsage=transcriptions.map(e=>e.usage);user.endedAt=Date.now();textBytes+=bytes(user.transcript)+2048;return user;
 };
 const respond=async(user,{opening=false,interrupt}={})=>{
  let interruption=null;
  for(let round=0;round<LIMITS.toolRounds;round++){
   if(++responseCount>LIMITS.responsesPerSession||++context.responses>LIMITS.responsesTotal)throw Error('response_count_boundary');
   const extraInstructions=opening?onboardingWelcome(scenario.language,{role:'student',hasName:false,canSaveProfile:true,newStudent:true})+' The account is already set up. Collect only this new student; never ask for the account-holder name or role.':undefined;
   const reserve=await budget.reserve('realtime-response',responseReservation({configBytes:bytes(config)+(extraInstructions?bytes(extraInstructions):0),textBytes,inputSeconds:seconds+(interrupt?LIMITS.inputSecondsPerClip:0),priorOutputTokens,responses:responseCount}),{scenario:scenario.id,turn:user?.id||'opening',round});
   const before=stream.events.length,started=Date.now();stream.send({type:'response.create',response:{output_modalities:['audio'],max_output_tokens:LIMITS.outputTokens,...(extraInstructions?{instructions:extraInstructions}:{})}});
   const created=await stream.wait(e=>e.type==='response.created',{after:before}),id=created.response.id;
   if(interrupt&&round===0){
    const firstAudio=await stream.wait(e=>(e.type==='response.output_audio.delta'||e.type==='response.done')&&(e.response_id===id||e.response?.id===id),{after:before});
    if(firstAudio.type!=='response.output_audio.delta')throw Error('interruption_requires_spoken_answer');
    const truncate=async()=>{
     const speechStarted=await stream.wait(e=>e.type==='input_audio_buffer.speech_started',{after:before});
     const receivedBytes=stream.events.slice(before).filter(e=>e.type==='response.output_audio.delta'&&e.response_id===id).reduce((n,e)=>n+Buffer.from(e.delta,'base64').length,0);
     const audioEndMs=Math.max(0,Math.floor(Math.min(speechStarted.receivedAt-firstAudio.receivedAt,receivedBytes/48)));
     const at=stream.events.length;stream.send({type:'conversation.item.truncate',item_id:firstAudio.item_id,content_index:firstAudio.content_index||0,audio_end_ms:audioEndMs});
     await stream.wait(e=>e.type==='conversation.item.truncated'&&e.item_id===firstAudio.item_id,{after:at});
     record.truncation={itemId:firstAudio.item_id,audioEndMs,acknowledged:true,method:'Simulated playback clock from first received PCM to server speech_started; no actual speaker playback. Unplayed transcript removed by provider.'};
    };
    interruption=Promise.all([sendSpeech(interrupt),truncate()]).then(([user])=>user);interruption.catch(()=>{});
   }
   const completed=await stream.wait(e=>e.type==='response.done'&&e.response.id===id,{after:before}),response=completed.response;
   const events=stream.events.slice(before).filter(e=>e.response_id===id||e.response?.id===id),chunks=events.filter(e=>e.type==='response.output_audio.delta').map(e=>Buffer.from(e.delta,'base64'));
   const pcm=Buffer.concat(chunks);if(pcm.length>LIMITS.outputBytesPerResponse)throw Error('output_audio_budget_boundary');
   const transcript=events.filter(e=>e.type==='response.output_audio_transcript.done').map(e=>e.transcript).join('')||events.filter(e=>e.type==='response.output_audio_transcript.delta').map(e=>e.delta).join('');
   const file=pcm.length?`${scenario.id}-response-${responseCount}.wav`:null;if(file)await writeFile(resolve(output,file),wav(pcm));
   const cost=usageCostUpper(response.usage),entry={id,userTurn:user?.id||'opening',round,status:response.status,statusDetails:response.status_details,usage:response.usage,costUpperUSD:cost,reservationUSD:reserve.reservedUSD,audioFile:file,audioSeconds:pcm.length/48000,transcript,wordCount:transcript.trim().split(/\s+/u).filter(Boolean).length,questionCount:(transcript.match(/\?/g)||[]).length,firstAudioMs:events.find(e=>e.type==='response.output_audio.delta')?.receivedAt-started||null};
   record.responses.push(entry);await budget.settle(reserve,cost);priorOutputTokens+=response.usage?.output_tokens??LIMITS.outputTokens;textBytes+=bytes(transcript);
   if(interruption){const nextUser=await interruption;record.interruption={inputTurn:nextUser.id,priorResponseId:id,priorStatus:response.status,overlapObserved:nextUser.startedAt<completed.receivedAt,speechStartedDuringResponse:stream.events.some(e=>e.type==='input_audio_buffer.speech_started'&&e.receivedAt>=created.receivedAt&&e.receivedAt<=completed.receivedAt),transport:'Server VAD over WebSocket; no browser playback measurement'};await save();return respond(nextUser);}
   if(response.status==='failed')throw Error('provider_response_failed');
   const calls=(response.output||[]).filter(item=>item.type==='function_call');
   entry.modelToolOrder=calls.map(call=>call.name);
   // The application applies all draft proposals before voiceProfileSaveTools.
   calls.sort((a,b)=>Number(a.name==='save_onboarding_profile')-Number(b.name==='save_onboarding_profile'));
   for(const call of calls){
    const {args,result}=syntheticTool(call,state,user?.transcript||'');record.toolTrace.push({turn:user?.id||'opening',responseId:id,name:call.name,args,result});const serialized=JSON.stringify(result);textBytes+=bytes(call.arguments||'')+bytes(serialized);
    stream.send({type:'conversation.item.create',item:{type:'function_call_output',call_id:call.call_id,output:serialized}});
    if(call.name==='request_conversation_target'){
     const studentId=state.scope==='family'?null:state.scope.split(':')[1];const next=configFor({...scenario,targetConfirmed:true,scopeRestart:true,continuing:true,studentId,profile:studentId?{name:studentId==='sam'?'Sam':'Alex',stage:'Community college'}:{}}).config;
     Object.assign(config,{instructions:next.instructions,tools:next.tools});const at=stream.events.length;stream.send({type:'session.update',session:{type:'realtime',instructions:config.instructions,tools:config.tools}});await stream.wait(e=>e.type==='session.updated',{after:at});
    }
    if(call.name==='set_conversation_language'){
     config.instructions=voiceLanguageInstructions(config.instructions,state.language);const at=stream.events.length;stream.send({type:'session.update',session:{type:'realtime',instructions:config.instructions}});await stream.wait(e=>e.type==='session.updated',{after:at});
    }
   }
   await save();if(!calls.length)return;
  }
  throw Error('tool_round_boundary');
 };
 try{
  timer=setTimeout(()=>{record.watchdog='session_timeout';void stream.close('session_timeout').catch(()=>{});},LIMITS.sessionMs);
  const ready=await stream.wait(e=>e.type==='session.created');record.providerSessionId=ready.session.id;
  if(scenario.opening)await respond(null,{opening:scenario.onboarding===true});
  for(const turn of scenario.turns){const user=await sendSpeech(turn);await respond(user,{interrupt:turn.interrupt});}
  if(scenario.closeFault){record.injectedConnectionFault={type:'client_socket_close',automaticRetry:false,at:Date.now()};await stream.close('synthetic_connection_fault');try{stream.send({type:'input_audio_buffer.clear'});}catch(error){record.injectedConnectionFault.sendAfterClose=safeError(error);}}
  record.complete=true;
 }catch(error){record.failure=safeError(error);throw error;}
 finally{
  clearTimeout(timer);try{await stream.close();}catch(error){record.closeFailure=safeError(error);}if(stream.closed)context.sockets.delete(stream);
  // Keep partial spoken evidence even when no response.done/usage arrived.
  for(const created of stream.events.filter(e=>e.type==='response.created')){
   const id=created.response.id;if(record.responses.some(r=>r.id===id))continue;
   const events=stream.events.filter(e=>e.response_id===id),pcm=Buffer.concat(events.filter(e=>e.type==='response.output_audio.delta').map(e=>Buffer.from(e.delta,'base64')));
   const file=pcm.length?`${scenario.id}-partial-${record.responses.length+1}.wav`:null;if(file)await writeFile(resolve(output,file),wav(pcm));
   record.responses.push({id,status:'transport_incomplete',usage:null,costUpperUSD:null,reservationRetained:true,audioFile:file,audioSeconds:pcm.length/48000,transcript:events.filter(e=>e.type==='response.output_audio_transcript.delta').map(e=>e.delta).join('')});
  }
  record.syntheticFinalState=state;record.inputSeconds=seconds;
  // No API keys or raw base64 audio in event files. Audio goes to WAV artifacts.
  record.eventFile=`${scenario.id}-events.json`;await writeFile(resolve(output,record.eventFile),JSON.stringify(stream.events.map(e=>e.type==='response.output_audio.delta'?{type:e.type,response_id:e.response_id,item_id:e.item_id,receivedAt:e.receivedAt,bytes:Buffer.from(e.delta,'base64').length}:e),null,2));
  record.checks={receivedAudio:record.responses.some(r=>r.audioSeconds>0),receivedUserTranscripts:record.turns.length===scenario.turns.length+scenario.turns.filter(t=>t.interrupt).length&&record.turns.every(t=>!!t.transcript),socketClosed:record.socketClosed===true,noUnexpectedIncompleteResponses:record.responses.every(r=>['completed','cancelled'].includes(r.status)),noAutomaticResponses:stream.events.filter(e=>e.type==='response.created').length<=responseCount,saveOnlyAfterExplicitRequest:record.toolTrace.filter(t=>t.name==='save_onboarding_profile'&&t.result.status==='saved').every(t=>explicitProfileSaveRequest(record.turns.find(u=>u.id===t.turn)?.transcript||''))};
  if(scenario.onboarding)Object.assign(record.checks,{profileNameProposed:record.toolTrace.some(t=>t.name==='propose_profile'&&t.args.changes?.some(c=>c.field==='name')),stageProposed:record.toolTrace.some(t=>t.name==='propose_profile'&&t.args.changes?.some(c=>c.field==='stage'&&c.value==='Community college')),noSaveOnRefusal:!record.toolTrace.some(t=>t.name==='save_onboarding_profile'&&t.turn==='no-save'),latestCorrectionSaved:state.saved?.name==='Alexis',syntheticSaveAcknowledged:record.toolTrace.some(t=>t.name==='save_onboarding_profile'&&t.result.status==='saved'),...(scenario.failFirstSave?{syntheticSaveFailureObserved:record.toolTrace.some(t=>t.name==='save_onboarding_profile'&&t.result.status==='save_failed')}:{}),onboardingToolsOnly:record.toolTrace.every(t=>['propose_profile','propose_account','save_onboarding_profile','set_conversation_language','end_conversation'].includes(t.name))});
  if(scenario.routeConversations)Object.assign(record.checks,{selectedSam:state.scope==='student:sam',noResearchBeforeScope:!record.toolTrace.some(t=>t.name.startsWith('lookup_')&&t.turn==='opening'),syntheticLookupFailureObserved:record.toolTrace.some(t=>t.name==='lookup_financial_aid'&&t.result.error==='research_unavailable'),connectionCloseHandled:!!record.injectedConnectionFault?.sendAfterClose});
  if(scenario.turns.some(t=>t.interrupt))Object.assign(record.checks,{interruptionAudioRecognized:record.turns.some(t=>t.id==='interrupt'&&!!t.transcript),truncationAcknowledged:record.truncation?.acknowledged===true,interruptedResponse:record.interruption?.priorStatus==='cancelled'||record.truncation?.acknowledged===true});
  record.automatedChecksPassed=Object.values(record.checks).every(Boolean);await save();
 }
}

export async function main(argv=process.argv.slice(2)){
 const option=name=>{const index=argv.indexOf(name);return index>=0?argv[index+1]:undefined;},execute=argv.includes('--execute'),cap=argv.includes('--budget-usd')?Number(option('--budget-usd')):5;
 createBudget(cap);const cwd=process.cwd(),date=new Date().toISOString().slice(0,10),output=resolve(cwd,option('--output')||`output/live-voice-prompts-${date}`),ledgerPath=resolve(cwd,`output/live-voice-prompts-budget-${CAMPAIGN}.json`);
 if(!relative(cwd,output)||relative(cwd,output).startsWith('..'))throw Error('output_must_be_inside_workspace');
 const requestedCases=option('--cases')?.split(',');if(requestedCases?.some(id=>!liveVoicePromptCases.some(c=>c.id===id)))throw Error('unknown_case');
 const scenarios=requestedCases?liveVoicePromptCases.filter(c=>requestedCases.includes(c.id)):liveVoicePromptCases;if(!scenarios.length||scenarios.length>LIMITS.sessions)throw Error('session_count_boundary');
 const speech=allSpeechInputs(scenarios);
 let reuseManifest,reuseRoot;if(option('--reuse-audio')){reuseRoot=resolve(cwd,option('--reuse-audio'));if(relative(cwd,reuseRoot).startsWith('..'))throw Error('reuse_audio_must_be_inside_workspace');reuseManifest=JSON.parse(await readFile(resolve(reuseRoot,'report.json'),'utf8'));if(reuseManifest.kind!=='live-audio-prompt-evaluation'||reuseManifest.productionDataUsed!==false)throw Error('invalid_audio_manifest');}
 const preflight={kind:'live-audio-prompt-evaluation-preflight',paidCalls:false,scenarios:scenarios.map(c=>({id:c.id,turns:c.turns.length,configurationBytes:bytes(configFor(c).config),review:c.review})),syntheticInputGeneration:'tts-1; UTF-8 bytes bound billed characters; optional --reuse-audio manifest reuses verified synthetic inputs',newSpeechReservationUSD:speech.reduce((n,s)=>n+bytes(s.text)*15/1e6,0),budgetUSD:cap,cumulativeLedger:ledgerPath,limits:LIMITS,sources:SOURCES};
 if(!execute){console.log(JSON.stringify(preflight,null,2));return preflight;}
 if(!argv.includes('--budget-usd')||!argv.includes('--output'))throw Error('execute_requires_explicit_budget_and_output');
 const key=process.env.OPENAI_API_KEY||loadEnv('development',cwd,'OPENAI_').OPENAI_API_KEY;if(!key)throw Error('provider_key_not_configured');
 await mkdir(dirname(ledgerPath),{recursive:true});const lock=await open(ledgerPath+'.lock','wx');
 let ledger,budget,watchdog,report,context;
 try{
  const readLedger=async path=>{try{return JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;return null;}};
  ledger=recoverLedger(await readLedger(ledgerPath),await readLedger(ledgerPath+'.tmp'),{capUSD:cap,date});
  const persist=async()=>{ledger.accountedCostUpperUSD=budget.total();ledger.updatedAt=new Date().toISOString();await writeFile(ledgerPath+'.tmp',JSON.stringify(ledger,null,2));await replaceLedger(ledgerPath+'.tmp',ledgerPath);};budget=createBudget(cap,ledger.entries,persist);
  await persist(); // Recover any failed atomic replacement before paid calls.
  await mkdir(output);report={kind:'live-audio-prompt-evaluation',startedAt:new Date().toISOString(),model:'gpt-realtime-2.1',transport:'GA Realtime WebSocket, streamed synthetic 24kHz PCM input and generated PCM output',productionDataUsed:false,productionWrites:false,automaticRetries:false,semanticReview:'pending',releaseReady:false,limitations:['Synthetic spoken inputs; no real human microphone, React UI, browser speaker playback, Auth0, database, production tool or full network recovery validation.','voiceSession is imported directly; server-loaded personalization and teaching-library context is not added.','All tool replies are explicitly marked syntheticEvaluationAdapter and persisted:false. A synthetic saved result validates response behavior only.','Connection failure is a deterministic client socket close, not an actual network outage.','The fixed campaign ledger retains unknown charges and transcription reservations. Cost uses undiscounted current prices; it is not an invoice.'],configurationDifferences:['Explicit PCM input/output format and audio modality for WebSocket transport.','Application model, voice, speed, VAD, transcription and max_output_tokens 1500 preserved.','Adaptive personalization disabled because this fixture has no saved user context.'],sources:SOURCES,limits:LIMITS,scenarios:[],inputAudio:[],budgetLedger:ledgerPath};
  const save=async()=>{report.accountedCostUpperUSD=budget.total();report.budgetEntries=ledger.entries;await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));};
  context={output,key,budget,report,save,audio:new Map(),sockets:new Set(),responses:0};await save();
  watchdog=setTimeout(()=>{report.failure='run_timeout';for(const stream of context.sockets)void stream.close('run_timeout').catch(()=>{});},LIMITS.runMs);
  for(const input of speech){
   let pcm,source;const previous=reuseManifest?.inputAudio?.find(a=>a.key===input.key&&a.text===input.text);
   if(previous){const reusedPath=resolve(reuseRoot,previous.file);if(relative(reuseRoot,reusedPath).startsWith('..'))throw Error('invalid_reused_audio_path');pcm=pcmFromWav(await readFile(reusedPath));if(hash(pcm)!==previous.sha256)throw Error('reused_audio_hash_mismatch');source={kind:'reused_synthetic_audio',path:reusedPath};}
   else {
    if(bytes(input.text)>500)throw Error('speech_text_budget_boundary');await budget.reserve('synthetic-input-tts',bytes(input.text)*15/1e6,{input:input.key,model:'tts-1'});
    const response=await fetch('https://api.openai.com/v1/audio/speech',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model:'tts-1',voice:'alloy',input:input.text,response_format:'pcm',speed:1}),signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw Error(`synthetic_speech_http_${response.status}`);pcm=Buffer.from(await response.arrayBuffer());source={kind:'new_synthetic_audio',model:'tts-1',voice:'alloy'};
   }
   if(!pcm.length||pcm.length%2||pcm.length/48000>LIMITS.inputSecondsPerClip)throw Error('input_clip_budget_boundary');const file=`${input.key}-input.wav`;await writeFile(resolve(output,file),wav(pcm));
   context.audio.set(input.key,{pcm,file,source});report.inputAudio.push({key:input.key,text:input.text,file,source,seconds:pcm.length/48000,sha256:hash(pcm)});await save();
  }
  for(const scenario of scenarios){if(report.failure)throw Error(report.failure);console.log(JSON.stringify({starting:scenario.id,accountedCostUpperUSD:budget.total()}));await runScenario(scenario,context);}
  report.complete=true;report.automatedChecksPassed=report.scenarios.every(s=>s.automatedChecksPassed);
 }catch(error){if(report)report.failure=safeError(error);else throw error;process.exitCode=1;}
 finally{
  clearTimeout(watchdog);if(context)for(const stream of context.sockets)try{await stream.close('run_finally');}catch{}
  if(report){report.finishedAt=new Date().toISOString();await context.save();await writeFile(resolve(output,'driver.mjs'),await readFile(new URL(import.meta.url)));await writeFile(resolve(output,'cases.mjs'),await readFile(new URL('../evals/live-voice-prompts.cases.mjs',import.meta.url)));console.log(JSON.stringify({output,complete:report.complete||false,failure:report.failure||null,accountedCostUpperUSD:budget.total()}));}
  await lock.close();await unlink(ledgerPath+'.lock');
 }
 return report;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)main().catch(error=>{console.error(safeError(error));process.exitCode=1;});
