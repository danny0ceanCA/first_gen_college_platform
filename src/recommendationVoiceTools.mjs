import {voicePresentation} from './voicePresentation.mjs';
import {withRequestDeadline} from './requestDeadline.mjs';
import {recommendationSpeechIntent} from './recommendationDelivery.mjs';
const names={suggest_next_action:'select',prepare_recommendation_action:'prepare',confirm_recommendation_action:'confirm',dismiss_recommendation:'cancel'};
export function recommendationVoiceTools({post,evidence,sequence,isCurrent=()=>true,canHear=()=>false,onSaved=()=>{},onUncertain=()=>{},onStale=()=>{},signal,timeoutMs=12000,timeZone=Intl.DateTimeFormat().resolvedOptions().timeZone}){
 let enabled=false,stopped=false,proposal,selected,barrier=Promise.resolve(),timer;const calls=new Map(),controllers=new Set();
 const alive=n=>enabled&&!stopped&&!signal?.aborted&&isCurrent()&&n===sequence();
 const request=(body,controller)=>withRequestDeadline(s=>post(body,s),{signal:controller?AbortSignal.any([controller.signal,...(signal?[signal]:[])]):signal,timeoutMs});
 const clear=()=>{clearInterval(timer);timer=undefined;proposal=undefined;selected=undefined;};
 const present=presentation=>{if(!proposal||!alive(proposal.sequence))return;const turn=proposal.turn;barrier=barrier.catch(()=>{}).then(()=>request({...turn,action:'present',presentation})).then(()=>{}).catch(()=>{});};
 const playback=voicePresentation(present,sequence,canHear);
 async function verify(){
  if(!selected||stopped||!enabled)return;
  const current=selected;
  try{const turn=await evidence();if(!turn||!isCurrent())return;const r=await request({...turn,action:'verify'});if(selected===current&&r.status!=='current')throw Error('stale');}
  catch{if(selected===current){clear();onStale();}}
 }
 return {
  configure(value){enabled=value===true;if(!enabled){clear();playback.clear();}},
  isTool:name=>Object.hasOwn(names,name),settled:()=>barrier,
  begin(){for(const c of controllers)c.abort();controllers.clear();playback.clear();},
  event(event){if(!enabled||stopped)return;if(['forced_flush','unverified_audio'].includes(event.liveBoundary)||['output_audio_buffer.cleared','error','conversation.item.input_audio_transcription.failed'].includes(event.type)){playback.clear();present('');return;}if(event.type==='response.created')present('');playback.event(event);},
  async spokenTurn(){const turn=await evidence();if(turn&&alive(turn.sequence)&&selected&&!['prepare','approve'].includes(recommendationSpeechIntent(turn.transcript))){clear();return request({...turn,action:'cancel'}).then(result=>({...result,instruction:'The previous suggestion is set aside. Follow the newest student question; do not repeat or save the old suggestion.'})).catch(()=>({status:'unavailable'}));}return null;},
  async invoke(item,n=sequence()){
   if(!Object.hasOwn(names,item.name))return null;if(!alive(n))return {status:'cancelled'};
   let args;try{args=JSON.parse(item.arguments);}catch{return {status:'invalid_request'};}
   if(!args||Array.isArray(args)||typeof args!=='object'||Object.keys(args).length)return {status:'invalid_request'};
   const key=`${n}:${item.call_id}`;if(calls.has(key))return calls.get(key);
   const controller=new AbortController();controllers.add(controller);const action=names[item.name];
   if(action==='select')clear();
   const task=(async()=>{try{
    await barrier;const turn=await evidence();if(!turn||!alive(n))return {status:'cancelled'};
    const result=await request({...turn,action,...(action==='select'?{timeZone}:{})},controller);if(!alive(n))return {status:'cancelled'};
    if(result.status==='recommended'||result.status==='readback_required'){selected=result.id;clearInterval(timer);timer=setInterval(()=>void verify(),5000);}
    if(result.status==='readback_required')proposal={sequence:n,turn};
    if(result.status==='saved'){clear();await onSaved(result);}
    if(result.status==='dismissed')clear();return result;
   }catch(error){if(!alive(n))return {status:'cancelled'};clear();if(action==='confirm'&&(!error.status||error.status>=500)){onUncertain();return {status:'outcome_unknown',instruction:'Check My next steps in the binder. Do not claim a save or retry automatically.'};}return {status:error.status===409?'conflict':'unavailable',instruction:'No new save is confirmed. Follow the current question or review My next steps in the binder.'};}
   finally{controllers.delete(controller);}})();calls.set(key,task);return task;
  },
  stop(){stopped=true;clear();for(const c of controllers)c.abort();controllers.clear();playback.clear();},
 };
}
