import WebSocket,{WebSocketServer} from 'ws';
import {liveMeasurements} from './live-measurements.mjs';
import {randomUUID} from 'node:crypto';
import {studentLiveChannel} from '../src/studentLiveChannel.mjs';
import {backgroundResearch} from '../src/backgroundResearch.mjs';
import {voiceResearchCache,voiceResearchBudget} from '../src/voiceResearchCache.mjs';
import {researchEvidence} from '../src/voiceResearchProgress.mjs';
import {researchModeForTool} from '../src/liveConversation.mjs';
import {voiceLanguageInstructions} from '../src/voiceLanguage.mjs';
import {selectResearchReuse,cachedResearchForCoverage} from './research-reuse.mjs';
import {liveVoiceDiagnostics} from './live-voice-diagnostics.mjs';

// One native provider writer per physical call. Browser callbacks are leases,
// not a second provider connection. No retries of callbacks or durable writes.
export function voiceControlSession({provider,providerSessionId,config,scope,jobRequest,emit,log=()=>{},now=Date.now,callbackTimeoutMs=35000,researchDeliveryV2=false}){
 const measurements=liveMeasurements({log,config,researchDeliveryV2});
 let closed=false,turn=0,playback={idle:false,version:0,at:0},reportRecord;
 const reports=new Map();
 const batches=new Map(),finishedLeases=new Set(),calls=new Set(),cache=voiceResearchCache(now),budget=voiceResearchBudget();
 const raw={get readyState(){return provider.readyState===undefined||provider.readyState===WebSocket.OPEN?'open':'closed';},send:text=>{if(raw.readyState==='open')provider.send(text);},close:()=>{}};
 const voiceDiagnostics=liveVoiceDiagnostics({requestedVoice:config.requestedVoice,providerSessionId,send:event=>raw.send(JSON.stringify(event)),emit,now});
 const channel=studentLiveChannel(raw,{getTurn:()=>String(turn),now,
  isPlaybackIdle:()=>playback.idle&&now()-playback.at<2500,getPlaybackVersion:()=>playback.version,researchDeliveryV2});
 channel.configure({voiceProvider:'live',voiceSession:config});
 const send=event=>channel.send(JSON.stringify({...event,event_id:event.event_id||randomUUID()}));
 const research=backgroundResearch({requireReplacementChange:researchDeliveryV2,progressive:researchDeliveryV2,post:async query=>{if(!budget.take(query))throw Error('research_limit');return jobRequest('POST',undefined,query);},
  read:id=>jobRequest('GET',id),remove:id=>jobRequest('DELETE',id),now,
  isCurrent:query=>!closed&&query.studentId===scope.studentId&&query.sessionId===scope.sessionId,isQuiet:()=>true,
  onRequest:request=>{if(request.state==='requesting')reportRecord=undefined;send({type:'origen.research.state',request});},onState:active=>emit({type:'origen.research.active',active}),
  deliver:job=>{if(closed)return;const hasEvidence=job.result&&(job.status==='completed'||researchDeliveryV2&&job.result.evidenceVersion>0&&job.result.sources?.length);
   if(hasEvidence){if(job.status==='completed')cache.put(job.query,job.result);reportRecord={job,studentId:scope.studentId};
    if(researchDeliveryV2){reports.set(job.id,reportRecord);if(reports.size>8)reports.delete(reports.keys().next().value);}}
   emit({type:'origen.research.result',jobId:job.id,status:job.status,sources:job.result?.sources||[]});
   const researchPending=job.status==='running',evidenceVersion=job.result?.evidenceVersion||1;
   send({type:'origen.research.ready',jobId:job.id,requestId:job.requestId,revision:job.revision,question:job.question,evidenceVersion,researchPending,result:hasEvidence?{...researchEvidence(job.result,false),evidenceVersion,researchPending,...(job.result.recoveryUnavailable?{recoveryUnavailable:true}:{}),...(researchPending?{status:'source_check_partial'}:{})}:{status:'research_failed'}});
  }});
 const output=(item,result)=>send({type:'conversation.item.create',item:{type:'function_call_output',call_id:item.call_id,output:JSON.stringify(result)}});
 async function researchCall(item){
  if(item.name==='cancel_background_research'){reportRecord=undefined;const receipt=await research.cancel();send({type:'origen.research.cancel'});return receipt;}
  if(item.name==='read_research_details'){
   const args=JSON.parse(item.arguments),record=researchDeliveryV2?reports.get(args.jobId):reportRecord;
   if(!scope.confirmed||!record||record.studentId!==scope.studentId||record.job.id!==args.jobId||record.job.revision!==args.revision)return {status:'research_details_unavailable',
    ...(researchDeliveryV2&&scope.confirmed?{availableReports:[...reports.values()].filter(r=>r.studentId===scope.studentId).map(r=>({jobId:r.job.id,revision:r.job.revision,question:r.job.question}))}:{}),
    instruction:'The requested report is not a retained completed result in this scope. Do not invent details, claim a new search, or automatically repeat research.'};
   return {status:'cached_research_details',jobId:record.job.id,requestId:record.job.requestId,revision:record.job.revision,searchedQuestion:record.job.question,institution:record.job.query.institution||'',text:record.job.result.text,sources:record.job.result.sources,checkedAt:record.job.result.checkedAt,researchPending:record.job.status==='running',instruction:'This retained report covers searchedQuestion; reading it performs no new search. A scenario absent from both that scope and explicit findings is not researched, not a failed verification. Only an attempted check can establish searched-but-unverified. Reuse relevant verified facts; obtain genuinely missing evidence with a scoped lookup. Optional recovery is active only when researchPending is true. Answer the latest question directly, then its material qualification; preserve dates and citations. Do not announce checking when reusing this report.'};
  }
  const args=JSON.parse(item.arguments),mode=researchModeForTool(item.name);
  if(!scope.confirmed||typeof args.question!=='string'||!args.question.trim()||args.question.length>3000||typeof args.institution!=='string'||args.institution.length>300)throw Error('invalid_research');
  // Identity/scope/language never come from model arguments or browser packets.
  const query={...args,mode,language:config.language==='es'?'es':'en',sessionId:scope.sessionId,studentId:scope.studentId,requestKey:item.call_id};
  const hit=args.replaceRequestId===undefined&&args.replaceRevision===undefined?
   cache.get(query)||(researchDeliveryV2?cachedResearchForCoverage(selectResearchReuse(query,cache.records(),{now:now()})):null):null;
  return hit?researchEvidence(hit,true):research.start(query);
 }
 channel.onmessage=async message=>{
  const event=JSON.parse(message.data);if(closed)return;
  measurements.application(event);
  const deliveryStages={'origen.research.supplied':'supplied','origen.research.context_acknowledged':'context_acknowledged','origen.research.context_failed':'context_failed','origen.research.announced':'commentary_requested','origen.research.native_reply_observed':'native_reply_observed'};
  if(deliveryStages[event.type]&&!(researchDeliveryV2&&event.type==='origen.research.announced'))log({event:'voice.research.delivery',deliveryStage:deliveryStages[event.type],durationMs:event.durationMs,packetCount:event.packetCount,contextBytes:event.contextBytes,evidenceFormat:event.evidenceFormat});
  if(event.type==='origen.research.delivery')log({event:'voice.research.delivery',deliveryStage:event.deliveryStage,deliveryReason:event.deliveryReason,durationMs:event.durationMs});
  if(event.type==='input_audio_buffer.speech_started')turn++;
  const tools=event.type==='response.done'?(event.response?.output||[]).filter(item=>item.type==='function_call'):[];
  if(!tools.length){emit(event);return;}
  if(batches.size>=4)throw Error('tool_batch_limit');
  const pending=new Map(),lease=randomUUID();let finish;
  const done=new Promise(resolve=>{finish=resolve;});
  const timer=setTimeout(()=>finish(false),callbackTimeoutMs);timer.unref?.();
  const batch={pending,lease,finish,continued:false};batches.set(lease,batch);
  try{
   const browser=[],server=[];
   for(const item of tools){
    if(calls.has(item.call_id))throw Error('duplicate_tool_call');calls.add(item.call_id);
    if(!config.tools.some(tool=>tool.name===item.name)&&item.name!=='cancel_background_research')throw Error('unadvertised_tool');
    if(researchModeForTool(item.name)||['cancel_background_research','read_research_details'].includes(item.name))server.push(item);
    else{pending.set(item.call_id,item);browser.push(item);}
   }
   if(closed)return;
   let confirmed=true;
   if(browser.length){emit({...event,controlLease:lease,response:{...event.response,output:browser}});if(!await done){confirmed=false;
    for(const item of pending.values())output(item,{status:'callback_unconfirmed',instruction:'Application confirmation was not received. Do not claim success or automatically repeat this action.'});
    log({event:'voice.control.callback_timeout',sourceCount:pending.size});
   }}else emit({...event,response:{...event.response,output:[]}});
   // Language/scope callbacks finish before research from the same backend
   // batch. A failed callback cannot silently choose a different student.
   for(const item of server){
    const started=now();emit({type:'origen.control.tool_call',item});
    let result;try{result=confirmed?await researchCall(item):{status:'research_scope_unconfirmed'};}catch{result={status:'research_unavailable',instruction:'The source check could not start. Continue helping without inventing verified findings.'};}
    if(!closed){output(item,result);emit({type:'origen.control.tool_result',callId:item.call_id,output:JSON.stringify(result),durationMs:now()-started});}
   }
  }finally{clearTimeout(timer);batches.delete(lease);finishedLeases.add(lease);if(finishedLeases.size>1000)finishedLeases.delete(finishedLeases.values().next().value);if(!closed&&!batches.size)send({type:'response.create'});}
 };
 return {
  start(){measurements.start();void raw.onmessage?.({data:JSON.stringify({type:'session.started'})});voiceDiagnostics.start();},
  receive(event){measurements.native(event);if(!closed&&!voiceDiagnostics.receive(event))raw.onmessage?.({data:JSON.stringify(event)});},
  command(event,lease){
   if(closed)return false;
   const batch=batches.get(lease);
   if(event.type==='response.create'&&finishedLeases.has(lease)&&!event.response?.metadata?.topic)return true;
   if(event.type==='conversation.item.create'&&event.item?.type==='function_call_output'){
    const item=batch?.pending.get(event.item.call_id);
    if(!item||lease!==batch.lease||typeof event.item.output!=='string'||event.item.output.length>100000)return false;
    batch.pending.delete(item.call_id);send(event);
    // The UI holds reply requests until origen.backend.finished. Waiting for
    // its response.create here would hold that finish event behind itself.
    // The server owns continuation: every required result is sufficient.
    if(!batch.pending.size)batch.finish(true);return true;
   }
   if(event.type==='response.create'&&batch){if(batch.pending.size||batch.continued)return false;batch.continued=true;batch.finish(true);return true;}
   if(event.type==='response.create'&&batches.size&&!event.response?.metadata?.topic)return false;
   // Context supplied by the UI is kept to the existing application messages;
   // guide/tool configuration must use a server-created one-use update handle.
   if(['response.create','conversation.item.create','input_audio_buffer.commit','input_audio_buffer.clear','output_audio_buffer.clear','response.cancel','session.close'].includes(event.type)){
    if(event.item?.type==='function_call_output')return false;send(event);return true;
   }
   return false;
  },
  playback(value){if(typeof value.idle==='boolean'&&Number.isSafeInteger(value.version)&&value.version>=playback.version)playback={idle:value.idle,version:value.version,at:now()};},
  suspend(){playback={...playback,idle:false,at:now()};},
  async cancel(){reportRecord=undefined;const result=await research.cancel();send({type:'origen.research.cancel'});return result;},
  async configure(next,nextScope,eventId){if(nextScope.studentId!==scope.studentId||nextScope.confirmed!==scope.confirmed){reportRecord=undefined;reports.clear();cache.clear();await research.cancel();send({type:'origen.research.cancel',reason:'scope_changed'});}scope=nextScope;config=next;send({type:'session.update',event_id:eventId,session:next});},
  settle:options=>channel.settle(options),prepareClose:()=>channel.prepareClose(),flush:()=>channel.flush(),
  close(){if(closed)return;measurements.close();voiceDiagnostics.close();closed=true;reports.clear();cache.clear();for(const batch of batches.values())batch.finish(false);research.close();channel.close();},
 };
}

