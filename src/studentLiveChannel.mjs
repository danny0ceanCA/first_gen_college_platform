// Adapt Live's continuous speech/delegated tools to the application's existing
// guarded tool handlers. No tool is executed here and no permission is granted.
export function studentLiveChannel(raw,{getTurn=()=>'',schedule=setTimeout,cancel=clearTimeout,now=Date.now,isPlaybackIdle=()=>false}={}){
 let live=false,started=false,closed=false,session={},opening=false,continuation=false;
 let input='',inputId='',inputTimer,output='',outputId='',outputTimer,epoch=0,outputMetadata={};
 let queue=[],handlers={},updates=new Map(),responses=new Map(),seenResponses=new Set(),lastInput=0;
 const id=()=>globalThis.crypto.randomUUID();
 const emit=event=>{if(!closed)return Promise.resolve(handlers.onmessage?.({data:JSON.stringify(event)}));};
 const transmit=event=>{if(closed)return;if(!started){queue.push(event);return;}raw.send(JSON.stringify(event));};
 function append(type,text){
  let part='';const parts=[];for(const character of String(text||'')){if(new TextEncoder().encode(part+character).length>440){parts.push(part);part='';}part+=character;}if(part)parts.push(part);
  return parts.map(content=>{const event_id=id();transmit({type,event_id,delegation_id:null,content});return event_id;});
 }
 async function flushInput(){
  if(inputTimer)cancel(inputTimer);inputTimer=null;if(!inputId||!input)return;
  const item_id=inputId,transcript=input;input='';inputId='';
  await emit({type:'input_audio_buffer.speech_stopped',item_id});
  await emit({type:'conversation.item.input_audio_transcription.completed',item_id,transcript});
 }
 async function finishSpeech(force=false){
  if(outputTimer)cancel(outputTimer);outputTimer=null;if(!outputId)return;
  if(!force&&!isPlaybackIdle()){outputTimer=schedule(()=>void finishSpeech(),250);return;}
  const response_id=outputId,text=output,metadata=outputMetadata;outputId='';output='';outputMetadata={};
  if(text)await emit({type:'response.output_audio_transcript.done',response_id,transcript:text});
  await emit({type:'response.done',response:{id:response_id,status:'completed',metadata,output:[{type:'message',content:[{type:'output_audio'}]}]}});
  // Continuous Live has no output-audio-done event. This is a conservative idle
  // boundary for UI/drain scheduling, never a claim that a person heard speech.
  await emit({type:'output_audio_buffer.stopped',response_id,liveBoundary:'idle_estimate'});
 }
 async function receive(e){
  if(closed)return;if(!live){await emit(e);return;}
  if(e.type==='session.started'){
   started=true;await emit({type:'session.created',session});const pending=queue;queue=[];pending.forEach(transmit);return;
  }
  if(e.type==='session.input_transcript.delta'&&typeof e.delta==='string'){
   lastInput=now();if(!inputId){epoch++;inputId=id();await emit({type:'input_audio_buffer.speech_started',item_id:inputId});}
   input+=e.delta;if(inputTimer)cancel(inputTimer);inputTimer=schedule(()=>void flushInput(),1100);return;
  }
  if(e.type==='session.output_transcript.delta'&&typeof e.delta==='string'){
   if(!outputId){outputId=id();await emit({type:'response.created',response:{id:outputId,metadata:outputMetadata}});await emit({type:'output_audio_buffer.started',response_id:outputId,liveBoundary:'transcript_observed'});}
   output+=e.delta;await emit({type:'response.output_audio_transcript.delta',response_id:outputId,delta:e.delta});
   if(outputTimer)cancel(outputTimer);outputTimer=schedule(()=>void finishSpeech(),outputMetadata.topic==='origen_farewell'?3000:1800);return;
  }
  if(e.type==='session.updated'){
   const job=updates.get(e.client_event_id)||[...updates.values()].find(job=>job.session.instructions===e.session?.delegation?.responses?.instructions);
   if(job){updates.delete(job.id);session={...session,...job.session};await emit({type:'session.updated',session,client_event_id:job.id});}return;
  }
  if(e.type==='response.event'){
   const event=e.event||{},responseId=event.response?.id||event.response_id||[...responses].find(([,value])=>value.delegationId===e.delegation_id)?.[0];
   if(event.type==='response.created'){responses.set(responseId,{epoch,turn:null,output:[],delegationId:e.delegation_id});return;}
   const response=responses.get(responseId);
   if(event.type==='response.output_item.done'&&event.item?.type==='function_call'){if(response&&!response.output.some(item=>item.call_id===event.item.call_id))response.output.push(event.item);return;}
   if(['response.completed','response.failed','response.cancelled','response.incomplete'].includes(event.type)){
    if(!response||seenResponses.has(responseId))return;seenResponses.add(responseId);responses.delete(responseId);
    // Complete transcription before the existing consent and scope handlers run.
    // A later input fragment invalidates all actions from this older response.
    while(inputId&&now()-lastInput<1100&&!closed)await new Promise(resolve=>schedule(resolve,Math.max(20,1100-(now()-lastInput))));
    if(closed)return;const version=epoch;await flushInput();
    const current=response.epoch===version&&version===epoch;
    const metadata={origen_user_turn:current?getTurn():'superseded-live-turn'};
    const output=response.output.length?response.output:(event.response?.output||[]).filter(item=>item.type==='function_call');
    if(output.length){await emit({type:'response.created',response:{id:responseId,metadata}});await emit({type:'response.done',response:{id:responseId,metadata,status:event.response?.status||(event.type==='response.completed'?'completed':event.type.split('.').at(-1)),output}});}
    return;
   }
   return;
  }
  if(e.type==='error'){const error={...e.error,event_id:e.error?.client_event_id||e.client_event_id||e.error?.event_id};await emit({...e,error});return;}
  if(e.type==='session.closed'){await finishSpeech();handlers.onclose?.({});return;}
 }
 function send(text){
  if(!live)return raw.send(text);const event=JSON.parse(text);
  if(event.type==='session.update'){
   const next=event.session||{};const responses={instructions:next.instructions||session.instructions,tools:(next.tools||session.tools||[]).map(tool=>({...tool,strict:false})),tool_choice:next.tool_choice||'auto'};
   updates.set(event.event_id,{id:event.event_id,session:next});
   if(next.liveInstructions)append('session.instructions.append',next.liveInstructions);
   const language=next.instructions?.match(/Current conversation language: (Spanish|English)/)?.[1];if(language)append('session.instructions.append',`Respond in ${language} from now on. Continue this same conversation without greeting again.`);
   transmit({type:'session.update',event_id:event.event_id,session:{delegation:{type:'responses',responses}}});return;
  }
  if(event.type==='conversation.item.create'){
   if(event.item?.type==='function_call_output'){continuation=true;transmit({type:'response.item.create',event_id:event.event_id,item:event.item});}
   else if(event.item?.type==='message'){const text=(event.item.content||[]).map(part=>part.text||'').join('\n');append(event.item.role==='user'?'session.thinking.append':'session.instructions.append',text);}
   return;
  }
  if(event.type==='response.create'){
   const response=event.response||{},special=response.metadata?.topic;
   if(special==='origen_farewell'||special==='origen_lookup_progress'||!opening){
    opening=true;outputMetadata=response.metadata||{};
    if(response.instructions)append('session.instructions.append',response.instructions);
    transmit({type:'session.commentary.append',event_id:event.event_id||id(),delegation_id:null,content:special==='origen_farewell'?'Give the application-requested closing message now, then stop speaking. Do not run tools or ask another question.':special==='origen_lookup_progress'?'Give the brief verified progress update requested above, without extra claims.':`Follow the application opening: greet with Hola and introduce yourself as Origen, an AI college guide, then ask one short ${session.onboarding?'onboarding question following the application setup instructions':'question about what the student wants to discuss today'}. After Hola, speak ${session.language==='es'?'Spanish':'English'}, then listen.`});
   }else if(continuation){continuation=false;transmit({type:'response.create',event_id:event.event_id});}
   return;
  }
  if(event.type==='input_audio_buffer.commit'){void flushInput();return;}
  if(event.type==='input_audio_buffer.clear'){transmit({type:'session.input_audio.mute',event_id:event.event_id});return;}
  if(event.type==='response.cancel'){
   if(responses.has(event.response_id))transmit({type:'response.cancel',response_id:event.response_id,event_id:event.event_id});return;
  }
  if(event.type==='output_audio_buffer.clear'){append('session.instructions.append','Stop the previous utterance. Follow the newest application instruction and the caller’s latest words.');return;}
  if(event.type==='session.close'){transmit(event);return;}
 }
 const api={configure(data){live=data.voiceProvider==='live';session=data.voiceSession||{};},flush:async()=>{if(live){await flushInput();await finishSpeech(true);}}};
 raw.onmessage=event=>{try{void receive(JSON.parse(event.data)).catch(()=>void emit({type:'error',error:{code:'live_adapter_failed'}}));}catch{void emit({type:'error',error:{code:'live_event_invalid'}});}};
 raw.onopen=event=>handlers.onopen?.(event);raw.onclose=event=>handlers.onclose?.(event);
 return new Proxy(raw,{get(target,key){if(key==='configure')return api.configure;if(key==='flush')return api.flush;if(key==='send')return send;if(key==='close')return ()=>{if(live&&started&&raw.readyState==='open')transmit({type:'session.close',event_id:id()});closed=true;cancel(inputTimer);cancel(outputTimer);queue=[];raw.close();};if(key in handlers)return handlers[key];const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;},set(target,key,value){if(['onmessage','onopen','onclose'].includes(key)){handlers[key]=value;return true;}return Reflect.set(target,key,value,target);}});
}
