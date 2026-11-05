// Metadata only: never archive a complete provider session (instructions,
// credentials, SDP and private context can be present in that resource).
const token=value=>typeof value==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(value)?value:null;
const voice=value=>typeof value==='string'?{name:token(value),kind:'builtin'}:
 value&&typeof value==='object'&&!Array.isArray(value)?{name:token(value.id),kind:'custom'}:{name:null,kind:null};
const sources=new Set(['sideband_connect','session.started','session.updated','session.closed','confirmation_timeout','confirmation_error','connection_closed']);
const statuses=new Set(['pending','confirmed','mismatch','unconfirmed']);
const reasons=new Set(['awaiting_provider','voice_missing','session_mismatch','confirmation_timeout','confirmation_rejected','connection_closed']);

export function providerVoiceObservation(event,{requestedVoice,expectedSessionId,source=event?.type,durationMs=0}={}){
 const requested=voice(requestedVoice),reported=voice(event?.session?.audio?.output?.voice);
 const providerSessionId=token(event?.session?.id),expected=token(expectedSessionId);
 const sameSession=!!providerSessionId&&(!expected||providerSessionId===expected);
 const confirmed=!!reported.name&&sameSession;
 return providerVoiceCapture({type:'origen.provider.voice',source,
  status:confirmed?(requested.name&&(requested.name!==reported.name||requested.kind!==reported.kind)?'mismatch':'confirmed'):'unconfirmed',
  reason:confirmed?null:providerSessionId&&expected&&providerSessionId!==expected?'session_mismatch':'voice_missing',
  requestedVoice:requested.name,requestedVoiceKind:requested.name?requested.kind:null,
  providerVoice:confirmed?reported.name:null,providerVoiceKind:confirmed?reported.kind:null,
  providerSessionId:providerSessionId||expected,providerModel:token(event?.session?.model),providerEventId:token(event?.event_id),durationMs});
}

export function providerVoiceCapture(event){
 return {type:'origen.provider.voice',source:sources.has(event.source)?event.source:null,
  status:statuses.has(event.status)?event.status:'unconfirmed',reason:reasons.has(event.reason)?event.reason:null,
  requestedVoice:token(event.requestedVoice),requestedVoiceKind:['builtin','custom'].includes(event.requestedVoiceKind)?event.requestedVoiceKind:null,
  providerVoice:token(event.providerVoice),providerVoiceKind:['builtin','custom'].includes(event.providerVoiceKind)?event.providerVoiceKind:null,
  providerSessionId:token(event.providerSessionId),providerModel:token(event.providerModel),providerEventId:token(event.providerEventId),
  durationMs:Number.isFinite(event.durationMs)&&event.durationMs>=0?Math.min(Math.round(event.durationMs),3600000):null};
}
