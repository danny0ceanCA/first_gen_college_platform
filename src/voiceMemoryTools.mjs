import {withRequestDeadline} from './requestDeadline.mjs';
import {voicePresentation} from './voicePresentation.mjs';
const names=new Set(['recall_student_context','save_student_memory','save_next_step','get_guidance_question','correct_binder_item']);
export const isLiveMemoryTool=name=>names.has(name);
const cancelled={status:'cancelled',instruction:'This request was superseded or the call ended. Follow the newest user turn. Do not use an old result or retry the old request.'};
export function voiceMemoryTools({post,isCurrent=()=>true,canHear=()=>true,onSaved=()=>{},onConflict=()=>{},onUncertain=()=>{},onWriting=()=>{},signal,timeoutMs=12000}){
 let session,sequence=0,current,registered=Promise.resolve(false),presentation=Promise.resolve(),proposal,question,stopped=false;
 const active=new Set(),calls=new Map(),seenTurns=new Set();
 const alive=turn=>!stopped&&isCurrent()&&!signal?.aborted&&turn===sequence;
 async function request(body,controller){return withRequestDeadline(s=>post(body,s),{signal:controller?AbortSignal.any([controller.signal,...(signal?[signal]:[])]):signal,timeoutMs});}
 function register(turn){
  if(!session)return Promise.resolve(false);
  const id=session.id;
  return presentation.then(()=>request({action:'turn',sessionId:id,sequence:turn.sequence,turnId:turn.id,transcript:turn.text,language:turn.language})).then(()=>alive(turn.sequence)&&session?.id===id).catch(()=>false);
 }
 function cancel(){for(const controller of active)controller.abort();active.clear();}
 function assistant(text){
  if(!session||!current||typeof text!=='string')return;
  const turn={...current},id=session.id;
  const body=proposal&&alive(proposal.sequence)?{action:'present',change:proposal.change}:question&&alive(question.sequence)?{action:'question-present',key:question.key}:null;
  if(!body)return;
  presentation=presentation.then(()=>request({...body,sessionId:id,sequence:turn.sequence,turnId:turn.id,transcript:turn.text,presentation:text.slice(0,8000)})).then(()=>{}).catch(()=>{});
 }
 const delivered=voicePresentation(assistant,()=>sequence,canHear);
 return {
  event:event=>{if(event.type==='response.created'&&proposal&&alive(proposal.sequence))assistant('A new reply has not finished playing.');delivered.event(event);},
  isTool:isLiveMemoryTool,
  session:()=>session,
  sequence:()=>sequence,
  configure(value){if(!value?.id||session?.id===value.id)return;cancel();delivered.clear();proposal=undefined;question=undefined;session=value;calls.clear();if(current)registered=register(current);},
  begin(id,language='en'){
   if(stopped||current?.id===id)return;
   const inFlight=active.size>0;cancel();delivered.clear();seenTurns.add(id);current={id,sequence:++sequence,text:'',language};registered=inFlight?register(current):Promise.resolve(false);
  },
  transcript(id,text,language='en'){
   if(stopped)return;
   if(current?.id!==id&&!seenTurns.has(id))this.begin(id,language);
   if(current?.id!==id)return; // late transcription cannot replace a newer turn
   current={...current,text:String(text||'').slice(0,8000),language};registered=register(current);
  },
  assistant,
  async invoke(item,expectedSequence=sequence){
   if(!names.has(item.name))return null;
   if(!alive(expectedSequence))return cancelled;
   const key=`${expectedSequence}:${item.call_id}`;
   if(calls.has(key))return calls.get(key);
   const turn=current?{...current}:null,id=session?.id,registration=registered;
   const write=!['recall_student_context','get_guidance_question'].includes(item.name),controller=new AbortController();active.add(controller);
   const task=(async()=>{
    try{
     if(!id||!turn?.text||!await withRequestDeadline(()=>registration,{signal:controller.signal,timeoutMs}))return {status:'unavailable',instruction:'The current user turn could not be verified. Nothing was saved. Ask them to repeat the request if needed.'};
     if(!alive(expectedSequence))return cancelled;
     const args=JSON.parse(item.arguments),base={sessionId:id,sequence:turn.sequence,turnId:turn.id,transcript:turn.text};
     const change=item.name==='save_next_step'?{...args,kind:'next-step'}:args;
     const body=item.name==='get_guidance_question'?{...base,action:'question',topic:args.topic}:write?{...base,action:'write',requestId:crypto.randomUUID(),change}:{...base,action:'read',query:args.query};
     if(write)onWriting(true);
     const result=await request(body,controller);
     if(!alive(expectedSequence))return cancelled;
     if(result.status==='clarification_required'){proposal={sequence:turn.sequence,change:result.proposal};question=undefined;}
     if(result.status==='question'){question={sequence:turn.sequence,key:result.key};proposal=undefined;}
     if(result.status==='saved')await onSaved(result);
     return result;
    }catch(error){
     if(!alive(expectedSequence))return cancelled;
     if(['memory_changed','memory_session_changed'].includes(error?.message)){onConflict();return {status:'conflict',instruction:'Saved information changed. Do not use stale context or claim a save; the app will reload it.'};}
     if(write&&['TimeoutError','AbortError'].includes(error?.name)||write&&!error?.status){onUncertain();return {status:'outcome_unknown',instruction:'A save result was not received. Do not claim success, failure, or retry automatically. Check the binder before trying again.'};}
     return {status:error?.status===409?'conflict':'unavailable',instruction:'No successful save is confirmed. Continue the conversation; do not automatically retry, invent memories, or claim persistence.'};
    }finally{active.delete(controller);if(write)onWriting(false);}
   })();calls.set(key,task);return task;
  },
  stop(){if(stopped)return;stopped=true;cancel();delivered.clear();proposal=undefined;question=undefined;const id=session?.id;session=undefined;if(id)void withRequestDeadline(s=>post({action:'close',sessionId:id},s),{timeoutMs:5000}).catch(()=>{});},
 };
}