export function createVoiceControl({env,authenticate,authorize,request,log=()=>{},resumeGraceMs=12000,heartbeatIntervalMs=3000,connect=url=>new WebSocket(url,{headers:{Authorization:`Bearer ${env.OPENAI_API_KEY}`},maxPayload:4*1024*1024})}){
 const sessions=new Map(),clients=new Set();let wss,serverRef,upgrade;
 const enabled=env.ORIGEN_LIVE_SERVER_CONTROL==='true';
 if(enabled&&env.ORIGEN_BACKGROUND_RESEARCH!=='true')throw Error('server_voice_control_requires_background_research');
 const origins=new Set((env.ALLOWED_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean));
 function dispose(run,reason='closed'){
  if(run.closed)return;run.closed=true;clearTimeout(run.expiry);clearTimeout(run.attachTimer);clearTimeout(run.resumeTimer);clearInterval(run.check);sessions.delete(run.id);run.buffer=[];run.bufferBytes=0;
  const couldClose=run.provider?.readyState===WebSocket.OPEN;
  run.engine?.close();
  // session.close is supported on WebRTC sidebands; the REST hangup endpoint is SIP-only.
  if(couldClose&&!run.engine)run.provider.send(JSON.stringify({type:'session.close',event_id:randomUUID()}));
  run.provider?.close();run.client?.close(1000,reason);
  // A never-claimed call or broken sideband still needs a native close. A new
  // connection here is for closure only: no transcripts, tools or writes replay.
  if(!couldClose){
   let closer;try{closer=connect(`wss://api.openai.com/v1/live/sessions/${encodeURIComponent(run.providerId)}/attach`);}catch{log({event:'voice.control.close_failed',sessionId:run.sessionId});return;}
   const timeout=setTimeout(()=>closer.terminate?.(),3000);timeout.unref();
   closer.on('error',()=>{});closer.once('close',()=>clearTimeout(timeout));
   closer.once('open',()=>{closer.send(JSON.stringify({type:'session.close',event_id:randomUUID()}));closer.close();});
  }
  log({event:'voice.control.closed',reason,sessionId:run.sessionId});
 }
 return {
  enabled,
  get available(){return enabled&&!!wss;},
  register(input){
   if(!enabled||!wss||!input.providerId)throw Error('voice_control_unavailable');
   if(!input.subject||input.permissionRevision===undefined||!input.sessionId)throw Error('voice_control_permission_required');
   if(sessions.size>=100||[...sessions.values()].filter(run=>run.subject===input.subject).length>=2)throw Error('voice_control_limit');
   const run={...input,id:randomUUID(),updates:new Map(),closed:false,claimed:false,buffer:[],bufferBytes:0,rpcs:new Map(),chain:Promise.resolve()};sessions.set(run.id,run);
   run.expiry=setTimeout(()=>dispose(run,'expired'),30000);run.expiry.unref();return {protocol:'server-v1',id:run.id};
  },
  stage(id,subject,config,scope){const run=sessions.get(id);if(!run||run.closed||run.subject!==subject||scope.sessionId!==run.sessionId)throw Object.assign(Error('voice_control_unavailable'),{status:409});const key=randomUUID();run.updates.clear();run.updates.set(key,{config,scope,expires:Date.now()+30000});return key;},
  attach(server){
   if(!enabled)return;if(wss)throw Error('voice_control_already_attached');serverRef=server;
   wss=new WebSocketServer({noServer:true,maxPayload:128*1024,perMessageDeflate:false});
   upgrade=(req,socket,head)=>{
    if(req.url!=='/api/voice-control')return;
    if(!origins.has(req.headers.origin)||clients.size>=200){socket.destroy();return;}
    wss.handleUpgrade(req,socket,head,client=>{
     clients.add(client);let run,authenticating=false,count=0,window=Date.now(),rejection;
     const reject=reason=>{rejection=reason;client.close(1008,reason);};
     // Engine callbacks outlive a transient browser socket. Send through its
     // current authenticated owner; retain bounded, unsent events during grace.
     const send=message=>{
      if(run?.closed)return;const encoded=JSON.stringify(message),target=run?run.client:client;
      if(target?.readyState===WebSocket.OPEN){if(target.bufferedAmount>1024*1024){if(run)dispose(run,'control_backpressure');else target.terminate();return;}target.send(encoded);}
      else if(run?.claimed){const bytes=Buffer.byteLength(encoded);if(run.buffer.length>=256||run.bufferBytes+bytes>1024*1024)return dispose(run,'resume_buffer_exceeded');run.buffer.push(encoded);run.bufferBytes+=bytes;}
     };
     const authTimer=setTimeout(()=>reject('authentication_required'),5000);authTimer.unref();
     // Browser WebSockets answer protocol pings without JS timer scheduling.
     // Detect an old half-open TCP connection within the client's resume window.
     let unansweredPings=0;client.on('pong',()=>{unansweredPings=0;});
     const heartbeat=setInterval(()=>{
      if(client.readyState!==WebSocket.OPEN)return;
      if(unansweredPings>=2){client.terminate();return;}
      unansweredPings++;client.ping();
     },heartbeatIntervalMs);heartbeat.unref();
     client.on('error',()=>{});
     client.on('close',code=>{
      clearTimeout(authTimer);clearInterval(heartbeat);clients.delete(client);if(!run||run.closed||run.client!==client)return;
      if(code===1006&&!rejection&&run.engine&&run.provider?.readyState===WebSocket.OPEN){
       run.client=null;run.detached=true;run.resumeUntil=Date.now()+resumeGraceMs;run.engine.suspend();
       run.resumeTimer=setTimeout(()=>dispose(run,'resume_timeout'),resumeGraceMs);run.resumeTimer.unref();
       log({event:'voice.control.detached',reason:'transport_lost',sessionId:run.sessionId});
      }else dispose(run,rejection||'browser_disconnected');
     });
     client.on('message',data=>{
      if(Date.now()-window>1000){window=Date.now();count=0;}if(++count>80)return reject('rate_limited');
      let message;try{message=JSON.parse(data);if(!message||typeof message!=='object'||Array.isArray(message))throw Error();}catch{return reject('invalid_message');}
      if(!run){
       if(authenticating||message.type!=='authenticate'||typeof message.token!=='string'||message.token.length>16000)return reject('authentication_required');
       authenticating=true;
       void (async()=>{
        const identity=await authenticate(message.token),candidate=sessions.get(message.id);
        const resumable=()=>candidate?.claimed&&candidate.detached&&!candidate.client&&candidate.resumeUntil>Date.now()&&candidate.provider?.readyState===WebSocket.OPEN;
        if(!identity?.sub||!candidate||candidate.subject!==identity.sub||candidate.closed||candidate.claimed&&!resumable()&&message.resume!==true)throw Error('invalid_control');
        const revision=await authorize(identity);if(revision!==candidate.permissionRevision)throw Error('permission_changed');
        if(client.readyState!==WebSocket.OPEN)return;
        if(candidate.closed)throw Error('control_claimed');
        if(candidate.claimed&&!resumable()){
         // A mobile browser can detect loss before the server's socket does.
         // Do not take over that writer; a verified resume may retry briefly.
         if(message.resume===true&&candidate.client&&candidate.provider?.readyState===WebSocket.OPEN){client.close(1013,'control_still_attached');return;}
         throw Error('control_claimed');
        }
        const resumed=candidate.claimed;run=candidate;run.claimed=true;run.client=client;run.token=message.token;clearTimeout(authTimer);
        if(resumed){
         clearTimeout(run.resumeTimer);run.detached=false;send({type:'ready',resumed:true});
         const buffered=run.buffer;run.buffer=[];run.bufferBytes=0;for(const encoded of buffered)send(JSON.parse(encoded));
         log({event:'voice.control.resumed',sessionId:run.sessionId});return;
        }
        clearTimeout(run.expiry);
        const attachStarted=Date.now();run.provider=connect(`wss://api.openai.com/v1/live/sessions/${encodeURIComponent(run.providerId)}/attach`);
        run.provider.on('error',()=>dispose(run,'provider_disconnected'));
        run.provider.on('close',()=>dispose(run,'provider_disconnected'));
        const attachTimer=setTimeout(()=>dispose(run,'attach_timeout'),8000);run.attachTimer=attachTimer;attachTimer.unref();
        run.provider.once('open',()=>{
         clearTimeout(attachTimer);if(run.closed)return;
         run.engine=voiceControlSession({provider:run.provider,providerSessionId:run.providerId,config:run.config,scope:run.scope,researchDeliveryV2:env.ORIGEN_RESEARCH_DELIVERY_V2==='true',emit:event=>{send({type:'event',event});if(event.type==='error'&&['live_adapter_failed','live_event_invalid'].includes(event.error?.code))dispose(run,'control_failed');},log,
          jobRequest:(method,id,body)=>request(run.token,method,'/api/voice-research-jobs'+(id?'?id='+encodeURIComponent(id):''),body,run.sessionId)});
         const durationMs=Date.now()-attachStarted;send({type:'ready'});send({type:'event',event:{type:'origen.control.ready',durationMs}});run.engine.start();log({event:'voice.control.ready',sessionId:run.sessionId,durationMs});
        });
        run.provider.on('message',data=>{try{run.engine?.receive(JSON.parse(data));}catch{dispose(run,'invalid_provider_event');}});
        run.expiry=setTimeout(()=>dispose(run,'expired'),10*60000);run.expiry.unref();let checking=false;
        run.check=setInterval(()=>{if(checking)return;checking=true;void (async()=>{const fresh=await authenticate(run.token);if(fresh.sub!==run.subject||await authorize(fresh)!==run.permissionRevision)throw Error('permission_changed');})().catch(()=>dispose(run,'permission_changed')).finally(()=>checking=false);},1000);run.check.unref();
       })().catch(()=>reject('control_unavailable'));return;
      }
      if(run.closed||!run.engine)return;
      if(message.type==='playback'){run.engine.playback(message);return;}
      // Do not serialize callbacks behind settle()/prepareClose(): those wait
      // for playback telemetry and fresh input arriving on this same channel.
      if(message.type==='event'){
       if(message.event?.type==='session.update'){
        const proposed=message.event.session||{},language=proposed.controlLanguage;
        if(!['en','es'].includes(language))return reject('invalid_update');
        const update=run.updates.get(proposed.controlUpdateId);run.updates.clear();
        if(proposed.controlUpdateId&&(!update||update.expires<Date.now()))return reject('invalid_update');
        const next={...(update?.config||run.config),language,instructions:voiceLanguageInstructions((update?.config||run.config).instructions,language)};
        if(!update&&(proposed.tools||proposed.liveInstructions||proposed.liveContext||proposed.instructions!==next.instructions))return reject('invalid_update');
        const nextScope=update?.scope||run.scope;run.config=next;run.scope=nextScope;
        run.chain=run.chain.then(()=>run.engine.configure(next,nextScope,message.event.event_id)).catch(()=>dispose(run,'update_failed'));
       }else if(!run.engine.command(message.event||{},message.lease))reject('invalid_command');
       return;
      }
      if(message.type==='rpc'&&['settle','prepareClose','flush','cancel'].includes(message.method)&&typeof message.id==='string'&&message.id.length<=100){
       const pending=run.rpcs.get(message.method);
       // Mobile scheduling can overlap two waits for the same quiet boundary.
       // Share that observation, never tear down a healthy call or replay work.
       if(pending){if(pending.has(message.id))return;if(pending.size>=16){send({type:'reply',id:message.id,value:false});return;}pending.add(message.id);return;}
       const ids=new Set([message.id]);run.rpcs.set(message.method,ids);
       void Promise.resolve().then(()=>run.engine[message.method]()).then(value=>{for(const id of ids)send({type:'reply',id,value});}).catch(()=>dispose(run,'control_failed')).finally(()=>run.rpcs.delete(message.method));return;
      }
      if(message.type==='close'){dispose(run);return;}reject('invalid_command');
     });
    });
   };
   server.on('upgrade',upgrade);
  },
  close(){for(const run of sessions.values())dispose(run,'server_shutdown');for(const client of clients)client.terminate();if(upgrade)serverRef.removeListener('upgrade',upgrade);wss?.close();},
 };
}
