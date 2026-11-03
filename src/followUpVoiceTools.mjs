import {voicePresentation} from './voicePresentation.mjs';
import {withRequestDeadline} from './requestDeadline.mjs';
import {followUpIntent} from './followUpConversation.mjs';
const names=new Set(['list_student_follow_up_actions','prepare_student_check_in','prepare_private_follow_up_update','confirm_student_follow_up','list_student_outcome_reports','prepare_student_outcome_evidence']);
const cancelled={status:'cancelled',instruction:'This turn or session changed. Do not use or retry the old request.'};
export function followUpVoiceTools({post,evidence,sequence,isCurrent=()=>true,canHear=()=>false,onSaved=()=>{},onChanged=()=>{},onWriting=()=>{},onUncertain=()=>{},onResponseContext=async()=>false,signal,timeoutMs=12000,timeZone=Intl.DateTimeFormat().resolvedOptions().timeZone}){
 let enabled=false,outcomes=false,stopped=false,proposal,barrier=Promise.resolve();const calls=new Map(),controllers=new Set();
 const alive=n=>enabled&&!stopped&&!signal?.aborted&&isCurrent()&&n===sequence();
 const request=(body,controller)=>withRequestDeadline(s=>post(body,s),{signal:controller?AbortSignal.any([controller.signal,...(signal?[signal]:[])]):signal,timeoutMs});
 const present=text=>{
  if(!proposal||!alive(proposal.sequence))return;
  const value=proposal.evidence;
  barrier=barrier.then(()=>request({...value,action:'present',presentation:text})).then(()=>{}).catch(()=>{if(alive(value.sequence))onUncertain();});
 };
 const playback=voicePresentation(present,sequence,canHear);
 async function invokeBody(key,body,n,writing){
  if(calls.has(key))return calls.get(key);
  const controller=new AbortController();controllers.add(controller);
  const task=(async()=>{try{
   const turn=await evidence();if(!turn||!alive(n))return cancelled;
   if(writing)onWriting(true);
   const result=await request({...body,...turn},controller);if(!alive(n))return cancelled;
   if(result.reviewResponseGuard){if(!await onResponseContext(result.reviewResponseGuard)||!alive(n))return cancelled;delete result.reviewResponseGuard;}
   if(result.status==='readback_required')proposal={sequence:n,evidence:turn};
   if(result.status==='saved'){proposal=undefined;await onSaved(result);}
   if(result.status==='stopped'){proposal=undefined;onChanged();}
   return result;
  }catch(error){
   if(!alive(n))return cancelled;
   if(writing&&(!error?.status||error.status>=500)){onUncertain();return {status:'outcome_unknown',instruction:'No save or stop result was confirmed. Check My private updates or check-in settings in the binder; never automatically retry.'};}
   return {status:error?.status===409?'conflict':'unavailable',instruction:'No successful change is confirmed. Review the current action in the binder.'};
  }finally{controllers.delete(controller);if(writing)onWriting(false);}})();calls.set(key,task);return task;
 }
 return {
  configure(value,outcomeEnabled=false){enabled=value===true;outcomes=outcomeEnabled===true;},
  isTool:name=>names.has(name),
  settled:()=>barrier,
  begin(){for(const c of controllers)c.abort();controllers.clear();playback.clear();},
  event(event){
   if(!enabled||stopped)return;
   if(['forced_flush','unverified_audio'].includes(event.liveBoundary)||['output_audio_buffer.cleared','error','conversation.item.input_audio_transcription.failed'].includes(event.type)){playback.clear();present('');return;}
   if(event.type==='response.created')present('');
   playback.event(event);
  },
  async spokenTurn(){
   const n=sequence();if(!alive(n))return null;
   const turn=await evidence();if(!turn||!alive(n)||!followUpIntent(turn.transcript).startsWith('stop'))return null;
   return invokeBody(`stop:${n}`,{action:'stop',operationId:crypto.randomUUID()},n,true);
  },
  async invoke(item,n=sequence()){
   if(!names.has(item.name))return null;if(!alive(n))return cancelled;
   if(['list_student_outcome_reports','prepare_student_outcome_evidence'].includes(item.name)&&!outcomes)return cancelled;
   let args;try{args=JSON.parse(item.arguments);}catch{return {status:'invalid_request'};}
   const allowed=['prepare_student_check_in','list_student_outcome_reports'].includes(item.name)?['target']:['prepare_private_follow_up_update','prepare_student_outcome_evidence'].includes(item.name)?['target','payload']:[];
   if(!args||Array.isArray(args)||Object.keys(args).some(k=>!allowed.includes(k)))return {status:'invalid_request'};
   const kind=item.name==='prepare_student_check_in'?'check-in':item.name==='prepare_student_outcome_evidence'?'outcome':'report';
   let body=item.name==='list_student_outcome_reports'?{action:'outcome-reports',target:args.target}:item.name==='list_student_follow_up_actions'?{action:'choices'}:item.name==='confirm_student_follow_up'?{action:'confirm'}:{action:'prepare',kind,target:args.target,payload:kind==='check-in'?{}:args.payload,operationId:crypto.randomUUID(),timeZone};
   if(kind==='outcome'&&body.action==='prepare')body={...body,recommendationProtocol:'recommendation-provenance-v1'};
   return invokeBody(`${n}:${item.call_id}`,body,n,!['choices','outcome-reports'].includes(body.action));
  },
  stop(){stopped=true;for(const c of controllers)c.abort();controllers.clear();playback.clear();proposal=undefined;},
 };
}
