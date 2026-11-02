import {withRequestDeadline} from './requestDeadline.mjs';
import {voicePresentation} from './voicePresentation.mjs';
export const followUpOpeningText=(title,language)=>language==='es'?`Me pediste que retomáramos esto: ${title}. ¿Quieres hablar de ello?`:`You asked me to check in about this: ${title}. Would you like to pick that up?`;
export const normalizedOpening=text=>String(text||'').normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{Z}\s]+/gu,' ').trim();
export const declinesCheckIn=text=>/^(?:not now|maybe later|later please|no thanks|no thank you|ahora no|no por ahora|mas tarde|quizas despues|no gracias)[.!?,\s]*$/i.test(String(text||'').normalize('NFD').replace(/\p{M}/gu,'').trim());

// Application-owned playback evidence shared by the Live/Realtime adapters. A transcript alone,
// a forced flush, silence, or a generated response does not acknowledge hearing.
export function followUpOpeningPlayback({claim,post,canHear=()=>false,isCurrent=()=>true,onUnavailable=()=>{},signal,timeoutMs=8000}){
 let stopped=false,sequence=0,attempted=false,presented=false,armed=false,checking=false,pending=Promise.resolve(),responseId;
 const active=()=>!stopped&&!signal?.aborted&&isCurrent();
 const send=body=>withRequestDeadline(s=>post({studentId:claim.studentId,conversationId:claim.conversationId,claimId:claim.claimId,...body},s),{signal,timeoutMs});
 const release=()=>{armed=false;playback.clear();if(!attempted){attempted=true;void send({action:'release'}).catch(()=>{});}};
 const playback=voicePresentation(text=>{
  if(!active()||!armed||attempted)return;
  if(normalizedOpening(text)!==normalizedOpening(claim.presentation)){release();onUnavailable();return;}
  attempted=true;armed=false;
  pending=send({action:'present',presentation:text}).then(result=>{if(!active())return;presented=result.status==='presented';if(!presented)onUnavailable();}).catch(()=>{if(active())onUnavailable();});
 },()=>sequence,canHear);
 return {
  async verify(){
   if(!active()||attempted||checking)return false;checking=true;
   try{const result=await send({action:'verify'});if(!active())return false;armed=result.status==='current';if(!armed){release();onUnavailable();}return armed;}
   catch{release();if(active())onUnavailable();return false;}finally{checking=false;}
  },
  event(event){
   if(!active())return;
   if(event.type==='response.created'&&armed){
    const id=event.response?.id;if(!id)return;
    if(responseId===id)return;
    if(responseId){release();onUnavailable();return;}
    responseId=id;
   }
   if(armed&&event.type==='response.done'&&event.response?.status!=='completed'){release();onUnavailable();return;}
   if(['forced_flush','unverified_audio'].includes(event.liveBoundary)||['output_audio_buffer.cleared','error','conversation.item.input_audio_transcription.failed','input_audio_buffer.speech_started'].includes(event.type)){sequence++;release();return;}
   if(armed&&!canHear()&&['output_audio_buffer.started','output_audio_buffer.stopped'].includes(event.type)){release();onUnavailable();return;}
   if(armed)playback.event(event);
  },
  async notNow(turn){
   if(!active()||!declinesCheckIn(turn?.transcript))return false;
   // The server compares this to the independently registered, immediately
   // following live-memory turn and this claim's original enrollment revision.
   try{await pending;if(!active())return false;const result=await send({action:'defer',sequence:turn.sequence,turnId:turn.turnId,transcript:turn.transcript});return active()&&result.status==='paused';}catch{return false;}
  },
  // The adapter must await this before registering the next independent turn.
  settled:()=>pending,
  presented:()=>presented,
  stop(){if(stopped)return;release();stopped=true;sequence++;},
 };
}
