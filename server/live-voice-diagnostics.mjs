import {randomUUID} from 'node:crypto';
import {providerVoiceObservation,providerVoiceCapture} from '../src/providerVoice.mjs';

// A sideband does not replay session.started. One sparse update requests the
// resolved SessionResource without changing any setting. It never gates speech,
// adds a prompt, restarts the call or retries. HTTP creation only returns an ID.
export function liveVoiceDiagnostics({requestedVoice,providerSessionId,send,emit,now=Date.now,schedule=setTimeout,cancel=clearTimeout,id=randomUUID,timeoutMs=5000}){
 let started=false,closed=false,confirmed=false,probeId,startedAt,timer,lastObservation;
 const baseline=providerVoiceObservation(null,{requestedVoice,expectedSessionId:providerSessionId,source:'sideband_connect'});
 const publish=event=>{if(!closed)emit(event);};
 function unavailable(source,reason){
  if(confirmed||closed)return;
  cancel(timer);timer=undefined;
  publish(providerVoiceCapture({...baseline,source,status:'unconfirmed',reason,durationMs:now()-startedAt}));
 }
 return {
  start(){
   if(started||closed)return;started=true;startedAt=now();probeId=id();
   publish(providerVoiceCapture({...baseline,status:'pending',reason:'awaiting_provider',durationMs:0}));
   timer=schedule(()=>unavailable('confirmation_timeout','confirmation_timeout'),timeoutMs);timer?.unref?.();
   try{send({type:'session.update',event_id:probeId,session:{}});}catch{unavailable('confirmation_error','confirmation_rejected');}
  },
  receive(event){
   if(!started||closed)return false;
   const related=(event?.client_event_id||event?.error?.client_event_id)===probeId;
   if(event?.type==='error'&&related){unavailable('confirmation_error','confirmation_rejected');return true;}
   if(!['session.started','session.updated','session.closed'].includes(event?.type))return false;
   // Ignore locally synthesized readiness events: only a provider resource can
   // confirm a voice. Neither requested Marin nor a successful socket is proof.
   if(!event.session){if(related)unavailable('confirmation_error','confirmation_rejected');return related;}
   const observation=providerVoiceObservation(event,{requestedVoice,expectedSessionId:providerSessionId,durationMs:now()-startedAt});
   if(observation.status==='confirmed'||observation.status==='mismatch'){
    confirmed=true;cancel(timer);timer=undefined;
    const identity=JSON.stringify([observation.providerSessionId,observation.providerVoice,observation.providerVoiceKind,observation.providerModel]);
    if(identity!==lastObservation){lastObservation=identity;publish(observation);}
   }else if(related){cancel(timer);timer=undefined;publish(observation);}
   // A diagnostic update must not complete an unrelated application update.
   return related;
  },
  close(){if(closed)return;if(started&&!confirmed&&timer)unavailable('connection_closed','connection_closed');closed=true;cancel(timer);timer=undefined;},
 };
}
