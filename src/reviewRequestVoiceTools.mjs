import {voicePresentation} from './voicePresentation.mjs';
import {withRequestDeadline} from './requestDeadline.mjs';
const names=new Set(['list_coordinator_review_choices','prepare_coordinator_review_request','confirm_coordinator_review_request']);
const cancelled={status:'cancelled',instruction:'This turn or voice session changed. No approval is confirmed by this result. Follow the newest turn; check My requests in the binder if needed.'};
export function reviewRequestVoiceTools({post,isCurrent=()=>true,canHear=()=>true,onChanged=()=>{},onUncertain=()=>{},signal,timeoutMs=12000}){
 let session,current,sequence=0,stopped=false,barrier=Promise.resolve(),registered=Promise.resolve(false),proposal;
 const calls=new Map(),active=new Set(),seen=new Set();
 const alive=seq=>!stopped&&!signal?.aborted&&isCurrent()&&seq===sequence;
 const request=(body,controller)=>withRequestDeadline(s=>post(body,s),{signal:controller?AbortSignal.any([controller.signal,...(signal?[signal]:[])]):signal,timeoutMs});
 const close=id=>withRequestDeadline(s=>post({action:'close',sessionId:id},s),{timeoutMs:5000}).catch(()=>{});
 const cancel=()=>{for(const c of active)c.abort();active.clear();};
 function register(){
  if(!session||!current)return Promise.resolve(false);
  const turn={...current},id=session.id;
  barrier=barrier.catch(()=>{}).then(()=>request({action:'turn',sessionId:id,sequence:turn.sequence,turnId:turn.id,transcript:turn.text,language:turn.language}));
  return barrier.then(()=>alive(turn.sequence)&&session?.id===id).catch(()=>false);
 }
 function present(text){
  if(!session||!current||proposal?.sequence!==sequence||!alive(sequence))return;
  const turn={...current},id=session.id;
  barrier=barrier.catch(()=>{}).then(()=>request({action:'present',sessionId:id,sequence:turn.sequence,turnId:turn.id,transcript:turn.text,presentation:text})).catch(()=>{});
 }
 const playback=voicePresentation(present,()=>sequence,canHear);
 return {
  isTool:name=>names.has(name),sequence:()=>sequence,
  configure(value){
   if(stopped||session?.id===value?.id)return;
   const old=session?.id;cancel();playback.clear();proposal=undefined;session=value?.id?value:undefined;calls.clear();sequence++;current=undefined;registered=Promise.resolve(false);if(old)void close(old);
  },
  begin(id,language='en'){
   if(stopped||current?.id===id)return;cancel();playback.clear();seen.add(id);current={id,sequence:++sequence,text:'',language};registered=register();
  },
  transcript(id,text,language='en'){
   if(stopped)return;if(current?.id!==id&&!seen.has(id))this.begin(id,language);if(current?.id!==id)return;
   current={...current,text:String(text||'').slice(0,8000),language};registered=register();
  },
  event(event){
   // A forced flush is an end-of-call bookkeeping boundary, not played audio.
   if(['forced_flush','unverified_audio'].includes(event.liveBoundary)||['output_audio_buffer.cleared','error','conversation.item.input_audio_transcription.failed'].includes(event.type)){playback.clear();present('');return;}
   if(event.type==='response.created')present('');
   playback.event(event);
  },
  async invoke(item,expected=sequence){
   if(!names.has(item.name))return null;if(!alive(expected))return cancelled;
   const key=`${expected}:${item.call_id}`;if(calls.has(key))return calls.get(key);
   const turn=current?{...current}:undefined,id=session?.id,registration=registered,controller=new AbortController();active.add(controller);
   const writing=item.name!=='list_coordinator_review_choices';
   const task=(async()=>{try{
    if(!id||!turn?.text||!await withRequestDeadline(()=>registration,{signal:controller.signal,timeoutMs}))return {status:'unavailable',instruction:'The latest student turn could not be verified. Use the notebook request controls; never infer approval.'};
    if(!alive(expected))return cancelled;
    const args=JSON.parse(item.arguments),allowed=item.name==='list_coordinator_review_choices'?['topic','query']:item.name==='prepare_coordinator_review_request'?['connectionId','question','kind','entries','relatedResponse']:[];
    if(!args||Array.isArray(args)||typeof args!=='object'||Object.keys(args).some(k=>!allowed.includes(k)))return {status:'invalid_request'};
    const body={...args,sessionId:id,sequence:turn.sequence,turnId:turn.id,transcript:turn.text,action:item.name==='list_coordinator_review_choices'?'options':item.name==='prepare_coordinator_review_request'?'prepare':'confirm',...(item.name==='prepare_coordinator_review_request'?{requestKey:crypto.randomUUID()}:{})};
    const result=await request(body,controller);if(!alive(expected))return cancelled;
    if(result.status==='readback_required'){proposal={sequence:turn.sequence};onChanged();}
    if(['queued','withdrawn'].includes(result.status)){proposal=undefined;onChanged();}
    return result;
   }catch(e){
    if(!alive(expected))return cancelled;
    if(writing&&(!e.status||e.status>=500)){onUncertain();return {status:'outcome_unknown',instruction:'The result was not confirmed. Do not claim it was saved or sent, and do not retry automatically. Check My requests in the binder.'};}
    return {status:e.status===409?'conflict':'unavailable',instruction:'No approval is confirmed. Use My requests in the binder; do not retry an old request or infer consent.'};
   }finally{active.delete(controller);}})();calls.set(key,task);return task;
  },
  stop(){if(stopped)return;stopped=true;sequence++;cancel();playback.clear();proposal=undefined;const id=session?.id;session=undefined;if(id)void close(id);},
 };
}
